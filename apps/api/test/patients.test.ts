// Pacientes: origem, etiqueta novo/carteira, histórico e ranking.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { originOf } from '../src/domain/origin.js';
import { tagOf } from '../src/modules/patients/PatientsService.js';
import { dayToDate } from '../src/shared/days.js';
import { actor, buildWorld, seedAd, seedProcedure } from './helpers.js';

async function world() {
  const w = buildWorld('2026-11-15T15:00:00.000Z');
  const botox = await seedProcedure(w, 'Botox');
  const pre = await seedProcedure(w, 'Preenchimento');
  await seedAd(w);
  // Ana: veio por indicação, 2 compras, compareceu 2 vezes, faltou 1
  const ana = await w.funnel.createLeadManually({ waId: '5511900000001', name: 'Ana', origin: { type: 'REFERRAL', note: 'indicada pela Maria' } }, actor);
  for (const [d, st] of [['2026-10-01T14:00:00Z', 'ATTENDED'], ['2026-10-20T14:00:00Z', 'ATTENDED'], ['2026-11-03T14:00:00Z', 'NO_SHOW']] as const) {
    const a = await w.funnel.scheduleAppointment(ana.id, { scheduledFor: new Date(d), procedureId: botox.id }, actor);
    await w.funnel.setAppointmentStatus(a.id, st, actor);
  }
  const s1 = await w.funnel.registerSale(ana.id, { procedureId: botox.id, amountCents: 150000, soldAt: dayToDate('2026-10-01') }, actor);
  await w.funnel.registerPayment(s1.id, { amountCents: 150000, method: 'PIX', paidAt: dayToDate('2026-10-01') }, actor);
  await w.funnel.registerSale(ana.id, { procedureId: pre.id, amountCents: 200000, soldAt: dayToDate('2026-11-05') }, actor);
  // Bia: veio do anúncio (código), 1 compra grande
  const bia = await w.funnel.createLeadManually({ waId: '5511900000002', name: 'Bia', attribution: { adMetaId: 'AD-100', note: 'código' } }, actor);
  await w.funnel.registerSale(bia.id, { procedureId: pre.id, amountCents: 500000, soldAt: dayToDate('2026-11-10') }, actor);
  // Carla: só conversou; marcada à mão como da carteira (paciente antiga)
  const carla = await w.funnel.createLeadManually({ waId: '5511900000003', name: 'Carla' }, actor);
  await w.repos.contacts.update(carla.contactId, { walletPatient: true });
  return { w, ana, bia, carla, botox, pre };
}

describe('Pacientes', () => {
  it('origem efetiva e etiqueta', () => {
    assert.equal(originOf({ adMetaId: 'X', originType: 'REFERRAL' }), 'AD');
    assert.equal(originOf({ adMetaId: null, originType: 'REFERRAL' }), 'REFERRAL');
    assert.equal(originOf({ adMetaId: null, originType: 'xyz' }), 'UNKNOWN');
    assert.equal(tagOf({ walletPatient: null }, 0), 'NEW');
    assert.equal(tagOf({ walletPatient: null }, 1), 'WALLET');
    assert.equal(tagOf({ walletPatient: true }, 0), 'WALLET');
    assert.equal(tagOf({ walletPatient: false }, 3), 'NEW');
  });

  it('ranking por gasto, comparecimento e faltas', async () => {
    const { w } = await world();
    const byspent = await w.patients.list({ sort: 'spent', limit: 10 });
    assert.deepEqual(byspent.rows.map((r) => r.name), ['Bia', 'Ana', 'Carla']);
    const ana = byspent.rows.find((r) => r.name === 'Ana')!;
    assert.equal(ana.purchases, 2);
    assert.equal(ana.spentCents, 350000);
    assert.equal(ana.balanceCents, 200000);
    assert.equal(ana.attended, 2);
    assert.equal(ana.noShow, 1);
    assert.equal(ana.attendancePct, 66.7);
    assert.equal(ana.origin, 'REFERRAL');
    assert.equal(ana.originNote, 'indicada pela Maria');
    assert.equal(ana.tag, 'WALLET');
    assert.equal(byspent.rows.find((r) => r.name === 'Carla')!.tag, 'WALLET');
    assert.equal((await w.patients.list({ sort: 'attended', limit: 1 })).rows[0]!.name, 'Ana');
    assert.equal((await w.patients.list({ sort: 'spent', origin: 'AD', limit: 10 })).rows.length, 1);
    assert.equal((await w.patients.list({ sort: 'spent', onlyClients: true, limit: 10 })).total, 2);
    const s = byspent.summary;
    assert.equal(s.clients, 2);
    assert.equal(s.spentCents, 850000);
    assert.deepEqual(s.byOrigin.map((o) => o.type), ['AD', 'REFERRAL', 'UNKNOWN']);
  });

  it('no período, etiqueta olha compras anteriores', async () => {
    const { w } = await world();
    const r = await w.patients.list({ sort: 'spent', range: { from: dayToDate('2026-11-01'), to: dayToDate('2026-12-01') }, limit: 10 });
    const ana = r.rows.find((x) => x.name === 'Ana')!;
    assert.equal(ana.purchases, 1);
    assert.equal(ana.tag, 'WALLET'); // já tinha comprado em outubro
    assert.equal(r.rows.find((x) => x.name === 'Bia')!.tag, 'NEW');
  });

  it('trocar para indicação remove o anúncio; histórico completo', async () => {
    const { w, bia, ana } = await world();
    const upd = await w.funnel.setOrganicOrigin(bia.id, 'INSTAGRAM', 'viu o perfil', actor);
    assert.equal(upd.adMetaId, null);
    assert.equal(upd.originType, 'INSTAGRAM');
    const d = (await w.patients.detail(ana.contactId))!;
    assert.equal(d.summary!.purchases, 2);
    assert.ok(d.events.some((e) => e.kind === 'PAYMENT'));
    assert.ok(d.events.some((e) => e.kind === 'APPOINTMENT' && e.status === 'NO_SHOW'));
    assert.match(d.events.find((e) => e.kind === 'LEAD')!.detail!, /Indicação · indicada pela Maria/);
  });

  it('financeiro: faturamento por origem e paciente novo × carteira', async () => {
    const { w } = await world();
    const r = await w.finance.report('2026-11-01', '2026-11-30', 'month');
    assert.deepEqual(
      r.byOrigin.map((o) => [o.type, o.revenueCents]),
      [['AD', 500000], ['REFERRAL', 200000]],
    );
    assert.equal(r.patients.newSales, 1); // Bia (1ª compra)
    assert.equal(r.patients.walletRevenueCents, 200000); // Ana já tinha comprado
  });
});
