// Confirmação que não chega: o status "failed" do WhatsApp aparece na Agenda com o motivo em português.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfirmationService, explainDeliveryError } from '../src/modules/whatsapp/ConfirmationService.js';
import { actor, buildWorld } from './helpers.js';

describe('Status da confirmação', () => {
  it('falha de entrega volta para a Agenda com o motivo', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const svc = new ConfirmationService(w.repos, w.integrations, w.funnel, w.clock);
    const lead = await w.funnel.createLeadManually({ waId: '5511900000401' }, actor);
    const a = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-17T14:00:00Z') }, actor);
    await w.repos.appointments.update(a.id, { confirmationSentAt: new Date(), confirmationMessageId: 'ycloud:abc' });
    const note = await svc.handleStatus({
      kind: 'MESSAGE_STATUS', dedupKey: 'x', occurredAt: new Date().toISOString(), phoneNumberId: 'p', wabaId: null,
      waMessageId: 'wamid.1', status: 'failed', recipientWaId: '5511900000401',
      errors: [{ code: 131026, title: 'Message undeliverable' }], providerMessageId: 'abc', externalId: a.id,
    } as any);
    assert.match(note!, /não entregue/);
    const after = await w.repos.appointments.findById(a.id);
    assert.equal(after!.confirmationSentAt, null);
    assert.match(after!.confirmationError!, /131026/);
    assert.match(explainDeliveryError(131049, null), /limite/);
  });
});

describe('Envio automático pausado', () => {
  it('erro da conta (código 10) pausa o automático até religar', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const svc = new ConfirmationService(w.repos, w.integrations, w.funnel, w.clock);
    await svc.saveSettings({ enabled: true });
    const lead = await w.funnel.createLeadManually({ waId: '5511900000402' }, actor);
    const a = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-17T14:00:00Z') }, actor);
    await w.repos.appointments.update(a.id, { confirmationSentAt: new Date(), confirmationMessageId: 'ycloud:z1' });
    await svc.handleStatus({
      kind: 'MESSAGE_STATUS', dedupKey: 'y', occurredAt: new Date().toISOString(), phoneNumberId: 'p', wabaId: null,
      waMessageId: 'wamid.2', status: 'failed', recipientWaId: null, errors: [{ code: 10, title: 'Application does not have permission' }], providerMessageId: 'z1', externalId: a.id,
    } as any);
    const s = await svc.settings();
    assert.match(s.pausedReason!, /código 10/);
    assert.match((await svc.runDue()).skipped!, /pausado/);
    await svc.saveSettings({ resume: true });
    assert.equal((await svc.settings()).pausedReason, null);
  });
});
