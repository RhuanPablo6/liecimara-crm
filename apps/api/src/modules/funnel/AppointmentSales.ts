// Valor do atendimento junto do horário: um único lançamento que aparece na Agenda, no Lead, no Financeiro
// e em Contas a receber. O agendamento aponta para a venda (saleId); pagamentos e saldo vêm dela.
import { DomainError, NotFoundError } from '../../domain/errors.js';
import type { PaymentMethod } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import type { Actor, FunnelService } from './FunnelService.js';

export type AppointmentSaleInput =
  | { saleId: string }
  | {
      amountCents: number;
      payment?: { amountCents?: number | null; method: PaymentMethod; installments?: number | null; paidAt?: Date | null } | null;
    };

export interface SaleSummary {
  id: string;
  procedureId: string;
  procedureName: string | null;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  status: string;
  performed: boolean;
  soldAt: Date;
}

export class AppointmentSaleService {
  constructor(
    private readonly repos: Repos,
    private readonly funnel: FunnelService,
  ) {}

  async summary(saleId: string, procName?: Map<string, string>): Promise<SaleSummary | null> {
    const s = await this.repos.sales.findById(saleId);
    if (!s) return null;
    const paid = (await this.repos.payments.listBySale(s.id)).reduce((t, p) => t + p.amountCents, 0);
    const performed = (await this.repos.performed.listByLead(s.leadId)).some((p) => p.saleId === s.id);
    const names = procName ?? new Map((await this.repos.procedures.list()).map((p) => [p.id, p.name]));
    return {
      id: s.id,
      procedureId: s.procedureId,
      procedureName: names.get(s.procedureId) ?? null,
      amountCents: s.amountCents,
      paidCents: paid,
      balanceCents: Math.max(0, s.amountCents - paid),
      status: s.status,
      performed,
      soldAt: s.soldAt,
    };
  }

  /** Vendas ativas ainda "em uso" (com saldo ou sem procedimento realizado): candidatas a vincular ao horário. */
  async openSales(leadId: string, procName?: Map<string, string>): Promise<(SaleSummary & { linkedAppointments: number })[]> {
    const names = procName ?? new Map((await this.repos.procedures.list()).map((p) => [p.id, p.name]));
    const [sales, appts] = await Promise.all([this.repos.sales.listByLead(leadId), this.repos.appointments.listByLead(leadId)]);
    const out = [];
    for (const s of sales) {
      if (s.status !== 'ACTIVE') continue;
      const sum = (await this.summary(s.id, names))!;
      if (sum.balanceCents > 0 || !sum.performed) {
        out.push({ ...sum, linkedAppointments: appts.filter((a) => a.saleId === s.id && a.status !== 'CANCELED').length });
      }
    }
    return out;
  }

  /** Vincula uma venda existente ou lança o valor (e o pagamento, se houver) e vincula ao agendamento. */
  async attach(appointmentId: string, input: AppointmentSaleInput, actor: Actor) {
    const appt = await this.repos.appointments.findById(appointmentId);
    if (!appt) throw new NotFoundError('Agendamento', appointmentId);
    if ('saleId' in input) {
      const sale = await this.repos.sales.findById(input.saleId);
      if (!sale || sale.status !== 'ACTIVE') throw new DomainError('VALIDATION', 'Venda não encontrada ou cancelada');
      if (sale.leadId !== appt.leadId) throw new DomainError('VALIDATION', 'Essa venda é de outro atendimento');
      await this.repos.appointments.update(appt.id, { saleId: sale.id });
      await this.repos.audit.log({ userId: actor.id, action: 'appointment.sale.link', entityType: 'Appointment', entityId: appt.id, after: { saleId: sale.id }, ip: actor.ip });
      return sale;
    }
    if (!appt.procedureId) throw new DomainError('VALIDATION', 'Escolha o procedimento do agendamento para lançar o valor');
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new DomainError('INVALID_AMOUNT', 'Informe o valor do procedimento');
    const paid = input.payment ? (input.payment.amountCents ?? input.amountCents) : 0;
    if (paid > input.amountCents) throw new DomainError('OVERPAYMENT', 'O valor pago é maior que o valor do procedimento');
    const sale = await this.funnel.registerSale(appt.leadId, { procedureId: appt.procedureId, amountCents: input.amountCents }, actor);
    if (input.payment && paid > 0) {
      await this.funnel.registerPayment(
        sale.id,
        { amountCents: paid, method: input.payment.method, installments: input.payment.installments ?? undefined, paidAt: input.payment.paidAt ?? undefined },
        actor,
      );
    }
    await this.repos.appointments.update(appt.id, { saleId: sale.id });
    return sale;
  }

  async detach(appointmentId: string, actor: Actor) {
    const appt = await this.repos.appointments.findById(appointmentId);
    if (!appt) throw new NotFoundError('Agendamento', appointmentId);
    await this.repos.appointments.update(appt.id, { saleId: null });
    await this.repos.audit.log({ userId: actor.id, action: 'appointment.sale.unlink', entityType: 'Appointment', entityId: appt.id, before: { saleId: appt.saleId }, ip: actor.ip });
  }
}
