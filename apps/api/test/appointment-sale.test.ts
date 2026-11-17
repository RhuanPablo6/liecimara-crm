// Valor junto do agendamento: lança uma vez e aparece na venda, no saldo e no vencimento.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actor, buildWorld, seedProcedure } from './helpers.js';

describe('Agendamento com valor', () => {
  it('lança venda + sinal, vincula ao horário e o saldo vence no dia do agendamento', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000301', name: 'Rita' }, actor);
    const a = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-25T14:00:00Z'), procedureId: botox.id }, actor);
    await w.appointmentSales.attach(a.id, { amountCents: 150000, payment: { amountCents: 50000, method: 'PIX' } }, actor);
    const appt = await w.repos.appointments.findById(a.id);
    assert.ok(appt!.saleId);
    const sum = await w.appointmentSales.summary(appt!.saleId!);
    assert.deepEqual([sum!.amountCents, sum!.paidCents, sum!.balanceCents], [150000, 50000, 100000]);
    const open = await w.appointmentSales.openSales(lead.id);
    assert.equal(open.length, 1);
    assert.equal(open[0]!.linkedAppointments, 1);

    // Segundo horário (retorno) usa a mesma venda, sem lançar de novo.
    const b = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-12-10T14:00:00Z'), procedureId: botox.id }, actor);
    await w.appointmentSales.attach(b.id, { saleId: appt!.saleId! }, actor);
    assert.equal((await w.repos.sales.listByLead(lead.id)).length, 1);

    const acc: any = await w.accounts.list('2026-11-01', '2026-12-31', '2026-11-16');
    const item = acc.receivables.find((r: any) => r.refId === appt!.saleId && r.type === 'SALE_BALANCE');
    assert.equal(item.dueDay, '2026-11-25');
    assert.equal(item.dueFromAppointment, true);
  });

  it('não lança valor sem procedimento e recusa venda de outro atendimento', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const l1 = await w.funnel.createLeadManually({ waId: '5511900000302' }, actor);
    const l2 = await w.funnel.createLeadManually({ waId: '5511900000303' }, actor);
    const a = await w.funnel.scheduleAppointment(l1.id, { scheduledFor: new Date('2026-11-25T14:00:00Z'), procedureId: null }, actor);
    await assert.rejects(() => w.appointmentSales.attach(a.id, { amountCents: 1000 }, actor), /procedimento/);
    const s2 = await w.funnel.registerSale(l2.id, { procedureId: botox.id, amountCents: 1000 }, actor);
    await assert.rejects(() => w.appointmentSales.attach(a.id, { saleId: s2.id }, actor), /outro atendimento/);
  });
});
