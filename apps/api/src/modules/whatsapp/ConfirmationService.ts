// Confirmação de agendamento pelo WhatsApp (YCloud) com botões Confirmar / Remarcar / Desmarcar.
// - Modelo de mensagem "utilidade" aprovado pela Meta (criado pelo CRM).
// - Envio automático na véspera, a partir do horário escolhido; ou manual pela Agenda.
// - O toque da paciente chega pelo webhook e atualiza a Agenda, com uma resposta automática.

import { DomainError } from '../../domain/errors.js';
import type { Appointment } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import type { Clock } from '../../shared/ids.js';
import { addDays, dayToDate, spDay } from '../../shared/days.js';
import type { FunnelService } from '../funnel/FunnelService.js';
import type { IntegrationService } from '../integrations/IntegrationService.js';
import { recordMessage } from '../messaging/MessageLog.js';
import { DEFAULT_TEMPLATES, TEMPLATES_KEY } from '../recalls/RecallService.js';
import type { InboundMessageEvent } from './events.js';

export const CONFIRMATION_SETTINGS_KEY = 'whatsapp.confirmations';
export const CONFIRMATIONS_JOB = 'whatsapp.confirmations';

export interface ConfirmationSettings {
  enabled: boolean;
  /** Hora local (São Paulo) a partir da qual as confirmações da véspera saem. */
  sendHour: number;
  templateName: string;
  language: string;
  /** Texto exato do modelo enviado à Meta (com o nome da clínica). */
  templateBody?: string | null;
  lastRunDay?: string | null;
}

export const DEFAULT_CONFIRMATION_SETTINGS: ConfirmationSettings = {
  enabled: false,
  sendHour: 9,
  templateName: 'confirmacaoagendamento1',
  language: 'pt_BR',
};

/**
 * Texto do modelo enviado para aprovação. O nome da clínica vai fixo no texto (menos variáveis =
 * aprovação mais fácil). Variáveis: {{1}} nome, {{2}} procedimento, {{3}} data, {{4}} hora.
 */
export const templateBodyFor = (clinic: string) =>
  `Olá, {{1}}! Aqui é da ${clinic}. Passando para confirmar seu horário de {{2}} no dia {{3}} às {{4}}. Você confirma sua presença?`;
/** Texto padrão (para a prévia antes de criar). */
export const TEMPLATE_BODY = templateBodyFor(DEFAULT_TEMPLATES.clinicName);
export const TEMPLATE_BUTTONS = ['Confirmar', 'Remarcar', 'Desmarcar'] as const;
const ACTIONS = ['CONFIRM', 'RESCHEDULE', 'CANCEL'] as const;

const REPLIES: Record<(typeof ACTIONS)[number], (nome: string) => string> = {
  CONFIRM: (n) => `Perfeito, ${n}! Seu horário está confirmado. Até lá! 💛`,
  RESCHEDULE: (n) => `Sem problemas, ${n}! Nossa equipe vai te chamar por aqui para escolher um novo horário.`,
  CANCEL: (n) => `Tudo bem, ${n}. Seu horário foi desmarcado. Quando quiser remarcar, é só chamar por aqui.`,
};

const SP_OFFSET_MS = 3 * 3_600_000;
const hhmm = (d: Date) => new Date(d.getTime() - SP_OFFSET_MS).toISOString().slice(11, 16);
const ddmm = (d: Date) => {
  const x = new Date(d.getTime() - SP_OFFSET_MS).toISOString();
  return `${x.slice(8, 10)}/${x.slice(5, 7)}`;
};
const firstName = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || 'tudo bem';
/** Payload do botão: APPT:<id>:<ação>. */
export const buttonPayload = (appointmentId: string, action: (typeof ACTIONS)[number]) => `APPT:${appointmentId}:${action}`;

export class ConfirmationService {
  constructor(
    private readonly repos: Repos,
    private readonly integrations: IntegrationService,
    private readonly funnel: FunnelService,
    private readonly clock: Clock,
  ) {}

  async settings(): Promise<ConfirmationSettings> {
    return { ...DEFAULT_CONFIRMATION_SETTINGS, ...((await this.repos.settings.get<Partial<ConfirmationSettings>>(CONFIRMATION_SETTINGS_KEY)) ?? {}) };
  }

  async saveSettings(patch: Partial<Pick<ConfirmationSettings, 'enabled' | 'sendHour'>>) {
    const next = { ...(await this.settings()), ...patch };
    await this.repos.settings.set(CONFIRMATION_SETTINGS_KEY, next);
    return next;
  }

