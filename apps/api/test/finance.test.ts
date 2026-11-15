// Financeiro: totais, custo por procedimento, despesas e períodos.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocatePurchase, bucketKeys, checkPeriod, NO_PROCEDURE } from '../src/modules/finance/FinanceService.js';
import { dayRange, dayToDate, mondayOf, spDay } from '../src/shared/days.js';
import { actor, buildWorld, seedAd, seedProcedure } from './helpers.js';

const purchaseBase = { supplier: null, notes: null, createdById: null, paymentMethod: 'PIX' as const, installments: 1 };

async function scenario() {
  const w = buildWorld();
  const tox = await seedProcedure(w, 'Toxina botulínica');
  const pre = await seedProcedure(w, 'Preenchimento');
  await seedAd(w, 'AD-100', 'Botox');
  await seedAd(w, 'AD-200', 'Institucional');
  await w.repos.ads.setAdProcedure('AD-100', tox.id);

  const lead = await w.funnel.createLeadManually({ waId: '5511977776666', name: 'Paciente' }, actor);
  await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-04T13:00:00Z'), procedureId: tox.id }, actor);
  await w.funnel.registerSale(lead.id, { procedureId: tox.id, amountCents: 150000, soldAt: new Date('2026-11-05T14:00:00Z') }, actor);
  await w.funnel.registerSale(lead.id, { procedureId: pre.id, amountCents: 200000, soldAt: new Date('2026-11-20T14:00:00Z') }, actor);
  // 31/10 às 23h em São Paulo: fica fora de novembro
  await w.funnel.registerSale(lead.id, { procedureId: pre.id, amountCents: 99900, soldAt: new Date('2026-11-01T02:00:00Z') }, actor);

  await w.repos.purchases.create({
    ...purchaseBase,
    purchasedAt: dayToDate('2026-11-03'),
    items: [
      { name: 'Toxina 100U', quantity: '2', procedureId: tox.id, amountCents: 60000 },
      { name: 'Gaze', quantity: null, procedureId: null, amountCents: null },
    ],
    totalCents: 70000,
  });
  await w.repos.purchases.create({
    ...purchaseBase,
    purchasedAt: dayToDate('2026-11-12'),
    items: [{ name: 'Ácido hialurônico', quantity: '2', procedureId: pre.id, amountCents: null }],
    totalCents: 90000,
  });

  await w.repos.ads.upsertInsights([
    { adMetaId: 'AD-100', date: '2026-11-05', spendCents: 20000, impressions: 1, clicks: 1, metaMessagingConversationsStarted: 1, currency: 'BRL' },
    { adMetaId: 'AD-200', date: '2026-11-30', spendCents: 5000, impressions: 1, clicks: 1, metaMessagingConversationsStarted: 0, currency: 'BRL' },
    { adMetaId: 'AD-100', date: '2026-12-01', spendCents: 7777, impressions: 1, clicks: 1, metaMessagingConversationsStarted: 0, currency: 'BRL' },
  ]);

  const exp = { description: null, paymentMethod: null, createdById: null };
  await w.repos.expenses.create({ ...exp, date: dayToDate('2026-11-10'), category: 'Aluguel', amountCents: 300000, paid: true });
  await w.repos.expenses.create({ ...exp, date: dayToDate('2026-11-15'), category: 'Energia', amountCents: 40000, paid: false });
  return { w, tox, pre };
}

