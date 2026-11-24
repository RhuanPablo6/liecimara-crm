import { DomainError, NotFoundError } from '../../domain/errors.js';
import { ORGANIC_ORIGINS, type OrganicOrigin } from '../../domain/origin.js';
import {
  OPEN_STAGES,
  type Appointment,
  type Lead,
  type LeadStage,
  type LostReason,
  type PaymentMethod,
  type Reminder,
  type Sale,
} from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import type { Clock } from '../../shared/ids.js';
import { resolveContact } from '../messaging/MessageLog.js';

export interface Actor {
  id: string;
  ip?: string | null;
}

/** Etapas que o usuário pode escolher livremente no quadro do funil. */
const MANUAL_STAGES: readonly LeadStage[] = ['NEW', 'CONTACTED', 'SCHEDULED', 'ATTENDED'];

/**
 * Funil comercial: etapas, agendamentos, vendas, pagamentos, procedimentos,
 * perdas, lembretes e atribuição manual. Toda alteração gera auditoria.
 */
export class FunnelService {
  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
  ) {}

  // ── Leads ─────────────────────────────────────────────────

  async createLeadManually(
    input: {
      waId: string;
      name?: string;
      procedureInterestId?: string | null;
      /** Origem informada no cadastro (ex.: código do anúncio na mensagem pronta). */
      attribution?: { adMetaId: string; note: string } | null;
      /** Origem que não é anúncio (indicação, Instagram...). Ignorada se houver `attribution`. */
      origin?: { type: OrganicOrigin; note?: string | null } | null;
    },
    actor: Actor,
  ): Promise<Lead> {
    return this.repos.tx(async (r) => {
      const now = this.clock.now();
      const waId = input.waId.replace(/\D/g, '');
      if (waId.length < 10) throw new DomainError('INVALID_PHONE', 'Telefone inválido (use DDI + DDD + número)');
      const { contact } = await resolveContact(r, { waId, bsuid: null, name: input.name ?? null }, now, {
        touchLastMessage: false,
      });
      const open = await r.leads.findOpenByContact(contact.id);
      if (open) throw new DomainError('LEAD_ALREADY_OPEN', 'Este contato já possui um lead em aberto', 409);
      const lead = await r.leads.create({
        contactId: contact.id,
        stage: 'NEW',
        procedureInterestId: input.procedureInterestId ?? null,
        ownerId: actor.id,
        attributionConfidence: 'UNKNOWN',
        adMetaId: null,
        adSetMetaId: null,
        campaignMetaId: null,
        attributionEvidenceId: null,
        // Paciente do cadastro anterior (Heon) sem origem informada: "Paciente que retornou".
        originType: input.attribution ? null : (input.origin?.type ?? (contact.externalId ? 'RETURNING' : null)),
        originNote: input.attribution ? null : (input.origin?.note?.trim() || null),
        lostReason: null,
        lostNote: null,
        openedAt: now,
        firstResponseAt: null,
        closedAt: null,
        lastActivityAt: now,
        createdAt: now,
      });
      await r.stageHistory.create({ leadId: lead.id, fromStage: null, toStage: 'NEW', userId: actor.id, reason: 'criado manualmente', at: now });
      await r.audit.log({ userId: actor.id, action: 'lead.create', entityType: 'Lead', entityId: lead.id, after: lead, ip: actor.ip });
      // Na mesma transação: se a origem não puder ser registrada, o lead também não é criado.
      if (input.attribution) return this.applyManualAttribution(r, lead, input.attribution.adMetaId, input.attribution.note, actor);
      return lead;
    });
  }

  /**
   * Origem que não é anúncio (indicação, Instagram, retorno...). Remove a atribuição manual a anúncio,
   * se houver; a atribuição oficial (referência do WhatsApp) não pode ser trocada.
   */
  async setOrganicOrigin(leadId: string, type: OrganicOrigin | null, note: string | null, actor: Actor): Promise<Lead> {
    if (type && !(type in ORGANIC_ORIGINS)) throw new DomainError('VALIDATION', 'Origem inválida');
    return this.repos.tx(async (r) => {
      const lead = await this.getLead(r, leadId);
      if (lead.attributionConfidence === 'OFFICIAL_REFERRAL') {
        throw new DomainError('ATTRIBUTION_ALREADY_OFFICIAL', 'Este lead veio de anúncio com confirmação oficial do WhatsApp; a origem não pode ser trocada.', 409);
      }
      const updated = await r.leads.update(leadId, {
        originType: type,
        originNote: type ? note?.trim() || null : null,
        ...(lead.adMetaId
          ? { attributionConfidence: 'UNKNOWN', adMetaId: null, adSetMetaId: null, campaignMetaId: null, attributionEvidenceId: null }
          : {}),
        lastActivityAt: this.clock.now(),
      });
      await r.audit.log({
        userId: actor.id,
        action: 'lead.origin',
        entityType: 'Lead',
        entityId: leadId,
        before: { adMetaId: lead.adMetaId, originType: lead.originType ?? null, originNote: lead.originNote ?? null },
        after: { originType: updated.originType ?? null, originNote: updated.originNote ?? null },
        ip: actor.ip,
      });
      return updated;
    });
  }

  async setProcedureInterest(leadId: string, procedureId: string | null, actor: Actor): Promise<Lead> {
    return this.repos.tx(async (r) => {
      const lead = await this.getLead(r, leadId);
      if (procedureId && !(await r.procedures.findById(procedureId))) throw new NotFoundError('Procedimento', procedureId);
      const updated = await r.leads.update(leadId, { procedureInterestId: procedureId, lastActivityAt: this.clock.now() });
      await r.audit.log({
        userId: actor.id,
        action: 'lead.procedure_interest',
        entityType: 'Lead',
        entityId: leadId,
        before: { procedureInterestId: lead.procedureInterestId },
        after: { procedureInterestId: procedureId },
        ip: actor.ip,
      });
      return updated;
    });
  }

  async moveStage(leadId: string, to: LeadStage, actor: Actor, reason?: string): Promise<Lead> {
    if (!MANUAL_STAGES.includes(to)) {
      throw new DomainError(
        'STAGE_REQUIRES_ACTION',
        to === 'WON' ? 'Para marcar venda, registre a venda.' : 'Para marcar como perdido, informe o motivo da perda.',
      );
    }
    return this.repos.tx(async (r) => {
      const lead = await this.getLead(r, leadId);
      if (lead.stage === 'WON') throw new DomainError('LEAD_WON', 'Lead com venda não volta para etapas anteriores. Cancele a venda antes.');
      return this.transition(r, lead, to, actor, reason ?? (lead.stage === 'LOST' ? 'reaberto' : undefined), {
        closedAt: null,
        lostReason: null,
        lostNote: null,
      });
    });
  }

  async markLost(leadId: string, reason: LostReason, note: string | null, actor: Actor): Promise<Lead> {
    return this.repos.tx(async (r) => {
      const lead = await this.getLead(r, leadId);
      if (lead.stage === 'WON') throw new DomainError('LEAD_WON', 'Lead com venda ativa não pode ser marcado como perdido');
      if (reason === 'OTHER' && !note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Descreva o motivo quando escolher "Outro"');
      const now = this.clock.now();
      // Agendamentos futuros em aberto são cancelados automaticamente.
      for (const a of await r.appointments.listByLead(leadId)) {
        if ((a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && a.scheduledFor > now) {
          await r.appointments.update(a.id, { status: 'CANCELED', cancelReason: 'Lead marcado como perdido' });
        }
      }
      return this.transition(r, lead, 'LOST', actor, reason, { lostReason: reason, lostNote: note, closedAt: now });
    });
  }

  // ── Agendamentos ──────────────────────────────────────────

  async scheduleAppointment(
    leadId: string,
    input: { scheduledFor: Date; procedureId?: string | null; durationMin?: number | null; notes?: string | null },
    actor: Actor,
  ): Promise<Appointment> {
    return this.repos.tx(async (r) => {
      const lead = await this.getLead(r, leadId);
      if (lead.stage === 'LOST') throw new DomainError('LEAD_LOST', 'Reabra o lead antes de agendar');
      const now = this.clock.now();
      const appt = await r.appointments.create({
        leadId,
        procedureId: input.procedureId ?? lead.procedureInterestId,
        scheduledFor: input.scheduledFor,
        durationMin: input.durationMin ?? 60,
        notes: input.notes?.trim() || null,
        status: 'SCHEDULED',
        cancelReason: null,
        createdById: actor.id,
        createdAt: now,
      });
      await r.audit.log({ userId: actor.id, action: 'appointment.create', entityType: 'Appointment', entityId: appt.id, after: appt, ip: actor.ip });
      if (lead.stage === 'NEW' || lead.stage === 'CONTACTED') {
        await this.transition(r, lead, 'SCHEDULED', actor, 'agendamento registrado');
      } else {
        await r.leads.update(leadId, { lastActivityAt: now });
      }
      return appt;
    });
  }

  /**
   * Resposta da paciente pelo link da mensagem. Confirmar → confirmado; desmarcar → cancelado;
   * remarcar → libera o horário (cancelado) e entra em "pedidos de remarcação" para a recepção.
   */
  async patientRespond(
    appointmentId: string,
    action: 'CONFIRM' | 'CANCEL' | 'RESCHEDULE',
    note: string | null,
    channel: 'link' | 'whatsapp' = 'link',
  ): Promise<Appointment> {
    const via = channel === 'whatsapp' ? 'pelo WhatsApp' : 'pelo link';
    const actor = { id: 'paciente' };
    const appt = await this.repos.appointments.findById(appointmentId);
    if (!appt) throw new NotFoundError('Agendamento', appointmentId);
    if (appt.status === 'ATTENDED' || appt.status === 'NO_SHOW') throw new DomainError('APPOINTMENT_DONE', 'Este horário já passou.');
    if (appt.status === 'CANCELED') throw new DomainError('CANCELED', 'Este horário já foi desmarcado. Fale com a clínica para marcar outro.');
    if (appt.scheduledFor.getTime() < this.clock.now().getTime()) throw new DomainError('APPOINTMENT_DONE', 'Este horário já passou.');
    const clean = note?.trim().slice(0, 500) || null;
    const now = this.clock.now();
    if (action === 'CONFIRM') {
      if (appt.status !== 'CONFIRMED') await this.setAppointmentStatus(appointmentId, 'CONFIRMED', actor);
    } else {
      const reason =
        action === 'CANCEL'
          ? `Paciente desmarcou ${via}${clean ? `: ${clean}` : ''}`
          : `Paciente pediu para remarcar ${via}${clean ? `: ${clean}` : ''}`;
      await this.cancelAppointment(appointmentId, reason, actor);
    }
    const updated = await this.repos.appointments.update(appointmentId, {
      patientResponse: action === 'CONFIRM' ? 'CONFIRMED' : action === 'CANCEL' ? 'CANCELED' : 'RESCHEDULE',
      patientResponseAt: now,
      patientNote: clean,
      rescheduleHandled: false,
    });
    await this.repos.leads.update(appt.leadId, { lastActivityAt: now });
    return updated;
  }

  /** Remarcar / ajustar: data e hora, duração, procedimento, observações. Mudou o horário → volta a "a confirmar". */
  async updateAppointment(
    appointmentId: string,
    input: { scheduledFor?: Date; durationMin?: number; procedureId?: string | null; notes?: string | null },
    actor: Actor,
  ): Promise<Appointment> {
    return this.repos.tx(async (r) => {
      const appt = await r.appointments.findById(appointmentId);
      if (!appt) throw new NotFoundError('Agendamento', appointmentId);
      if (appt.status === 'CANCELED') throw new DomainError('CANCELED', 'Agendamento cancelado: crie um novo horário');
      if (input.procedureId && !(await r.procedures.findById(input.procedureId))) throw new NotFoundError('Procedimento', input.procedureId);
      const moved = input.scheduledFor && input.scheduledFor.getTime() !== appt.scheduledFor.getTime();
      const patch: Partial<Appointment> = {
        ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
        ...(input.durationMin ? { durationMin: input.durationMin } : {}),
        ...(input.procedureId !== undefined ? { procedureId: input.procedureId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(moved && appt.status === 'CONFIRMED' ? { status: 'SCHEDULED' as const } : {}),
        // Novo horário: a confirmação pelo WhatsApp vale para o horário novo.
        ...(moved ? { confirmationSentAt: null, confirmationMessageId: null, confirmationError: null } : {}),
      };
      const updated = await r.appointments.update(appointmentId, patch);
      await r.audit.log({
        userId: actor.id,
        action: moved ? 'appointment.reschedule' : 'appointment.update',
        entityType: 'Appointment',
        entityId: appointmentId,
        before: { scheduledFor: appt.scheduledFor, durationMin: appt.durationMin, procedureId: appt.procedureId, status: appt.status },
        after: patch,
        ip: actor.ip,
      });
      await r.leads.update(appt.leadId, { lastActivityAt: this.clock.now() });
      return updated;
    });
  }

  async cancelAppointment(appointmentId: string, reason: string, actor: Actor): Promise<Appointment> {
    return this.repos.tx(async (r) => {
      const appt = await r.appointments.findById(appointmentId);
      if (!appt) throw new NotFoundError('Agendamento', appointmentId);
      if (appt.status === 'CANCELED') return appt;
      if (appt.status === 'ATTENDED') throw new DomainError('ALREADY_ATTENDED', 'Agendamento já realizado');
      const updated = await r.appointments.update(appointmentId, { status: 'CANCELED', cancelReason: reason });
      await r.audit.log({
        userId: actor.id,
        action: 'appointment.cancel',
        entityType: 'Appointment',
        entityId: appointmentId,
        before: { status: appt.status },
        after: { status: 'CANCELED', reason },
        ip: actor.ip,
      });
      const lead = await this.getLead(r, appt.leadId);
      const stillActive = (await r.appointments.listByLead(appt.leadId)).some(
        (a) => a.id !== appointmentId && (a.status === 'SCHEDULED' || a.status === 'CONFIRMED'),
      );
      if (lead.stage === 'SCHEDULED' && !stillActive) {
        await this.transition(r, lead, 'CONTACTED', actor, `agendamento cancelado: ${reason}`);
      }
      return updated;
    });
  }

  async setAppointmentStatus(
    appointmentId: string,
    status: 'CONFIRMED' | 'ATTENDED' | 'NO_SHOW',
    actor: Actor,
  ): Promise<Appointment> {
    return this.repos.tx(async (r) => {
      const appt = await r.appointments.findById(appointmentId);
      if (!appt) throw new NotFoundError('Agendamento', appointmentId);
      if (appt.status === 'CANCELED') throw new DomainError('CANCELED', 'Agendamento cancelado');
      const updated = await r.appointments.update(appointmentId, { status });
      await r.audit.log({
        userId: actor.id,
        action: `appointment.${status.toLowerCase()}`,
        entityType: 'Appointment',
        entityId: appointmentId,
        before: { status: appt.status },
        after: { status },
        ip: actor.ip,
      });
      const lead = await this.getLead(r, appt.leadId);
      if (status === 'ATTENDED' && (lead.stage === 'SCHEDULED' || lead.stage === 'CONTACTED' || lead.stage === 'NEW')) {
        await this.transition(r, lead, 'ATTENDED', actor, 'compareceu');
      }
      if (status === 'NO_SHOW' && lead.stage === 'SCHEDULED') {
        await this.transition(r, lead, 'CONTACTED', actor, 'não compareceu');
      }
      return updated;
    });
  }

  // ── Vendas e pagamentos ───────────────────────────────────

  async registerSale(
    leadId: string,
    input: {
      procedureId: string;
      amountCents: number;
      soldAt?: Date;
      manualAttribution?: { adMetaId: string; note: string } | null;
    },
    actor: Actor,
  ): Promise<Sale> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new DomainError('INVALID_AMOUNT', 'Valor da venda deve ser positivo (em centavos)');
    }
    return this.repos.tx(async (r) => {
      let lead = await this.getLead(r, leadId);
      if (!(await r.procedures.findById(input.procedureId))) throw new NotFoundError('Procedimento', input.procedureId);
      if (input.manualAttribution) {
        lead = await this.applyManualAttribution(r, lead, input.manualAttribution.adMetaId, input.manualAttribution.note, actor);
      }
      const now = this.clock.now();
      const sale = await r.sales.create({
        leadId,
        procedureId: input.procedureId,
        amountCents: input.amountCents,
        soldAt: input.soldAt ?? now,
        status: 'ACTIVE',
        attributionConfidence: lead.attributionConfidence,
        adMetaId: lead.adMetaId,
        campaignMetaId: lead.campaignMetaId,
        createdById: actor.id,
        createdAt: now,
      });
      await r.audit.log({ userId: actor.id, action: 'sale.create', entityType: 'Sale', entityId: sale.id, after: sale, ip: actor.ip });
      if (lead.stage !== 'WON') {
        await this.transition(r, lead, 'WON', actor, 'venda registrada', { closedAt: now, lostReason: null, lostNote: null });
      } else {
        await r.leads.update(leadId, { lastActivityAt: now });
      }
      return sale;
    });
  }

  async cancelSale(saleId: string, reason: string, actor: Actor): Promise<Sale> {
    return this.repos.tx(async (r) => {
      const sale = await r.sales.findById(saleId);
      if (!sale) throw new NotFoundError('Venda', saleId);
      const updated = await r.sales.update(saleId, { status: 'CANCELED' });
      await r.audit.log({ userId: actor.id, action: 'sale.cancel', entityType: 'Sale', entityId: saleId, after: { reason }, ip: actor.ip });
      const active = (await r.sales.listByLead(sale.leadId)).filter((s) => s.status === 'ACTIVE');
      const lead = await this.getLead(r, sale.leadId);
      if (active.length === 0 && lead.stage === 'WON') {
        await this.transition(r, lead, 'ATTENDED', actor, `venda cancelada: ${reason}`, { closedAt: null });
      }
      return updated;
    });
  }

  async registerPayment(
    saleId: string,
    input: { amountCents: number; method: PaymentMethod; installments?: number; paidAt?: Date },
    actor: Actor,
  ) {
    return this.repos.tx(async (r) => {
      const sale = await r.sales.findById(saleId);
      if (!sale) throw new NotFoundError('Venda', saleId);
      if (sale.status !== 'ACTIVE') throw new DomainError('SALE_CANCELED', 'Venda cancelada');
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new DomainError('INVALID_AMOUNT', 'Valor inválido');
      const paid = (await r.payments.listBySale(saleId)).reduce((s, p) => s + p.amountCents, 0);
      if (paid + input.amountCents > sale.amountCents) {
        throw new DomainError('OVERPAYMENT', `Pagamento excede o saldo da venda (saldo: ${sale.amountCents - paid} centavos)`);
      }
      const payment = await r.payments.create({
        saleId,
        amountCents: input.amountCents,
        method: input.method,
        installments: input.installments ?? 1,
        paidAt: input.paidAt ?? this.clock.now(),
        createdById: actor.id,
      });
      await r.audit.log({ userId: actor.id, action: 'payment.create', entityType: 'Payment', entityId: payment.id, after: payment, ip: actor.ip });
      return payment;
    });
  }

  async markProcedurePerformed(
    leadId: string,
    input: { procedureId: string; saleId?: string | null; performedAt?: Date },
    actor: Actor,
  ) {
    return this.repos.tx(async (r) => {
      await this.getLead(r, leadId);
      if (input.saleId) {
        const sale = await r.sales.findById(input.saleId);
        if (!sale || sale.leadId !== leadId) throw new DomainError('SALE_MISMATCH', 'Venda não pertence a este lead');
      }
      const row = await r.performed.create({
        leadId,
        saleId: input.saleId ?? null,
        procedureId: input.procedureId,
        performedAt: input.performedAt ?? this.clock.now(),
        createdById: actor.id,
      });
      await r.audit.log({ userId: actor.id, action: 'procedure.performed', entityType: 'ProcedurePerformed', entityId: row.id, after: row, ip: actor.ip });
      return row;
    });
  }

  // ── Correções (desfazer cliques errados) ──────────────────

  /** Desmarca "procedimento realizado". */
  async undoProcedurePerformed(performedId: string, reason: string | null, actor: Actor) {
    return this.repos.tx(async (r) => {
      const row = await r.performed.findById(performedId);
      if (!row) throw new NotFoundError('Procedimento realizado', performedId);
      await r.performed.delete(performedId);
      await r.audit.log({ userId: actor.id, action: 'procedure.performed.undo', entityType: 'ProcedurePerformed', entityId: performedId, before: row, after: { reason }, ip: actor.ip });
      await r.leads.update(row.leadId, { lastActivityAt: this.clock.now() });
      return { ok: true, leadId: row.leadId };
    });
  }

  /** Exclui um pagamento lançado errado (valor, forma ou paciente). */
  async deletePayment(paymentId: string, reason: string | null, actor: Actor) {
    return this.repos.tx(async (r) => {
      const p = await r.payments.findById(paymentId);
      if (!p) throw new NotFoundError('Pagamento', paymentId);
      await r.payments.delete(paymentId);
      await r.audit.log({ userId: actor.id, action: 'payment.delete', entityType: 'Payment', entityId: paymentId, before: p, after: { reason }, ip: actor.ip });
      return { ok: true, saleId: p.saleId };
    });
  }

  /** Desfaz o cancelamento de uma venda. */
  async reactivateSale(saleId: string, actor: Actor): Promise<Sale> {
    return this.repos.tx(async (r) => {
      const sale = await r.sales.findById(saleId);
      if (!sale) throw new NotFoundError('Venda', saleId);
      if (sale.status === 'ACTIVE') return sale;
      const updated = await r.sales.update(saleId, { status: 'ACTIVE' });
      await r.audit.log({ userId: actor.id, action: 'sale.reactivate', entityType: 'Sale', entityId: saleId, before: { status: sale.status }, after: { status: 'ACTIVE' }, ip: actor.ip });
      const lead = await this.getLead(r, sale.leadId);
      if (lead.stage !== 'WON') {
        await this.transition(r, lead, 'WON', actor, 'cancelamento da venda desfeito', { closedAt: this.clock.now(), lostReason: null, lostNote: null });
      }
      return updated;
    });
  }

  /**
   * Volta o agendamento para "a confirmar" (desfaz Confirmou / Compareceu / Faltou / Cancelado)
   * e acerta a etapa do lead quando ela tinha mudado por causa do clique.
   */
  async reopenAppointment(appointmentId: string, actor: Actor): Promise<Appointment> {
    return this.repos.tx(async (r) => {
      const appt = await r.appointments.findById(appointmentId);
      if (!appt) throw new NotFoundError('Agendamento', appointmentId);
      if (appt.status === 'SCHEDULED') return appt;
      const updated = await r.appointments.update(appointmentId, { status: 'SCHEDULED', cancelReason: null });
      await r.audit.log({
        userId: actor.id,
        action: 'appointment.reopen',
        entityType: 'Appointment',
        entityId: appointmentId,
        before: { status: appt.status, cancelReason: appt.cancelReason },
        after: { status: 'SCHEDULED' },
        ip: actor.ip,
      });
      const lead = await this.getLead(r, appt.leadId);
      const others = (await r.appointments.listByLead(appt.leadId)).filter((a) => a.id !== appointmentId);
      const attendedElsewhere = others.some((a) => a.status === 'ATTENDED');
      if ((lead.stage === 'ATTENDED' && !attendedElsewhere) || lead.stage === 'CONTACTED' || lead.stage === 'NEW') {
        await this.transition(r, lead, 'SCHEDULED', actor, 'status do agendamento corrigido');
      }
      return updated;
    });
  }

  // ── Atribuição manual ─────────────────────────────────────

  async attributeManually(leadId: string, adMetaId: string, note: string, actor: Actor): Promise<Lead> {
    return this.repos.tx(async (r) => {
      const lead = await this.getLead(r, leadId);
      const updated = await this.applyManualAttribution(r, lead, adMetaId, note, actor);
      // Vendas já registradas sem origem passam a refletir a atribuição manual.
      for (const s of await r.sales.listByLead(leadId)) {
        if (s.attributionConfidence === 'UNKNOWN') {
          await r.sales.update(s.id, {
            attributionConfidence: 'MANUAL',
            adMetaId: updated.adMetaId,
            campaignMetaId: updated.campaignMetaId,
          });
        }
      }
      return updated;
    });
  }

  private async applyManualAttribution(r: Repos, lead: Lead, adMetaId: string, note: string, actor: Actor): Promise<Lead> {
    if (lead.attributionConfidence === 'OFFICIAL_REFERRAL') {
      throw new DomainError(
        'ATTRIBUTION_ALREADY_OFFICIAL',
        'Este lead já tem atribuição confirmada por referência oficial; ela não pode ser substituída manualmente.',
        409,
      );
    }
    if (!note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Informe como a origem foi confirmada (ex.: "paciente mostrou o anúncio")');
    const ad = await r.ads.findAd(adMetaId);
    if (!ad) throw new NotFoundError('Anúncio', adMetaId);
    const now = this.clock.now();
    const ev = await r.evidence.create({
      leadId: lead.id,
      contactId: lead.contactId,
      messageId: null,
      kind: 'MANUAL',
      sourceType: 'ad',
      sourceId: adMetaId,
      sourceUrl: null,
      ctwaClid: null,
      headline: null,
      adMetaId,
      occurredAt: now,
      recordedById: actor.id,
      note,
      raw: null,
      createdAt: now,
    });
    const updated = await r.leads.update(lead.id, {
      attributionConfidence: 'MANUAL',
      adMetaId,
      adSetMetaId: ad.adSetMetaId,
      campaignMetaId: ad.campaignMetaId,
      attributionEvidenceId: ev.id,
      originType: null,
      originNote: null,
    });
    await r.audit.log({
      userId: actor.id,
      action: 'attribution.manual',
      entityType: 'Lead',
      entityId: lead.id,
      before: { confidence: lead.attributionConfidence, adMetaId: lead.adMetaId },
      after: { confidence: 'MANUAL', adMetaId, evidenceId: ev.id, note },
      ip: actor.ip,
    });
    return updated;
  }

  // ── Lembretes ─────────────────────────────────────────────

  async createReminder(leadId: string, input: { dueAt: Date; note: string; assignedToId?: string | null }, actor: Actor): Promise<Reminder> {
    return this.repos.tx(async (r) => {
      await this.getLead(r, leadId);
      const rem = await r.reminders.create({
        leadId,
        dueAt: input.dueAt,
        note: input.note,
        assignedToId: input.assignedToId ?? actor.id,
        doneAt: null,
        createdById: actor.id,
      });
      await r.audit.log({ userId: actor.id, action: 'reminder.create', entityType: 'Reminder', entityId: rem.id, after: rem, ip: actor.ip });
      return rem;
    });
  }

  async completeReminder(reminderId: string, actor: Actor): Promise<Reminder> {
    return this.repos.tx(async (r) => {
      const rem = await r.reminders.findById(reminderId);
      if (!rem) throw new NotFoundError('Lembrete', reminderId);
      const updated = await r.reminders.update(reminderId, { doneAt: this.clock.now() });
      await r.audit.log({ userId: actor.id, action: 'reminder.done', entityType: 'Reminder', entityId: reminderId, ip: actor.ip });
      return updated;
    });
  }

  // ── Consulta ──────────────────────────────────────────────

  async getLeadDetail(leadId: string) {
    const r = this.repos;
    const lead = await this.getLead(r, leadId);
    const [contact, evidence, history, appointments, sales, performed, reminders] = await Promise.all([
      r.contacts.findById(lead.contactId),
      r.evidence.listByLead(leadId),
      r.stageHistory.listByLead(leadId),
      r.appointments.listByLead(leadId),
      r.sales.listByLead(leadId),
      r.performed.listByLead(leadId),
      r.reminders.listByLead(leadId),
    ]);
    const messages = await r.messages.listByContact(lead.contactId, 100);
    const salesWithPayments = await Promise.all(
      sales.map(async (s) => {
        const payments = await r.payments.listBySale(s.id);
        return { ...s, payments, paidCents: payments.reduce((t, p) => t + p.amountCents, 0) };
      }),
    );
    const ad = lead.adMetaId ? await r.ads.findAd(lead.adMetaId) : null;
    return { lead, contact, ad, evidence, history, appointments, sales: salesWithPayments, performed, reminders, messages };
  }

  // ── Internos ──────────────────────────────────────────────

  private async getLead(r: Repos, id: string): Promise<Lead> {
    const lead = await r.leads.findById(id);
    if (!lead) throw new NotFoundError('Lead', id);
    return lead;
  }

  private async transition(
    r: Repos,
    lead: Lead,
    to: LeadStage,
    actor: Actor,
    reason?: string,
    extra: Partial<Lead> = {},
  ): Promise<Lead> {
    const now = this.clock.now();
    if (lead.stage === to && !Object.keys(extra).length) return lead;
    const patch: Partial<Lead> = { ...extra, stage: to, lastActivityAt: now };
    if (OPEN_STAGES.includes(to)) patch.closedAt = null;
    const updated = await r.leads.update(lead.id, patch);
    if (lead.stage !== to) {
      await r.stageHistory.create({ leadId: lead.id, fromStage: lead.stage, toStage: to, userId: actor.id, reason: reason ?? null, at: now });
      await r.audit.log({
        userId: actor.id,
        action: 'lead.stage',
        entityType: 'Lead',
        entityId: lead.id,
        before: { stage: lead.stage },
        after: { stage: to, reason },
        ip: actor.ip,
      });
    }
    return updated;
  }
}
