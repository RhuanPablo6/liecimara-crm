// Agenda: duração, observações, remarcação.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actor, buildWorld, seedProcedure } from './helpers.js';

describe('Agenda', () => {
  it('marca com duração/observação; remarcar volta para "a confirmar"', async () => {
    const w = buildWorld('2026-11-15T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000001', name: 'Ana' }, actor);
    const a = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-18T13:00:00Z'), procedureId: botox.id, durationMin: 30, notes: 'primeira vez' }, actor);
    assert.equal(a.durationMin, 30);
    assert.equal(a.notes, 'primeira vez');
    await w.funnel.setAppointmentStatus(a.id, 'CONFIRMED', actor);
    const moved = await w.funnel.updateAppointment(a.id, { scheduledFor: new Date('2026-11-19T17:00:00Z') }, actor);
    assert.equal(moved.status, 'SCHEDULED');
    const same = await w.funnel.updateAppointment(a.id, { notes: 'trazer exames' }, actor);
    assert.equal(same.notes, 'trazer exames');
    assert.equal(same.scheduledFor.toISOString(), '2026-11-19T17:00:00.000Z');
    await w.funnel.cancelAppointment(a.id, 'paciente pediu', actor);
    await assert.rejects(() => w.funnel.updateAppointment(a.id, { durationMin: 45 }, actor), /cancelado/);
  });
});
