// Contas a pagar/receber, taxas da maquininha e fluxo de caixa.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMonthsDay,
  DEFAULT_FEE_RULES,
  FEE_SETTINGS_KEY,
  type FeeRule,
  feeOf,
  purchaseParcels,
  ruleFor,
  settlementsOf,
  split,
} from '../src/modules/finance/accounts.js';
import { dayToDate } from '../src/shared/days.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

const rules: FeeRule[] = [
  { method: 'PIX', minInstallments: 1, maxInstallments: 1, feePct: 0, receiveDays: 0, anticipated: false },
  { method: 'DEBIT_CARD', minInstallments: 1, maxInstallments: 1, feePct: 1.5, receiveDays: 1, anticipated: false },
  { method: 'CREDIT_CARD', minInstallments: 1, maxInstallments: 1, feePct: 3, receiveDays: 30, anticipated: false },
  { method: 'CREDIT_CARD', minInstallments: 2, maxInstallments: 12, feePct: 5, receiveDays: 30, anticipated: false },
];

describe('Taxas e repasses', () => {
  it('escolhe a regra pela forma e pelo nº de parcelas', () => {
    assert.equal(ruleFor(rules, 'CREDIT_CARD', 1).feePct, 3);
    assert.equal(ruleFor(rules, 'CREDIT_CARD', 6).feePct, 5);
    assert.equal(ruleFor(rules, 'PIX', 3).feePct, 0); // parcelas só valem no crédito
    assert.equal(ruleFor(rules, 'CASH', 1).feePct, 0); // sem regra: sem taxa
    assert.deepEqual(split(1000, 3), [334, 333, 333]);
  });

  it('crédito 3x: três repasses de 30 em 30 dias, já sem a taxa', () => {
    const s = settlementsOf({ amountCents: 300000, method: 'CREDIT_CARD', installments: 3, paidAt: dayToDate('2026-11-10') }, rules);
    assert.deepEqual(s.map((x) => x.dueDay), ['2026-12-10', '2027-01-09', '2027-02-08']);
    assert.equal(s.reduce((t, x) => t + x.feeCents, 0), 15000);
    assert.equal(s.reduce((t, x) => t + x.netCents, 0), 285000);
    const anticipated = settlementsOf(
      { amountCents: 300000, method: 'CREDIT_CARD', installments: 3, paidAt: dayToDate('2026-11-10') },
      rules.map((r) => ({ ...r, anticipated: true })),
    );
    assert.equal(anticipated.length, 1);
    assert.equal(feeOf({ amountCents: 10000, method: 'DEBIT_CARD', installments: 1, paidAt: dayToDate('2026-11-10') }, rules), 150);
  });

  it('parcelas de compra: mês a mês, ajustando o fim do mês', () => {
    assert.equal(addMonthsDay('2026-01-31', 1), '2026-02-28');
    const parcels = purchaseParcels({ purchasedAt: dayToDate('2026-11-10'), installments: 3, firstDueAt: null, totalCents: 90000, paidInstallments: 1 });
    assert.deepEqual(parcels.map((p) => [p.dueDay, p.amountCents, p.paid]), [
      ['2026-12-10', 30000, true],
      ['2027-01-10', 30000, false],
      ['2027-02-10', 30000, false],
    ]);
    const cash = purchaseParcels({ purchasedAt: dayToDate('2026-11-10'), installments: 1, firstDueAt: null, totalCents: 5000, paidInstallments: 0 });
    assert.equal(cash[0]!.dueDay, '2026-11-10');
  });
});

