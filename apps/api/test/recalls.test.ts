// Retornos, reativação, confirmações e pós-procedimento.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayToDate } from '../src/shared/days.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

const NOW = new Date('2026-11-15T15:00:00Z');

async function world() {
  const w = buildWorld('2026-11-15T15:00:00.000Z');
  const botox = await seedProcedure(w, 'Botox');
  await w.repos.procedures.update(botox.id, { returnDays: 120 });
  const pre = await seedProcedure(w, 'Preenchimento');
  await w.repos.procedures.update(pre.id, { returnDays: 270 });
  const lead = async (waId: string, name: string) => w.funnel.createLeadManually({ waId, name }, actor);
  // Ana: Botox em 10/07 → retorno 07/11 (atrasada 8 dias)
  const ana = await lead('5511900000001', 'Ana Paula Lima');
  await w.funnel.registerSale(ana.id, { procedureId: botox.id, amountCents: 130000, soldAt: dayToDate('2026-07-10') }, actor);
  // Bia: Botox em 25/07 → retorno 22/11 (vem aí, dentro de 14 dias)
  const bia = await lead('5511900000002', 'Bia');
  await w.funnel.registerSale(bia.id, { procedureId: botox.id, amountCents: 130000, soldAt: dayToDate('2026-07-25') }, actor);
  // Carla: Botox em 01/07, mas já tem agendamento futuro → não aparece
  const carla = await lead('5511900000003', 'Carla');
  await w.funnel.registerSale(carla.id, { procedureId: botox.id, amountCents: 130000, soldAt: dayToDate('2026-07-01') }, actor);
  await w.funnel.scheduleAppointment(carla.id, { scheduledFor: new Date('2026-11-20T14:00:00Z'), procedureId: botox.id }, actor);
  // Dani: Preenchimento em 01/03 (retorno só em 26/11 → fora do horizonte de 7 dias) e sumida há > 180 dias
  const dani = await lead('5511900000004', 'Dani');
  await w.funnel.registerSale(dani.id, { procedureId: pre.id, amountCents: 200000, soldAt: dayToDate('2026-03-01') }, actor);
  // Eva: atendida ontem; Fê: agendada para amanhã
  const eva = await lead('5511900000005', 'Eva');
  const ap = await w.funnel.scheduleAppointment(eva.id, { scheduledFor: new Date('2026-11-14T16:00:00Z'), procedureId: botox.id }, actor);
  await w.funnel.setAppointmentStatus(ap.id, 'ATTENDED', actor);
  const fe = await lead('5511900000006', 'Fê');
  await w.funnel.scheduleAppointment(fe.id, { scheduledFor: new Date('2026-11-16T13:00:00Z'), procedureId: pre.id }, actor);
  return { w, ana, bia, botox };
}

describe('Retornos', () => {
  it('monta retornos, reativação, confirmações e pós-procedimento', async () => {
    const { w } = await world();
    const b = await w.recalls.board(NOW, { horizonDays: 7 });
    assert.deepEqual(b.returns.map((r) => [r.firstName, r.dueDay, r.status]), [
      ['Ana', '2026-11-07', 'DUE'],
      ['Bia', '2026-11-22', 'UPCOMING'],
    ]);
    assert.equal(b.returns[0]!.daysLate, 8);
    assert.deepEqual(b.reactivation.map((r) => r.name), ['Dani']);
    assert.equal(b.reactivation[0]!.procedureName, 'Preenchimento');
    assert.deepEqual(b.confirmTomorrow.map((a) => a.name), ['Fê']);
    assert.deepEqual(b.postCare.map((a) => a.name), ['Eva']);
    assert.equal(b.summary.returnsDue, 1);
  });

  it('contatado some por N dias; "não quer" some só neste ciclo', async () => {
    const { w, ana, bia, botox } = await world();
    const b = await w.recalls.board(NOW, { horizonDays: 7 });
    const anaItem = b.returns.find((r) => r.firstName === 'Ana')!;
    await w.recalls.act({ contactId: anaItem.contactId, dueKey: anaItem.dueKey, kind: 'CONTACTED', days: 3 }, 'u', NOW);
    assert.ok(!(await w.recalls.board(NOW, { horizonDays: 7 })).returns.some((r) => r.firstName === 'Ana'));
    const later = new Date('2026-11-19T15:00:00Z');
    const again = (await w.recalls.board(later, { horizonDays: 7 })).returns.find((r) => r.firstName === 'Ana')!;
    assert.ok(again.lastContactedAt);

    const biaItem = b.returns.find((r) => r.firstName === 'Bia')!;
    await w.recalls.act({ contactId: biaItem.contactId, dueKey: biaItem.dueKey, kind: 'DISMISSED' }, 'u', NOW);
    assert.ok(!(await w.recalls.board(later, { horizonDays: 30 })).returns.some((r) => r.firstName === 'Bia'));
    // Nova compra abre novo ciclo (retorno em 2027)
    await w.funnel.registerSale(bia.id, { procedureId: botox.id, amountCents: 130000, soldAt: dayToDate('2026-11-15') }, actor);
    const next = await w.recalls.board(new Date('2027-03-10T15:00:00Z'), { horizonDays: 7 });
    assert.ok(next.returns.some((r) => r.firstName === 'Bia' && r.dueDay === '2027-03-15'));
    void ana;
  });
});