  private async clinicName() {
    const t = await this.repos.settings.get<{ clinicName?: string }>(TEMPLATES_KEY);
    return t?.clinicName?.trim() || DEFAULT_TEMPLATES.clinicName;
  }

  private async provider() {
    const p = await this.integrations.getYCloud();
    if (!p) throw new DomainError('WHATSAPP_NOT_CONNECTED', 'Conecte o WhatsApp pelo YCloud em Integrações primeiro.');
    return p;
  }

  /** Situação para a tela: conexão, modelo e configuração. */
  async status() {
    const s = await this.settings();
    const p = await this.integrations.getYCloud();
    let template: { status: string; reason: string | null } | null = null;
    let templateError: string | null = null;
    if (p) {
      try {
        const t = await p.findTemplate(s.templateName, s.language);
        template = t ? { status: String(t.status ?? 'PENDING'), reason: t.reason && String(t.reason).toUpperCase() !== 'NONE' ? String(t.reason) : null } : null;
      } catch (e) {
        templateError = (e as Error).message;
      }
    }
    const body = s.templateBody ?? templateBodyFor(await this.clinicName());
    return { connected: !!p, settings: s, template, templateError, body, buttons: TEMPLATE_BUTTONS };
  }

  /** Cria o modelo na Meta (via YCloud). A aprovação costuma levar de minutos a 24 h. */
  async createTemplate() {
    const s = await this.settings();
    const p = await this.provider();
    const existing = await p.findTemplate(s.templateName, s.language).catch(() => null);
    if (existing) return { status: String(existing.status), reason: existing.reason ?? null, alreadyExists: true };
    const body = templateBodyFor(await this.clinicName());
    let t: any;
    try {
      t = await p.createTemplate({
        name: s.templateName,
        language: s.language,
        category: 'UTILITY',
        components: [
          { type: 'BODY', text: body, example: { body_text: [['Mariana', 'Botox', '18/11', '14:00']] } },
          { type: 'BUTTONS', buttons: TEMPLATE_BUTTONS.map((text) => ({ type: 'QUICK_REPLY', text })) },
        ],
      });
    } catch (e) {
      throw new DomainError('WHATSAPP_TEMPLATE', `Não foi possível criar o modelo: ${(e as any)?.userMessage ?? (e as Error).message}`, 502);
    }
    await this.repos.settings.set(CONFIRMATION_SETTINGS_KEY, { ...s, templateBody: body });
    return { status: String(t?.status ?? 'PENDING'), reason: t?.reason ?? null, alreadyExists: false };
  }

  /** Envia a confirmação de um agendamento. `force` reenvia mesmo se já foi enviada. */
  async send(appointmentId: string, opts: { force?: boolean } = {}): Promise<Appointment> {
    const appt = await this.repos.appointments.findById(appointmentId);
    if (!appt) throw new DomainError('NOT_FOUND', 'Agendamento não encontrado', 404);
    if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') throw new DomainError('APPOINTMENT_CLOSED', 'Este agendamento não está em aberto');
    if (appt.scheduledFor.getTime() < this.clock.now().getTime()) throw new DomainError('APPOINTMENT_DONE', 'Este horário já passou');
    const lead = await this.repos.leads.findById(appt.leadId);
    const contact = lead ? await this.repos.contacts.findById(lead.contactId) : null;
    if (!contact?.waId) throw new DomainError('NO_PHONE', 'Paciente sem WhatsApp cadastrado');
    const s = await this.settings();
    const p = await this.provider();

    const now = this.clock.now();
    if (opts.force) await this.repos.appointments.update(appointmentId, { confirmationSentAt: null });
    if (!(await this.repos.appointments.claimConfirmation(appointmentId, now))) return (await this.repos.appointments.findById(appointmentId))!;

    const procedure = appt.procedureId ? await this.repos.procedures.findById(appt.procedureId) : null;
    const nome = firstName(contact.name ?? contact.profileName);
    const vars = [nome, procedure?.name ?? 'avaliação', ddmm(appt.scheduledFor), hhmm(appt.scheduledFor)];
    const body = s.templateBody ?? templateBodyFor(await this.clinicName());
    try {
      const sent = await p.sendTemplate(contact.waId, s.templateName, s.language, [
        { type: 'body', parameters: vars.map((text) => ({ type: 'text' as const, text })) },
        ...ACTIONS.map((a, index) => ({ type: 'button' as const, sub_type: 'quick_reply' as const, index, parameters: [{ type: 'payload' as const, payload: buttonPayload(appointmentId, a) }] })),
      ], appointmentId);
      const waMessageId = sent.wamid ?? `ycloud:${sent.id}`;
      await this.repos.tx((r) =>
        recordMessage(r, {
          waMessageId,
          contactId: contact.id,
          direction: 'OUTBOUND',
          source: 'CLOUD_API',
          type: 'template',
          body: body.replace(/\{\{(\d)\}\}/g, (_m, i) => vars[Number(i) - 1] ?? ''),
          occurredAt: now,
          receivedAt: now,
        }),
      );
      return this.repos.appointments.update(appointmentId, { confirmationMessageId: waMessageId, confirmationError: null });
    } catch (e) {
      const msg = (e as any)?.userMessage ?? (e as Error).message;
      await this.repos.appointments.update(appointmentId, { confirmationSentAt: null, confirmationError: String(msg).slice(0, 300) });
      throw new DomainError('WHATSAPP_SEND', `Não foi possível enviar: ${msg}`);
    }
  }