describe('Financeiro', () => {
  it('dias de São Paulo e períodos', () => {
    assert.equal(spDay(new Date('2026-11-01T02:59:00Z')), '2026-10-31');
    assert.equal(spDay(new Date('2026-11-01T03:00:00Z')), '2026-11-01');
    assert.equal(mondayOf('2026-11-15'), '2026-11-09'); // domingo → segunda anterior
    assert.deepEqual(dayRange('2026-11-01', '2026-11-30').to, new Date('2026-12-01T03:00:00Z'));
    assert.deepEqual(bucketKeys('2026-11-01', '2026-11-30', 'week'), ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    assert.deepEqual(bucketKeys('2026-10-15', '2026-12-02', 'month'), ['2026-10', '2026-11', '2026-12']);
    assert.match(checkPeriod('2026-11-02', '2026-11-01', 'day')!, /anterior/);
    assert.match(checkPeriod('2024-01-01', '2026-11-01', 'day')!, /semana ou mês/);
    assert.equal(checkPeriod('2026-01-01', '2026-11-01', 'day'), null);
  });

  it('divide a compra entre procedimentos', () => {
    const one = allocatePurchase({ totalCents: 500, items: [{ procedureId: 'P1', amountCents: null }] });
    assert.deepEqual([...one], [['P1', 500]]);
    const many = allocatePurchase({ totalCents: 1000, items: [{ procedureId: 'P1', amountCents: 300 }, { procedureId: 'P2', amountCents: 200 }, { procedureId: null }] });
    assert.deepEqual(Object.fromEntries(many), { P1: 300, P2: 200, [NO_PROCEDURE]: 500 });
  });

  it('relatório do mês: totais, por procedimento e despesas', async () => {
    const { w, tox, pre } = await scenario();
    const r = await w.finance.report('2026-11-01', '2026-11-30', 'month');
    assert.equal(r.totals.revenueCents, 350000);
    assert.equal(r.totals.salesCount, 2);
    assert.equal(r.totals.suppliesCents, 160000);
    assert.equal(r.totals.adSpendCents, 25000);
    assert.equal(r.totals.expensesCents, 340000);
    assert.equal(r.totals.expensesPendingCents, 40000);
    assert.equal(r.totals.profitCents, 350000 - 160000 - 25000 - 340000);
    assert.equal(r.totals.appointments, 1);

    const t = r.byProcedure.find((x) => x.procedureId === tox.id)!;
    assert.equal(t.revenueCents, 150000);
    assert.equal(t.suppliesCents, 60000);
    assert.equal(t.adSpendCents, 20000);
    assert.equal(t.contributionCents, 70000);
    assert.equal(t.appointments, 1);
    assert.equal(t.roas, 7.5);
    const p = r.byProcedure.find((x) => x.procedureId === pre.id)!;
    assert.equal(p.suppliesCents, 90000);
    assert.equal(p.contributionCents, 110000);
    const none = r.byProcedure.at(-1)!;
    assert.equal(none.procedureId, NO_PROCEDURE);
    assert.equal(none.suppliesCents, 10000);
    assert.equal(none.adSpendCents, 5000);

    assert.deepEqual(r.expensesByCategory.map((c) => c.category), ['Aluguel', 'Energia']);
    assert.equal(r.series.length, 1);
    assert.equal(r.series[0]!.profitCents, r.totals.profitCents);
  });

  it('filtro por dia e por semana', async () => {
    const { w } = await scenario();
    const d = await w.finance.report('2026-11-05', '2026-11-05', 'day');
    assert.equal(d.totals.revenueCents, 150000);
    assert.equal(d.totals.adSpendCents, 20000);
    assert.equal(d.totals.expensesCents, 0);
    const wk = await w.finance.report('2026-11-01', '2026-11-30', 'week');
    assert.equal(wk.series.find((s) => s.key === '2026-11-02')!.revenueCents, 150000);
    assert.equal(wk.series.reduce((t, s) => t + s.profitCents, 0), wk.totals.profitCents);
  });

  it('venda cancelada não conta', async () => {
    const { w, tox } = await scenario();
    const sale = [...w.repos.s.sales.values()].find((s) => s.procedureId === tox.id)!;
    await w.funnel.cancelSale(sale.id, 'desistiu', actor);
    const r = await w.finance.report('2026-11-01', '2026-11-30', 'month');
    assert.equal(r.totals.revenueCents, 200000);
  });
});

describe('Aluguel de aparelhos', () => {
  it('entra no custo do procedimento e no resultado, separado dos insumos', async () => {
    const w = buildWorld();
    const ultra = await seedProcedure(w, 'Ultraformer');
    const lead = await w.funnel.createLeadManually({ waId: '5511955554444', name: 'Paciente' }, actor);
    await w.funnel.registerSale(lead.id, { procedureId: ultra.id, amountCents: 300000, soldAt: new Date('2026-11-20T15:00:00Z') }, actor);
    await w.funnel.registerSale(lead.id, { procedureId: ultra.id, amountCents: 250000, soldAt: new Date('2026-11-20T16:00:00Z') }, actor);
    await w.repos.purchases.create({
      ...purchaseBase,
      kind: 'RENTAL',
      purchasedAt: dayToDate('2026-11-20'),
      items: [{ name: 'Aluguel Ultraformer (dia)', quantity: '2 pacientes', procedureId: ultra.id, amountCents: null }],
      totalCents: 180000,
    });
    const r = await w.finance.report('2026-11-01', '2026-11-30', 'month');
    assert.equal(r.totals.rentalCents, 180000);
    assert.equal(r.totals.suppliesCents, 0);
    assert.equal(r.totals.profitCents, 550000 - 180000);
    const row = r.byProcedure.find((p) => p.procedureId === ultra.id)!;
    assert.equal(row.rentalCents, 180000);
    assert.equal(row.suppliesCents, 0);
    assert.equal(row.contributionCents, 370000);
    assert.equal(r.series[0]!.rentalCents, 180000);
  });
});