describe('Contas e fluxo de caixa', () => {
  async function world() {
    const w = buildWorld();
    await w.repos.settings.set(FEE_SETTINGS_KEY, rules);
    const tox = await seedProcedure(w, 'Toxina');
    const lead = await w.funnel.createLeadManually({ waId: '5511977776666', name: 'Maria' }, actor);
    // Venda de 3.000 com sinal de 1.000 no Pix; saldo previsto para 20/11.
    const sale = await w.funnel.registerSale(lead.id, { procedureId: tox.id, amountCents: 300000, soldAt: dayToDate('2026-11-05') }, actor);
    await w.repos.sales.update(sale.id, { dueAt: dayToDate('2026-11-20') });
    await w.funnel.registerPayment(sale.id, { amountCents: 100000, method: 'PIX', paidAt: dayToDate('2026-11-05') }, actor);
    // Outra venda paga no crédito 2x.
    const sale2 = await w.funnel.registerSale(lead.id, { procedureId: tox.id, amountCents: 200000, soldAt: dayToDate('2026-11-06') }, actor);
    await w.funnel.registerPayment(sale2.id, { amountCents: 200000, method: 'CREDIT_CARD', installments: 2, paidAt: dayToDate('2026-11-06') }, actor);
    // Aluguel parcelado em 2x (nenhuma paga) e despesa a pagar vencida.
    await w.repos.purchases.create({
      kind: 'RENTAL',
      purchasedAt: dayToDate('2026-11-01'),
      supplier: 'Locadora',
      items: [{ name: 'Ultraformer', quantity: '4', procedureId: tox.id, amountCents: null }],
      totalCents: 120000,
      paymentMethod: 'BOLETO',
      installments: 2,
      firstDueAt: dayToDate('2026-11-15'),
      paidInstallments: 0,
      notes: null,
      createdById: null,
    });
    await w.repos.expenses.create({ date: dayToDate('2026-11-08'), category: 'Energia', description: null, amountCents: 40000, paymentMethod: null, paid: false, createdById: null });
    return { w, sale };
  }

  it('lista o que vence, o que está vencido e o líquido dos cartões', async () => {
    const { w } = await world();
    const r = await w.accounts.list('2026-11-10', '2026-12-31', '2026-11-10');
    const rec = r.receivables;
    const balance = rec.find((i) => i.type === 'SALE_BALANCE')!;
    assert.equal(balance.amountCents, 200000);
    assert.equal(balance.dueDay, '2026-11-20');
    assert.equal(balance.status, 'PENDING');
    const card = rec.filter((i) => i.type === 'CARD' && i.method === 'Crédito');
    assert.deepEqual(card.map((c) => [c.dueDay, c.amountCents, c.feeCents]), [['2026-12-06', 95000, 5000]]); // 2ª parcela cai em 05/01
    const energy = r.payables.find((p) => p.type === 'EXPENSE')!;
    assert.equal(energy.status, 'OVERDUE'); // venceu em 08/11
    const rental = r.payables.filter((p) => p.type === 'RENTAL');
    assert.deepEqual(rental.map((p) => [p.dueDay, p.amountCents]), [['2026-11-15', 60000], ['2026-12-15', 60000]]);
    assert.equal(r.summary.payables.overdueCents, 40000);
    assert.equal(r.summary.payables.next7Cents, 60000);
  });

  it('fluxo projetado parte do saldo informado; vencidas entram hoje', async () => {
    const { w } = await world();
    await w.repos.settings.set('finance.cashBalance', { amountCents: 50000, asOf: '2026-11-10' });
    const f = await w.accounts.cashflow('2026-11-10', '2026-11-30', 'day');
    const today = f.rows[0]!;
    assert.equal(today.outCents, 40000); // energia vencida
    assert.equal(f.rows.find((r) => r.key === '2026-11-15')!.outCents, 60000);
    assert.equal(f.rows.find((r) => r.key === '2026-11-20')!.inCents, 200000);
    assert.equal(f.totals.closingCents, 50000 - 40000 - 60000 + 200000);
    assert.equal(f.lowest.balanceCents, -50000);
    assert.equal(f.lowest.key, '2026-11-15');
  });

  it('taxas entram no resultado do financeiro e no procedimento', async () => {
    const { w } = await world();
    const r = await w.finance.report('2026-11-01', '2026-11-30', 'month');
    assert.equal(r.totals.feesCents, 10000); // 5% de 2.000
    assert.equal(r.totals.profitCents, 500000 - 120000 - 40000 - 10000);
    assert.equal(r.byProcedure[0]!.feesCents, 10000);
  });

  it('padrão sem taxa', () => {
    assert.ok(DEFAULT_FEE_RULES.every((r) => r.feePct === 0));
  });
});
