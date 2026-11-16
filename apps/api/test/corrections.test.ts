// Corrigir cliques errados: realizado, compareceu/faltou/cancelado, pagamento, venda cancelada.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actor, buildWorld, seedProcedure } from './helpers.js';

describe('Correções', () => {
  it('desfaz "procedimento realizado" sem mexer na venda e no pagamento', async () => {
    const w = buildWorld('2026-11-15T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000002', name: 'Carol' }, actor);
    const sale = await w.funnel.registerSale(lead.id, { procedureId: botox.id, amountCents: 150000 }, actor);
    await w.funnel.registerPayment(sale.id, { amountCents: 150000, method: 'PIX' }, actor);
    const done = await w.funnel.markProcedurePerformed(lead.id, { procedureId: botox.id, saleId: sale.id }, actor);
    await w.funnel.undoProcedurePerformed(done.id, null, actor);
    assert.equal((await w.repos.performed.listByLead(lead.id)).length, 0);
    assert.equal((await w.repos.payments.listBySale(sale.id)).length, 1);
    assert.equal((await w.repos.sales.findById(sale.id))!.status, 'ACTIVE');
  });

  it('volta o agendamento para "a confirmar" e acerta a etapa', async () => {
    const w = buildWorld('2026-11-15T15:00:00.000Z');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000003' }, actor);
    const a = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-18T13:00:00Z') }, actor);
    await w.funnel.setAppointmentStatus(a.id, 'ATTENDED', actor);
    assert.equal((await w.repos.leads.findById(lead.id))!.stage, 'ATTENDED');
    const back = await w.funnel.reopenAppointment(a.id, actor);
    assert.equal(back.status, 'SCHEDULED');
    assert.equal((await w.repos.leads.findById(lead.id))!.stage, 'SCHEDULED');

    await w.funnel.cancelAppointment(a.id, 'engano', actor);
    assert.equal((await w.repos.leads.findById(lead.id))!.stage, 'CONTACTED');
    await w.funnel.reopenAppointment(a.id, actor);
    assert.equal((await w.repos.appointments.findById(a.id))!.cancelReason, null);
    assert.equal((await w.repos.leads.findById(lead.id))!.stage, 'SCHEDULED');
  });

  it('exclui pagamento e reativa venda cancelada', async () => {
    const w = buildWorld('2026-11-15T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000004' }, actor);
    const sale = await w.funnel.registerSale(lead.id, { procedureId: botox.id, amountCents: 100000 }, actor);
    const pay = await w.funnel.registerPayment(sale.id, { amountCents: 50000, method: 'CASH' }, actor);
    await w.funnel.deletePayment(pay.id, null, actor);
    assert.equal((await w.repos.payments.listBySale(sale.id)).length, 0);

    await w.funnel.cancelSale(sale.id, 'engano', actor);
    assert.equal((await w.repos.leads.findById(lead.id))!.stage, 'ATTENDED');
    await w.funnel.reactivateSale(sale.id, actor);
    assert.equal((await w.repos.sales.findById(sale.id))!.status, 'ACTIVE');
    assert.equal((await w.repos.leads.findById(lead.id))!.stage, 'WON');
  });
});
