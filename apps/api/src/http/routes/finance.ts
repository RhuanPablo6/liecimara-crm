// Financeiro: relatório por período, despesas da clínica, procedimentos e anúncio → procedimento.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { CASH_SETTINGS_KEY, DEFAULT_FEE_RULES, FEE_SETTINGS_KEY } from '../../modules/finance/accounts.js';
import { checkPeriod } from '../../modules/finance/FinanceService.js';
import { GOALS_SETTINGS_KEY, type GoalsSettings } from '../../modules/finance/goals.js';
import { ORGANIC_KEYS, ORIGIN_LABELS, originOf } from '../../domain/origin.js';
import { addDays, dayRange, daysBetween, dayToDate, isDay, spDay } from '../../shared/days.js';
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

const SALE_METHODS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'BANK_TRANSFER', 'OTHER'] as const;
const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length >= 10 && v.length <= 15, 'WhatsApp inválido (use DDI + DDD + número)');

const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });

export function registerFinanceRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  // ── Vendas lançadas pelo Financeiro (pacientes de indicação, retorno, balcão...) ──

  /** Procura o paciente pelo WhatsApp para mostrar quem é antes de lançar a venda. */
  app.get('/finance/patient', { preHandler: guard('sales:write') }, async (req) => {
    const { waId } = z.object({ waId: phone }).parse(req.query);
    const contact = await c.repos.contacts.findByWaId(waId);
    if (!contact) return { found: false };
    const lead = (await c.repos.leads.findOpenByContact(contact.id)) ?? (await c.repos.leads.findLatestByContact(contact.id));
    return {
      found: true,
      name: contact.name ?? contact.profileName ?? null,
      leadId: lead?.id ?? null,
      stage: lead?.stage ?? null,
      attributionConfidence: lead?.attributionConfidence ?? null,
      origin: lead ? originOf(lead) : 'UNKNOWN',
    };
  });

  app.post('/finance/sales', { preHandler: guard('sales:write') }, async (req) => {
    const b = z
      .object({
        waId: phone,
        name: optionalText(120),
        procedureId: z.string().min(1),
        amountCents: z.number().int().positive('Informe o valor').max(10_000_000_00),
        soldAt: day,
        adMetaId: z.string().min(1).nullish(),
        /** Previsão para receber o saldo em aberto. */
        dueAt: day.nullish(),
        /** Origem que não é anúncio (indicação, Instagram, retorno...). */
        origin: z.object({ type: z.enum(ORGANIC_KEYS as [string, ...string[]]), note: z.string().max(200).nullish() }).nullish(),
        walletPatient: z.boolean().nullish(),
        payment: z
          .object({
            method: z.enum(SALE_METHODS),
            installments: z.number().int().min(1).max(24).default(1),
            amountCents: z.number().int().positive().nullish(),
            paidAt: day.nullish(),
          })
          .nullish(),
      })
      .parse(req.body);
    if (b.payment?.amountCents && b.payment.amountCents > b.amountCents) {
      throw new DomainError('VALIDATION', 'O valor recebido passa do valor da venda');
    }
    const actor = actorOf(req);

    // Paciente: usa o lead em aberto, senão o último; se nunca falou com a clínica, cria.
    const contact = await c.repos.contacts.findByWaId(b.waId);
    let lead = contact ? ((await c.repos.leads.findOpenByContact(contact.id)) ?? (await c.repos.leads.findLatestByContact(contact.id))) : null;
    if (contact && b.name && !contact.name) await c.repos.contacts.update(contact.id, { name: b.name });
    if (!lead) {
      lead = await c.funnel.createLeadManually(
        { waId: b.waId, name: b.name ?? undefined, procedureInterestId: b.procedureId, origin: b.adMetaId ? null : ((b.origin as any) ?? null) },
        actor,
      );
    } else if (b.origin && !b.adMetaId && lead.attributionConfidence === 'UNKNOWN' && !lead.adMetaId && !lead.originType) {
      lead = await c.funnel.setOrganicOrigin(lead.id, b.origin.type as any, b.origin.note ?? null, actor);
    }
    if (b.walletPatient != null) await c.repos.contacts.update(lead.contactId, { walletPatient: b.walletPatient });

    const sale = await c.funnel.registerSale(
      lead.id,
      {
        procedureId: b.procedureId,
        amountCents: b.amountCents,
        soldAt: dayToDate(b.soldAt),
        manualAttribution:
          b.adMetaId && lead.attributionConfidence === 'UNKNOWN'
            ? { adMetaId: b.adMetaId, note: 'Origem informada ao lançar a venda no Financeiro' }
            : null,
      },
      actor,
    );
    if (b.dueAt) await c.repos.sales.update(sale.id, { dueAt: dayToDate(b.dueAt) });
    const payment = b.payment
      ? await c.funnel.registerPayment(
          sale.id,
          {
            amountCents: b.payment.amountCents ?? b.amountCents,
            method: b.payment.method,
            installments: b.payment.installments,
            paidAt: dayToDate(b.payment.paidAt ?? b.soldAt),
          },
          actor,
        )
      : null;
    return { sale, payment, leadId: lead.id };
  });

  /** Vendas do período com paciente, procedimento, origem e quanto já foi recebido. */
  app.get('/finance/sales', { preHandler: guard('finance:read') }, async (req) => {
    const q = z.object({ from: day, to: day }).parse(req.query);
    const [sales, procedures, ads] = await Promise.all([
      c.repos.sales.listSoldIn(dayRange(q.from, q.to)),
      c.repos.procedures.list(),
      c.repos.ads.listAds(),
    ]);
    const procName = new Map(procedures.map((p) => [p.id, p.name]));
    const adName = new Map(ads.map((a) => [a.metaId, a.name]));
    const rows = [];
    for (const s of sales.sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime())) {
      const lead = await c.repos.leads.findById(s.leadId);
      const contact = lead ? await c.repos.contacts.findById(lead.contactId) : null;
      const payments = await c.repos.payments.listBySale(s.id);
      rows.push({
        id: s.id,
        soldAt: s.soldAt,
        status: s.status,
        amountCents: s.amountCents,
        paidCents: payments.reduce((t, p) => t + p.amountCents, 0),
        payments: payments.map((p) => ({ amountCents: p.amountCents, method: p.method, installments: p.installments, paidAt: p.paidAt })),
        procedureId: s.procedureId,
        procedureName: procName.get(s.procedureId) ?? 'Procedimento removido',
        leadId: s.leadId,
        patientName: contact?.name ?? contact?.profileName ?? null,
        waId: contact?.waId ?? null,
        origin: s.adMetaId ? (adName.get(s.adMetaId) ?? 'Anúncio') : lead && originOf(lead) !== 'UNKNOWN' ? ORIGIN_LABELS[originOf(lead)] : null,
        dueAt: s.dueAt ?? null,
      });
    }
    return rows;
  });

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

  // ── Contas a pagar / a receber e fluxo de caixa ────────────
  app.get('/finance/accounts', { preHandler: guard('finance:read') }, async (req) => {
    const q = z.object({ from: day, to: day }).parse(req.query);
    if (q.to < q.from) throw new DomainError('VALIDATION', 'A data final é anterior à inicial');
    if (daysBetween(q.from, q.to) > 3 * 366) throw new DomainError('VALIDATION', 'Escolha um período de até 3 anos');
    return c.accounts.list(q.from, q.to, spDay(new Date()));
  });

  app.get('/finance/cashflow', { preHandler: guard('finance:read') }, async (req) => {
    const q = z.object({ to: day.optional(), granularity: z.enum(['day', 'week', 'month']).default('day') }).parse(req.query);
    const today = spDay(new Date());
    const to = q.to ?? addDays(today, 30);
    if (to < today) throw new DomainError('VALIDATION', 'Escolha uma data futura');
    if (daysBetween(today, to) > 731) throw new DomainError('VALIDATION', 'Projete até 2 anos');
    return c.accounts.cashflow(today, to, q.granularity);
  });

  /** Previsão de recebimento do saldo em aberto de uma venda. */
  app.patch('/sales/:id/due', { preHandler: guard('sales:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = z.object({ dueAt: day.nullable() }).parse(req.body);
    const sale = await c.repos.sales.findById(id);
    if (!sale) throw new DomainError('NOT_FOUND', 'Venda não encontrada', 404);
    const updated = await c.repos.sales.update(id, { dueAt: b.dueAt ? dayToDate(b.dueAt) : null });
    await c.audit.record({ userId: req.user!.sub, action: 'sale.due', entityType: 'Sale', entityId: id, before: { dueAt: sale.dueAt ?? null }, after: { dueAt: updated.dueAt ?? null }, ip: req.ip });
    return updated;
  });

  // ── Configurações: taxas da maquininha e saldo em conta ────
  app.get('/finance/settings', { preHandler: guard('finance:read') }, async () => ({
    feeRules: await c.accounts.feeRules(),
    defaultFeeRules: DEFAULT_FEE_RULES,
    cashBalance: await c.repos.settings.get(CASH_SETTINGS_KEY),
  }));

  app.put('/finance/settings/fees', { preHandler: guard('finance:write') }, async (req) => {
    const rule = z
      .object({
        method: z.enum(SALE_METHODS),
        minInstallments: z.number().int().min(1).max(24),
        maxInstallments: z.number().int().min(1).max(24),
        feePct: z.number().min(0).max(30),
        receiveDays: z.number().int().min(0).max(120),
        anticipated: z.boolean(),
      })
      .refine((r) => r.minInstallments <= r.maxInstallments, { message: 'Faixa de parcelas inválida' });
    const { rules } = z.object({ rules: z.array(rule).max(60) }).parse(req.body);
    const before = await c.accounts.feeRules();
    await c.repos.settings.set(FEE_SETTINGS_KEY, rules);
    await c.audit.record({ userId: req.user!.sub, action: 'finance.fees', entityType: 'Setting', entityId: FEE_SETTINGS_KEY, before, after: rules, ip: req.ip });
    return { rules };
  });

  app.put('/finance/settings/cash', { preHandler: guard('finance:write') }, async (req) => {
    const b = z.object({ amountCents: z.number().int().min(-10_000_000_00).max(10_000_000_00), asOf: day }).parse(req.body);
    await c.repos.settings.set(CASH_SETTINGS_KEY, b);
    await c.audit.record({ userId: req.user!.sub, action: 'finance.cash', entityType: 'Setting', entityId: CASH_SETTINGS_KEY, after: b, ip: req.ip });
    return b;
  });

  // ── Metas, comparativos e ponto de equilíbrio ──────────────
  app.get('/finance/overview', { preHandler: guard('finance:read') }, async (req) => {
    const q = z.object({ month: month.optional() }).parse(req.query);
    const today = spDay(new Date());
    return c.goals.overview(q.month ?? today.slice(0, 7), today);
  });

  app.get('/finance/goals', { preHandler: guard('finance:read') }, async () => c.goals.settings());

  app.put('/finance/goals', { preHandler: guard('finance:write') }, async (req) => {
    const b = z
      .object({
        month,
        revenueCents: z.number().int().positive().max(10_000_000_00).nullable(),
        procedures: z.record(z.string().min(1), z.number().int().positive().max(10_000_000_00)).default({}),
        /** Também vale para os meses sem meta própria. */
        applyAsDefault: z.boolean().default(false),
      })
      .parse(req.body);
    const before = await c.goals.settings();
    const goal = { revenueCents: b.revenueCents, procedures: b.procedures };
    const empty = !b.revenueCents && !Object.keys(b.procedures).length;
    const months = { ...before.months };
    if (empty) delete months[b.month];
    else months[b.month] = goal;
    const next: GoalsSettings = b.applyAsDefault
      ? { default: empty ? null : goal, defaultFrom: empty ? null : b.month, months }
      : { default: before.default, defaultFrom: before.defaultFrom ?? null, months };
    await c.repos.settings.set(GOALS_SETTINGS_KEY, next);
    await c.audit.record({ userId: req.user!.sub, action: 'finance.goals', entityType: 'Setting', entityId: GOALS_SETTINGS_KEY, before, after: next, ip: req.ip });
    return next;
  });
}
