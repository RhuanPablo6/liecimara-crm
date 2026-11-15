// Financeiro: relatório por período, despesas da clínica, procedimentos e anúncio → procedimento.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { checkPeriod } from '../../modules/finance/FinanceService.js';
import { dayRange, dayToDate, isDay, spDay } from '../../shared/days.js';
import type { Guard } from '../server.js';

const day = z.string().refine(isDay, 'Data no formato AAAA-MM-DD');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM');

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));

const expenseSchema = z.object({
  date: day,
  category: z.string().trim().min(1, 'Informe a categoria').max(80),
  description: optionalText(300),
  amountCents: z.number().int().positive('Informe o valor').max(10_000_000_00),
  paymentMethod: optionalText(40),
  paid: z.boolean().default(true),
});

const lastDayOf = (m: string) => {
  const [y = 2000, mm = 1] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`;
};

export function registerFinanceRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.get('/finance/report', { preHandler: guard('finance:read') }, async (req) => {
    const q = z
      .object({ from: day, to: day, granularity: z.enum(['day', 'week', 'month']).default('day') })
      .parse(req.query);
    const problem = checkPeriod(q.from, q.to, q.granularity);
    if (problem) throw new DomainError('VALIDATION', problem);
    return c.finance.report(q.from, q.to, q.granularity);
  });

  // ── Despesas ───────────────────────────────────────────────
  app.get('/expenses', { preHandler: guard('finance:read') }, async (req) => {
    const q = z.object({ from: day.optional(), to: day.optional() }).parse(req.query);
    const range = q.from || q.to ? dayRange(q.from ?? '2000-01-01', q.to ?? '2999-12-31') : undefined;
    const items = await c.repos.expenses.list(range);
    const totalCents = items.reduce((t, e) => t + e.amountCents, 0);
    const pendingCents = items.filter((e) => !e.paid).reduce((t, e) => t + e.amountCents, 0);
    return { items, summary: { count: items.length, totalCents, pendingCents, paidCents: totalCents - pendingCents } };
  });

  app.post('/expenses', { preHandler: guard('finance:write') }, async (req) => {
    const b = expenseSchema.parse(req.body);
    const e = await c.repos.expenses.create({ ...b, date: dayToDate(b.date), createdById: req.user!.sub });
    await c.audit.record({ userId: req.user!.sub, action: 'expense.create', entityType: 'Expense', entityId: e.id, after: e, ip: req.ip });
    return e;
  });

  app.patch('/expenses/:id', { preHandler: guard('finance:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = expenseSchema.partial().parse(req.body);
    const before = await c.repos.expenses.findById(id);
    const e = await c.repos.expenses.update(id, { ...b, date: b.date ? dayToDate(b.date) : undefined });
    await c.audit.record({ userId: req.user!.sub, action: 'expense.update', entityType: 'Expense', entityId: id, before, after: e, ip: req.ip });
    return e;
  });

  app.delete('/expenses/:id', { preHandler: guard('finance:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const before = await c.repos.expenses.findById(id);
    await c.repos.expenses.delete(id);
    await c.audit.record({ userId: req.user!.sub, action: 'expense.delete', entityType: 'Expense', entityId: id, before, ip: req.ip });
    return { ok: true };
  });

  /** Copia as despesas de um mês para outro (mesmo dia, como "a pagar"). Não duplica as que já existem. */
  app.post('/expenses/copy-month', { preHandler: guard('finance:write') }, async (req) => {
    const b = z.object({ fromMonth: month, toMonth: month }).parse(req.body);
    if (b.fromMonth === b.toMonth) throw new DomainError('VALIDATION', 'Escolha meses diferentes');
    const source = await c.repos.expenses.list(dayRange(`${b.fromMonth}-01`, lastDayOf(b.fromMonth)));
    const target = await c.repos.expenses.list(dayRange(`${b.toMonth}-01`, lastDayOf(b.toMonth)));
    const sig = (e: { category: string; description: string | null; amountCents: number }) =>
      `${e.category}|${e.description ?? ''}|${e.amountCents}`;
    const existing = new Set(target.map(sig));
    const last = lastDayOf(b.toMonth);
    let created = 0;
    for (const e of source) {
      if (existing.has(sig(e))) continue;
      const d = spDay(e.date).slice(8, 10);
      const targetDay = `${b.toMonth}-${d}` > last ? last : `${b.toMonth}-${d}`;
      await c.repos.expenses.create({
        date: dayToDate(targetDay),
        category: e.category,
        description: e.description,
        amountCents: e.amountCents,
        paymentMethod: e.paymentMethod,
        paid: false,
        createdById: req.user!.sub,
      });
      existing.add(sig(e));
      created++;
    }
    await c.audit.record({ userId: req.user!.sub, action: 'expense.copyMonth', entityType: 'Expense', entityId: null, after: { ...b, created }, ip: req.ip });
    return { created, skipped: source.length - created };
  });

  // ── Procedimentos ──────────────────────────────────────────
  app.patch('/procedures/:id', { preHandler: guard('procedures:manage') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        defaultPriceCents: z.number().int().positive().nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const before = await c.repos.procedures.findById(id);
    const p = await c.repos.procedures.update(id, b);
    await c.audit.record({ userId: req.user!.sub, action: 'procedure.update', entityType: 'Procedure', entityId: id, before, after: p, ip: req.ip });
    return p;
  });

  // ── Anúncio → procedimento ─────────────────────────────────
  app.patch('/ads/:metaId/procedure', { preHandler: guard('procedures:manage') }, async (req) => {
    const { metaId } = z.object({ metaId: z.string().min(1) }).parse(req.params);
    const b = z.object({ procedureId: z.string().min(1).nullable(), applyToCampaign: z.boolean().optional() }).parse(req.body);
    if (b.procedureId && !(await c.repos.procedures.findById(b.procedureId))) throw new DomainError('VALIDATION', 'Procedimento inexistente');
    const ad = await c.repos.ads.findAd(metaId);
    if (!ad) throw new DomainError('NOT_FOUND', 'Anúncio não encontrado', 404);
    const targets = b.applyToCampaign
      ? (await c.repos.ads.listAds()).filter((a) => a.campaignMetaId === ad.campaignMetaId)
      : [ad];
    for (const a of targets) await c.repos.ads.setAdProcedure(a.metaId, b.procedureId);
    await c.audit.record({
      userId: req.user!.sub,
      action: 'ad.procedure',
      entityType: 'Ad',
      entityId: metaId,
      after: { procedureId: b.procedureId, ads: targets.map((a) => a.metaId) },
      ip: req.ip,
    });
    return { updated: targets.length };
  });
}