  /**
   * Rotina diária: na véspera, a partir da hora escolhida (até 20h), envia a confirmação
   * de cada agendamento de amanhã que ainda não recebeu. Pode rodar várias vezes sem duplicar.
   */
  async runDue(): Promise<{ sent: number; failed: number; skipped: string | null }> {
    const s = await this.settings();
    if (!s.enabled) return { sent: 0, failed: 0, skipped: 'desligado' };
    if (!(await this.integrations.getYCloud())) return { sent: 0, failed: 0, skipped: 'WhatsApp não conectado' };
    const now = this.clock.now();
    const hour = new Date(now.getTime() - SP_OFFSET_MS).getUTCHours();
    if (hour < s.sendHour || hour >= 20) return { sent: 0, failed: 0, skipped: 'fora do horário' };
    const tomorrow = addDays(spDay(now), 1);
    const from = new Date(dayToDate(tomorrow).getTime() - 12 * 3_600_000); // 00:00 SP
    const to = new Date(from.getTime() + 86_400_000);
    let sent = 0;
    let failed = 0;
    for (const a of await this.repos.appointments.listScheduledBetween({ from, to })) {
      if (a.status !== 'SCHEDULED' || a.confirmationSentAt || a.patientResponse) continue;
      try {
        await this.send(a.id);
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, failed, skipped: null };
  }

  /** Toque da paciente num botão da confirmação. Devolve o que foi feito (ou null se não era nosso botão). */
  async handleButton(evt: InboundMessageEvent): Promise<string | null> {
    const m = /^APPT:([^:]+):(CONFIRM|RESCHEDULE|CANCEL)$/.exec(evt.buttonPayload ?? '');
    if (!m) return null;
    const [, appointmentId, action] = m as unknown as [string, string, (typeof ACTIONS)[number]];
    const appt = await this.repos.appointments.findById(appointmentId);
    if (!appt) return 'botão de agendamento inexistente';
    let reply: string;
    const lead = await this.repos.leads.findById(appt.leadId);
    const contact = lead ? await this.repos.contacts.findById(lead.contactId) : null;
    const nome = firstName(contact?.name ?? contact?.profileName ?? evt.profileName);
    try {
      await this.funnel.patientRespond(appointmentId, action, null, 'whatsapp');
      reply = REPLIES[action](nome);
    } catch (e) {
      reply = `${(e as Error).message} Se precisar, fale com a gente por aqui.`;
    }
    const to = contact?.waId ?? evt.fromWaId;
    const p = await this.integrations.getYCloud();
    if (p && to) {
      try {
        const sent = await p.sendText(to, reply);
        const now = this.clock.now();
        if (contact) {
          await this.repos.tx((r) =>
            recordMessage(r, {
              waMessageId: sent.wamid ?? `ycloud:${sent.id}`,
              contactId: contact.id,
              direction: 'OUTBOUND',
              source: 'CLOUD_API',
              type: 'text',
              body: reply,
              occurredAt: now,
              receivedAt: now,
            }),
          );
        }
      } catch {
        // A resposta automática é cortesia: a Agenda já foi atualizada.
      }
    }
    return `paciente respondeu ${action} pelo WhatsApp (agendamento ${appointmentId})`;
  }
}
