// Formação de preço: custo do minuto, insumos, markup divisor, arredondamento e custo fixo pelas Despesas.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PRICING } from '../src/modules/pricing/pricing.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

describe('Precificação', () => {
  it('calcula custo, preço mínimo e sugerido (Botox 50 U)', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    await w.repos.procedures.update(botox.id, { defaultPriceCents: 120000 });
    await w.pricing.saveSettings({ ...DEFAULT_PRICING, fixedCostMonthlyCents: 3_000_000, hoursPerMonth: 160, occupancyPct: 50 }, actor);
    const frasco = await w.pricing.saveSupply({ name: 'Toxina botulínica 100 U', unit: 'U', packageCostCents: 120000, packageQty: 100, notes: null }, actor);
    await w.pricing.saveSheet(
      { procedureId: botox.id, durationMin: 30, items: [{ supplyId: frasco.id, quantity: 50 }], otherCostCents: 3000, equipmentCostCents: 0, commissionPct: null, marginPct: null, notes: null },
      actor,
    );
    const o = await w.pricing.overview();
    assert.equal(o.costPerMinuteCents, 625);
    const row = o.rows.find((r) => r.procedureId === botox.id)!;
    assert.equal(row.result!.suppliesCents, 60000);
    assert.equal(row.result!.fixedShareCents, 18750);
    assert.equal(row.result!.totalCostCents, 81750);
    assert.equal(row.result!.minimumCents, 101553);
    assert.equal(row.result!.suggestedCents, 148000); // 147.297 arredondado para cima em R$ 10
    assert.ok(row.result!.currentMarginPct! < 25 && row.result!.currentMarginPct! > 10);

    await assert.rejects(() => w.pricing.deleteSupply(frasco.id, actor), /Botox/);
    await w.pricing.applyPrice(botox.id, 148000, actor);
    assert.equal((await w.repos.procedures.findById(botox.id))!.defaultPriceCents, 148000);
  });

  it('custo fixo automático: média de 3 meses fechados, sem categorias excluídas', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const add = (date: string, category: string, amountCents: number) =>
      w.repos.expenses.create({ date: new Date(`${date}T15:00:00Z`), category, description: null, amountCents, paymentMethod: null, paid: true, createdById: null });
    for (const m of ['2026-08', '2026-09', '2026-10']) {
      await add(`${m}-05`, 'Aluguel', 600000);
      await add(`${m}-10`, 'Impostos', 90000);
    }
    await add('2026-11-05', 'Aluguel', 999999); // mês corrente não entra
    await add('2026-07-05', 'Aluguel', 999999); // fora da janela
    const o = await w.pricing.overview();
    assert.equal(o.fixed.autoMonthlyCents, 600000);
    assert.equal(o.fixed.source, 'expenses');
    assert.deepEqual(o.fixed.months.map((m) => m.month), ['2026-08', '2026-09', '2026-10']);
    assert.ok(o.fixed.categories.find((c) => c.category === 'Impostos')!.excluded);
  });
});
