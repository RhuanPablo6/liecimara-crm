import { PermanentError, RetryableError } from '../../domain/errors.js';
import type { IntegrationEnvironment, IntegrationProvider } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import type { JobQueue, JobRecord } from '../../queue/JobQueue.js';
import type { Clock } from '../../shared/ids.js';
import type { AttributionEngine, AttributionResult } from '../attribution/AttributionEngine.js';
import { recordMessage, resolveContact } from '../messaging/MessageLog.js';
import type {
  AccountUpdateEvent,
  BusinessEchoEvent,
  ContactSyncEvent,
  HistoryMessageEvent,
  HistoryProgressEvent,
  MessageStatusEvent,
  NormalizedEvent,
} from './events.js';
import { PROCESS_EVENT_JOB } from './WebhookIngestionService.js';

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, played: 3, failed: 4 };

const DISCONNECT_EVENTS = new Set(['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED', 'ACCOUNT_DELETED', 'DISABLED_UPDATE']);
const RECONNECT_EVENTS = new Set(['ACCOUNT_RECONNECTED', 'PARTNER_ADDED']);

export type ProcessOutcome =
  | { kind: 'MESSAGE_INBOUND'; attribution: AttributionResult }
  | { kind: Exclude<NormalizedEvent['kind'], 'MESSAGE_INBOUND'>; detail: string };

/**
 * Processa um evento normalizado já gravado em `inbound_events`.
 * Idempotente: reprocessar o mesmo evento não duplica dados.
 */
export class WhatsAppEventProcessor {
  /** Trata o toque da paciente num botão (confirmação de agendamento). Ligado no container. */
  buttonHandler: ((evt: import('./events.js').InboundMessageEvent) => Promise<string | null>) | null = null;

  constructor(
    private readonly repos: Repos,
    private readonly engine: AttributionEngine,
    private readonly queue: JobQueue,
    private readonly clock: Clock,
    private readonly env: IntegrationEnvironment,
  ) {}

