// Compras de insumos da clínica: histórico com valor, materiais, data e forma de pagamento.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { SUPPLY_PAYMENT_METHODS, type SupplyPurchase } from '../../domain/types.js';
import { dayRange, dayToDate, isDay } from '../../shared/days.js';
import type { Guard } from '../server.js';

const day = z.string().refine(isDay, 'Data no formato AAAA-MM-DD');

export { dayToDate };

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Informe o material').max(200),
  quantity: optionalText(50),
  procedureId: z.string().min(1).nullish().transform((v) => v ?? null),
  amountCents: z.number().int().positive().max(10_000_000_00).nullish().transform((v) => v ?? null),
});

const purchaseSchema = z
  .object({
  kind: z.enum(['SUPPLY', 'RENTAL']).default('SUPPLY'),
  purchasedAt: day,
  supplier: optionalText(200),
  items: z.array(itemSchema).min(1, 'Informe ao menos um material').max(100),
  totalCents: z.number().int().positive('Informe o valor').max(10_000_000_00),
  paymentMethod: z.enum(SUPPLY_PAYMENT_METHODS),
  installments: z.number().int().min(1).max(48).default(1),
  /** Vencimento da 1ª parcela (AAAA-MM-DD). */
  firstDueAt: day.nullish(),
  /** Parcelas já pagas. Sem o campo: à vista = paga, parcelado = nenhuma. */
  paidInstallments: z.number().int().min(0).max(48).nullish(),
  notes: optionalText(2000),
  })
  .refine((b) => b.items.reduce((s, i) => s + (i.amountCents ?? 0), 0) <= b.totalCents, {
    message: 'A soma dos valores dos materiais passa do valor total da compra',
    path: ['items'],
  });

function toData(b: z.infer<typeof purchaseSchema>) {
  return {
    ...b,
    purchasedAt: dayToDate(b.purchasedAt),
    firstDueAt: b.firstDueAt ? dayToDate(b.firstDueAt) : null,
    paidInstallments: Math.min(b.installments, b.paidInstallments ?? (b.installments === 1 ? 1 : 0)),
  };
}

export function summarize(list: SupplyPurchase[]) {
  const byMethod: Record<string, number> = {};
  let totalCents = 0;
  let installmentCents = 0;
  for (const p of list) {
    totalCents += p.totalCents;
    if (p.installments > 1) installmentCents += p.totalCents;
    byMethod[p.paymentMethod] = (byMethod[p.paymentMethod] ?? 0) + p.totalCents;
  }
  return { count: list.length, totalCents, installmentCents, cashCents: totalCents - installmentCents, byMethod };
}

export function registerPurchaseRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  /** Lista as compras. ?from=AAAA-MM-DD&to=AAAA-MM-DD (to inclusivo). Sem período = todas. */
  app.get('/purchases', { preHandler: guard('purchases:read') }, async (req) => {
    const q = z.object({ from: day.optional(), to: day.optional(), kind: z.enum(['SUPPLY', 'RENTAL']).optional() }).parse(req.query);
    const range = q.from || q.to ? dayRange(q.from ?? '2000-01-01', q.to ?? '2999-12-31') : undefined;
    const items = (await c.repos.purchases.list(range)).filter((p) => !q.kind || (p.kind ?? 'SUPPLY') === q.kind);
    return { items, summary: summarize(items) };
  });

  app.post('/purchases', { preHandler: guard('purchases:write') }, async (req) => {
    const b = purchaseSchema.parse(req.body);
    const p = await c.repos.purchases.create({ ...toData(b), createdById: req.user!.sub });
    await c.audit.record({ userId: req.user!.sub, action: 'purchase.create', entityType: 'SupplyPurchase', entityId: p.id, after: p, ip: req.ip });
    return p;
  });

  app.patch('/purchases/:id', { preHandler: guard('purchases:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = purchaseSchema.parse(req.body);
    const before = await c.repos.purchases.findById(id);
    // Sem "kind" no corpo, mantém o tipo atual (insumo ou aluguel).
    const kind = (req.body as { kind?: string } | null)?.kind ? b.kind : (before?.kind ?? b.kind);
    const data = toData(b);
    // Sem o campo, mantém o que já foi pago (limitado ao novo nº de parcelas).
    if (b.paidInstallments == null && before) data.paidInstallments = Math.min(b.installments, before.paidInstallments ?? 0);
    const p = await c.repos.purchases.update(id, { ...data, kind });
    await c.audit.record({ userId: req.user!.sub, action: 'purchase.update', entityType: 'SupplyPurchase', entityId: id, before, after: p, ip: req.ip });
    return p;
  });

  /** Marca quantas parcelas já foram pagas (contas a pagar). */
  app.post('/purchases/:id/paid', { preHandler: guard('purchases:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = z.object({ paidInstallments: z.number().int().min(0).max(48) }).parse(req.body);
    const before = await c.repos.purchases.findById(id);
    if (!before) throw new DomainError('NOT_FOUND', 'Compra não encontrada', 404);
    const p = await c.repos.purchases.update(id, { paidInstallments: Math.min(before.installments, b.paidInstallments) });
    await c.audit.record({ userId: req.user!.sub, action: 'purchase.paid', entityType: 'SupplyPurchase', entityId: id, before: { paidInstallments: before.paidInstallments }, after: { paidInstallments: p.paidInstallments }, ip: req.ip });
    return p;
  });

  app.delete('/purchases/:id', { preHandler: guard('purchases:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const before = await c.repos.purchases.findById(id);
    await c.repos.purchases.delete(id);
    await c.audit.record({ userId: req.user!.sub, action: 'purchase.delete', entityType: 'SupplyPurchase', entityId: id, before, ip: req.ip });
    return { ok: true };
  });
}
