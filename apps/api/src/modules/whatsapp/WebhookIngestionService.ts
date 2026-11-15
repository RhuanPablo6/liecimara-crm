import type { IntegrationEnvironment } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import type { JobQueue } from '../../queue/JobQueue.js';
import type { Clock } from '../../shared/ids.js';
import type { NormalizedEvent } from './events.js';
import type { WhatsAppProvider } from './WhatsAppProvider.js';

export const PROCESS_EVENT_JOB = 'whatsapp.process-event';

export interface IngestResult {
  httpStatus: 200 | 400 | 401;
  accepted: number;
  duplicates: number;
  ignored: number;
}

/** Tentativas por tipo de evento (status de mensagem desconhecida não precisa insistir muito). */
export const MAX_ATTEMPTS_BY_KIND: Partial<Record<NormalizedEvent['kind'], number>> = {
  MESSAGE_STATUS: 4,
  UNKNOWN: 1,
};

/**
 * Recebe o webhook: valida assinatura → normaliza → grava cada evento com chave
 * de deduplicação → enfileira o processamento. Responde rápido (a Meta reenvia
 * se não receber 200 em poucos segundos); o processamento pesado fica no worker.
 */
export class WebhookIngestionService {
  constructor(
    private readonly repos: Repos,
    private readonly queue: JobQueue,
    private readonly clock: Clock,
    private readonly env: IntegrationEnvironment,
  ) {}

  async ingest(provider: WhatsAppProvider, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<IngestResult> {
    const now = this.clock.now();

    if (!provider.verifySignature(rawBody, headers)) {
      await this.repos.connections.upsert(provider.id, this.env, { webhookStatus: 'SIGNATURE_FAILURES' });
      await this.repos.connections.addError({
        connectionId: null,
        provider: provider.id,
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook rejeitado: assinatura inválida ou ausente',
        context: { bytes: rawBody.length },
      });
      return { httpStatus: 401, accepted: 0, duplicates: 0, ignored: 0 };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { httpStatus: 400, accepted: 0, duplicates: 0, ignored: 0 };
    }

    const events = provider.normalize(payload);
    let accepted = 0;
    let duplicates = 0;
    let ignored = 0;

    for (const evt of events) {
      const row = await this.repos.events.insertIfNew({
        provider: provider.id,
        dedupKey: evt.dedupKey,
        kind: evt.kind,
        payload: evt,
        occurredAt: new Date(evt.occurredAt),
      });
      if (!row) {
        duplicates++;
        continue;
      }
      if (evt.kind === 'UNKNOWN') {
        await this.repos.events.update(row.id, { status: 'IGNORED', lastError: `campo não tratado: ${evt.field}` });
        ignored++;
        continue;
      }
      await this.queue.enqueue(
        PROCESS_EVENT_JOB,
        { eventId: row.id },
        { dedupKey: `evt:${row.id}`, maxAttempts: MAX_ATTEMPTS_BY_KIND[evt.kind] ?? 8 },
      );
      accepted++;
    }

    const phone = events.find((e) => e.phoneNumberId)?.phoneNumberId ?? undefined;
    await this.repos.connections.upsert(provider.id, this.env, {
      lastWebhookAt: now,
      webhookStatus: 'OK',
      ...(phone ? { phoneNumberId: phone } : {}),
    });

    return { httpStatus: 200, accepted, duplicates, ignored };
  }

  /**
   * Reenfileira eventos que ficaram RECEIVED sem job (ex.: queda entre gravar o
   * evento e enfileirar). Executado periodicamente pelo worker.
   */
  async sweepOrphans(olderThanMs = 5 * 60 * 1000): Promise<number> {
    const limit = this.clock.now().getTime() - olderThanMs;
    let n = 0;
    for (const e of await this.repos.events.list({ status: 'RECEIVED', limit: 500 })) {
      if (e.receivedAt.getTime() > limit) continue;
      const job = await this.queue.enqueue(PROCESS_EVENT_JOB, { eventId: e.id }, { dedupKey: `evt:${e.id}` });
      if (job) n++;
    }
    return n;
  }
}