  /** Handler do job PROCESS_EVENT_JOB. */
  async handleJob(payload: { eventId: string }, job: JobRecord): Promise<void> {
    const ev = await this.repos.events.findById(payload.eventId);
    if (!ev) throw new PermanentError(`evento ${payload.eventId} inexistente`);
    if (ev.status === 'PROCESSED' || ev.status === 'IGNORED') return;

    await this.repos.events.update(ev.id, { status: 'PROCESSING', attempts: ev.attempts + 1 });
    try {
      const outcome = await this.dispatch(ev.provider, ev.payload as NormalizedEvent, job);
      const ignored = outcome.kind !== 'MESSAGE_INBOUND' && outcome.detail.startsWith('ignorado');
      await this.repos.events.update(ev.id, {
        status: ignored ? 'IGNORED' : 'PROCESSED',
        processedAt: this.clock.now(),
        lastError: ignored ? (outcome as { detail: string }).detail : null,
      });
    } catch (err) {
      const last = err instanceof PermanentError || job.attempts >= job.maxAttempts;
      await this.repos.events.update(ev.id, {
        status: last ? 'DEAD' : 'FAILED',
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Reprocessamento manual (tela de diagnóstico). */
  async reprocess(eventId: string): Promise<void> {
    const ev = await this.repos.events.findById(eventId);
    if (!ev) throw new PermanentError('evento inexistente');
    await this.repos.events.update(eventId, { status: 'RECEIVED', lastError: null });
    await this.queue.enqueue(PROCESS_EVENT_JOB, { eventId }, { dedupKey: `evt:${eventId}:re:${Date.now()}` });
  }

  async dispatch(provider: IntegrationProvider, evt: NormalizedEvent, job?: JobRecord): Promise<ProcessOutcome> {
    switch (evt.kind) {
      case 'MESSAGE_INBOUND': {
        const attribution = await this.engine.processInboundMessage(evt);
        if (evt.buttonPayload && this.buttonHandler) await this.buttonHandler(evt);
        return { kind: evt.kind, attribution };
      }
      case 'MESSAGE_ECHO':
        return { kind: evt.kind, detail: await this.onEcho(evt) };
      case 'MESSAGE_STATUS':
        return { kind: evt.kind, detail: await this.onStatus(evt, job) };
      case 'CONTACT_SYNC':
        return { kind: evt.kind, detail: await this.onContactSync(evt) };
      case 'HISTORY_MESSAGE':
        return { kind: evt.kind, detail: await this.onHistoryMessage(evt) };
      case 'HISTORY_PROGRESS':
        return { kind: evt.kind, detail: await this.onHistoryProgress(provider, evt) };
      case 'ACCOUNT_UPDATE':
        return { kind: evt.kind, detail: await this.onAccountUpdate(provider, evt) };
      default:
        return { kind: 'UNKNOWN', detail: 'ignorado: tipo não tratado' };
    }
  }

  /** Mensagem enviada pela recepção no app WhatsApp Business. */
  private async onEcho(evt: BusinessEchoEvent): Promise<string> {
    return this.repos.tx(async (r) => {
      const at = new Date(evt.occurredAt);
      if (!evt.toWaId && !evt.toBsuid) return 'ignorado: echo sem destinatário';
      const { contact } = await resolveContact(r, { waId: evt.toWaId, bsuid: evt.toBsuid }, at);
      const rec = await recordMessage(r, {
        waMessageId: evt.waMessageId,
        contactId: contact.id,
        direction: 'OUTBOUND',
        source: 'BUSINESS_APP',
        type: evt.type,
        body: evt.text,
        occurredAt: at,
        receivedAt: this.clock.now(),
      });
      if (rec.duplicate) return 'duplicado';
      const lead = await r.leads.findOpenByContact(contact.id);
      if (lead && at >= lead.openedAt) {
        await this.engine.advanceToContacted(r, lead, at, 'resposta enviada pelo app WhatsApp Business');
        return `resposta registrada no lead ${lead.id}`;
      }
      return 'mensagem registrada (sem lead aberto)';
    });
  }

  private async onStatus(evt: MessageStatusEvent, job?: JobRecord): Promise<string> {
    const msg = await this.repos.messages.findByWaMessageId(evt.waMessageId);
    if (!msg) {
      // Status pode chegar antes da mensagem (fora de ordem). Tenta de novo algumas vezes.
      if (job && job.attempts < job.maxAttempts) throw new RetryableError('mensagem do status ainda não registrada');
      return 'ignorado: status de mensagem não registrada no CRM';
    }
    const cur = STATUS_RANK[msg.status ?? ''] ?? 0;
    const next = STATUS_RANK[evt.status] ?? 0;
    // Nunca regredir status (ex.: "delivered" chegando depois de "read").
    if (next > cur) await this.repos.messages.update(msg.id, { status: evt.status });
    return next > cur ? `status ${evt.status}` : `status ${evt.status} mais antigo que ${msg.status}; mantido`;
  }

  /** Contatos do app (coexistência): cadastram contatos pré-existentes sem criar leads. */
  private async onContactSync(evt: ContactSyncEvent): Promise<string> {
    return this.repos.tx(async (r) => {
      const at = new Date(evt.occurredAt);
      const { contact, isNew } = await resolveContact(
        r,
        { waId: evt.phone, bsuid: evt.bsuid, name: evt.fullName ?? evt.firstName },
        at,
        { preExisting: true, touchLastMessage: false },
      );
      if (evt.action === 'remove') {
        await r.contacts.update(contact.id, { removedFromAppAt: at });
        return 'contato removido no app';
      }
      if (evt.fullName && contact.name !== evt.fullName) await r.contacts.update(contact.id, { name: evt.fullName, removedFromAppAt: null });
      return isNew ? 'contato importado' : 'contato atualizado';
    });
  }

  /** Histórico do app: importa mensagens antigas; não cria leads (não há evidência de anúncio). */
  private async onHistoryMessage(evt: HistoryMessageEvent): Promise<string> {
    return this.repos.tx(async (r) => {
      const at = new Date(evt.occurredAt);
      const { contact } = await resolveContact(r, { waId: evt.contactWaId, bsuid: null }, at, { preExisting: true });
      if (!contact.preExisting) await r.contacts.update(contact.id, { preExisting: true });
      const rec = await recordMessage(r, {
        waMessageId: evt.waMessageId,
        contactId: contact.id,
        direction: evt.direction,
        source: 'HISTORY',
        type: evt.type,
        body: evt.text,
        occurredAt: at,
        status: evt.status,
        receivedAt: this.clock.now(),
      });
      return rec.duplicate ? 'duplicado' : 'histórico importado';
    });
  }

  private async onHistoryProgress(provider: IntegrationProvider, evt: HistoryProgressEvent): Promise<string> {
    const conn = await this.repos.connections.find(provider, this.env);
    const diag = (conn?.permissionsDiagnostic as Record<string, unknown> | null) ?? {};
    await this.repos.connections.upsert(provider, this.env, {
      permissionsDiagnostic: {
        ...diag,
        historySync: evt.declinedCode
          ? { status: 'DECLINED', detail: 'Compartilhamento de histórico recusado no app WhatsApp Business' }
          : { status: evt.progress === 100 ? 'COMPLETE' : 'IN_PROGRESS', phase: evt.phase, progress: evt.progress },
      },
      lastSyncAt: this.clock.now(),
    });
    return evt.declinedCode ? 'histórico recusado pela empresa' : `histórico ${evt.progress ?? '?'}%`;
  }

  private async onAccountUpdate(provider: IntegrationProvider, evt: AccountUpdateEvent): Promise<string> {
    if (DISCONNECT_EVENTS.has(evt.event)) {
      await this.repos.connections.upsert(provider, this.env, { status: 'DISCONNECTED' });
      await this.repos.connections.addError({
        connectionId: null,
        provider,
        code: evt.event,
        message: `Conexão encerrada pela Meta (${evt.event})${evt.reason ? ` — motivo: ${evt.reason}` : ''}${evt.initiatedBy ? `, iniciado por ${evt.initiatedBy}` : ''}`,
        context: evt,
      });
      return `desconectado: ${evt.event}`;
    }
    if (RECONNECT_EVENTS.has(evt.event)) {
      await this.repos.connections.upsert(provider, this.env, { status: 'CONNECTED' });
      return `reconectado: ${evt.event}`;
    }
    return `ignorado: account_update ${evt.event} sem efeito no CRM`;
  }
}
