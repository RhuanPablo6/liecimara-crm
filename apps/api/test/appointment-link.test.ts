// Link da paciente: confirmar, desmarcar, pedir remarcação.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appointmentToken, readAppointmentToken } from '../src/modules/agenda/appointmentLink.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

async function world() {
  const w = buildWorld('2026-11-15T15:00:00.000Z');
  const botox = await seedProcedure(w, 'Botox');
  const lead = await w.funnel.createLeadManually({ waId: '5511900000001', name: 'Ana Lima' }, actor);
  const a = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-18T13:00:00Z'), procedureId: botox.id }, actor);
  return { w, a };
}

describe('Link de confirmação', () => {
  it('token assinado: não dá para adivinhar nem trocar de agendamento', () => {
    const t = appointmentToken('abc123xyz', 'segredo');
    assert.equal(readAppointmentToken(t, 'segredo'), 'abc123xyz');
    assert.equal(readAppointmentToken(t, 'outro-segredo'), null);
    assert.equal(readAppointmentToken(t.replace('abc123xyz', 'abc123xyw'), 'segredo'), null);
    assert.equal(readAppointmentToken('lixo', 'segredo'), null);
  });

  it('confirmar marca como confirmado', async () => {
    const { w, a } = await world();
    const r = await w.funnel.patientRespond(a.id, 'CONFIRM', null);
    assert.equal(r.status, 'CONFIRMED');
    assert.equal(r.patientResponse, 'CONFIRMED');
  });

  it('remarcar libera o horário e vira pedido; desmarcado não aceita nova resposta', async () => {
    const { w, a } = await world();
    const r = await w.funnel.patientRespond(a.id, 'RESCHEDULE', 'prefiro sábado de manhã');
    assert.equal(r.status, 'CANCELED');
    assert.equal(r.patientResponse, 'RESCHEDULE');
    assert.equal(r.rescheduleHandled, false);
    assert.match(r.cancelReason!, /remarcar.*sábado/);
    await assert.rejects(() => w.funnel.patientRespond(a.id, 'CONFIRM', null), /desmarcado/);
  });

  it('horário que já passou não aceita resposta', async () => {
    const w = buildWorld('2026-11-15T15:00:00.000Z');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000002', name: 'Bia' }, actor);
    const a = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-10T13:00:00Z') }, actor);
    await assert.rejects(() => w.funnel.patientRespond(a.id, 'CANCEL', null), /já passou/);
  });
});
