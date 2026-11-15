// Metas, comparativos e ponto de equilíbrio.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GOALS_SETTINGS_KEY, goalFor } from '../src/modules/finance/goals.js';
import { dayToDate } from '../src/shared/days.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

async function world() {
  const w = buildWorld();
  const tox = await seedProcedure(w, 'Toxina');
  const lead = await w.funnel.createLeadManually({ waId: '5511977776666', name: 'Maria' }, actor);
  const sell = (day: string, cents: number) => w.funnel.registerSale(lead.id, { procedureId: tox.id, amountCents: cents, soldAt: dayToDate(day) }, actor);
  // Outubro: 4 vendas de 5.000 (2 até o dia 10)
  for (const d of ['2026-10-03', '2026-10-08', '2026-10-20', '2026-10-28']) await sell(d, 500000);
  // Novembro até o dia 10: 3 vendas de 5.000
  for (const d of ['2026-11-02', '2026-11-05', '2026-11-09']) await sell(d, 500000);
  // Custos variáveis: insumos 20% do faturamento de out+nov (35.000) = 7.000
  await w.repos.purchases.create({
    purchasedAt: dayToDate('2026-10-02'),
    supplier: null,
    items: [{ name: 'Toxina', quantity: null, procedureId: tox.id, amountCents: null }],
    totalCents: 700000,
    paymentMethod: 'PIX',
    installments: 1,
    notes: null,
    createdById: null,
  });
  const exp = (day: string, cents: number) =>
    w.repos.expenses.create({ date: dayToDate(day), category: 'Aluguel', description: null, amountCents: cents, paymentMethod: null, paid: true, createdById: null });
  await exp('2026-10-05', 800000);
  await exp('2026-11-05', 800000);
  return { w, tox };
}

describe('Metas e ponto de equilíbrio', () => {
  it('meta do mês, padrão para os demais', () => {
    const g = { default: { revenueCents: 100, procedures: {} }, months: { '2026-11': { revenueCents: 200, procedures: {} } } };
    assert.equal(goalFor(g, '2026-11')!.revenueCents, 200);
    assert.equal(goalFor(g, '2026-12')!.source, 'default');
    assert.equal(goalFor({ default: null, months: {} }, '2026-12'), null);
    assert.equal(goalFor({ ...g, defaultFrom: '2026-11' }, '2026-10'), null); // não vale para trás
  });

  it('mês em andamento: projeção, meta, comparativo no mesmo nº de dias e equilíbrio', async () => {
    const { w, tox } = await world();
    await w.repos.settings.set(GOALS_SETTINGS_KEY, { default: null, months: { '2026-11': { revenueCents: 3000000, procedures: { [tox.id]: 2000000 } } } });
    const o = await w.goals.overview('2026-11', '2026-11-10');
    assert.equal(o.state, 'current');
    assert.equal(o.elapsedDays, 10);
    assert.equal(o.totals.revenueCents, 1500000);
    assert.equal(o.projectedRevenueCents, 4500000); // 15.000 em 10 dias → 45.000 em 30
    assert.equal(o.goal!.achievedPct, 50);
    assert.equal(o.goal!.projectedPct, 150);
    assert.equal(o.goal!.perDayNeededCents, 75000); // faltam 15.000 em 20 dias
    // Outubro até o dia 10: 2 vendas (10.000)
    assert.equal(o.previous.revenueCents, 1000000);
    assert.equal(o.previous.revenueChangePct, 50);
    assert.equal(o.previous.fullMonthRevenueCents, 2000000);
    // Equilíbrio: variáveis 7.000 / 35.000 = 20% → 8.000 / 0,8 = 10.000
    assert.equal(o.breakEven!.variablePct, 20);
    assert.equal(o.breakEven!.revenueCents, 1000000);
    assert.equal(o.breakEven!.reachedOn, '2026-11-05'); // 2ª venda: margem acumulada 8.000
    assert.equal(o.byProcedure[0]!.achievedPct, 75);
    assert.equal(o.history.length, 12);
    assert.equal(o.history.at(-1)!.goalCents, 3000000);
  });

  it('sem despesas no mês: custo fixo estimado pela média', async () => {
    const { w } = await world();
    const o = await w.goals.overview('2026-12', '2026-11-10');
    assert.equal(o.state, 'future');
    assert.equal(o.breakEven!.fixedEstimated, true);
    assert.equal(o.breakEven!.fixedCents, Math.round(1600000 / 3));
  });
});
