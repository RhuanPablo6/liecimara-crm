// Histórico de compras de insumos.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayToDate, summarize } from '../src/http/routes/purchases.js';
import { can } from '../src/modules/auth/rbac.js';
import { buildWorld } from './helpers.js';

const base = { supplier: null, notes: null, createdById: null } as const;

describe('Compras de insumos', () => {
  it('data do dia não muda com o fuso', () => {
    const d = dayToDate('2026-11-01');
    assert.equal(d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), '01/11/2026');
  });

  it('cria, lista por período (mais recente primeiro), edita e exclui', async () => {
    const w = buildWorld();
    const a = await w.repos.purchases.create({ ...base, purchasedAt: dayToDate('2026-10-28'), items: [{ name: 'Luvas', quantity: '10 cx' }], totalCents: 35000, paymentMethod: 'PIX', installments: 1 });
    const b = await w.repos.purchases.create({ ...base, purchasedAt: dayToDate('2026-11-05'), items: [{ name: 'Ácido hialurônico', quantity: '4' }], totalCents: 240000, paymentMethod: 'CREDIT_CARD', installments: 3 });
    const nov = await w.repos.purchases.list({ from: new Date('2026-11-01T03:00:00Z'), to: new Date('2026-12-01T03:00:00Z') });
    assert.deepEqual(nov.map((p) => p.id), [b.id]);
    assert.deepEqual((await w.repos.purchases.list()).map((p) => p.id), [b.id, a.id]);

    const s = summarize(await w.repos.purchases.list());
    assert.equal(s.totalCents, 275000);
    assert.equal(s.installmentCents, 240000);
    assert.equal(s.cashCents, 35000);
    assert.equal(s.byMethod.CREDIT_CARD, 240000);

    const up = await w.repos.purchases.update(a.id, { totalCents: 40000 });
    assert.equal(up.totalCents, 40000);
    await w.repos.purchases.delete(a.id);
    await assert.rejects(() => w.repos.purchases.delete(a.id), /não encontrado/);
  });

  it('só administração e gerência acessam', () => {
    assert.ok(can('ADMIN', 'purchases:write'));
    assert.ok(can('MANAGER', 'purchases:read'));
    assert.ok(!can('RECEPTIONIST', 'purchases:read'));
    assert.ok(!can('VIEWER', 'purchases:read'));
  });
});
