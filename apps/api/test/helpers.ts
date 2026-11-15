import { randomBytes } from 'node:crypto';
import { AttributionEngine } from '../src/modules/attribution/AttributionEngine.js';
import { AccountsService } from '../src/modules/finance/accounts.js';
import { FinanceService } from '../src/modules/finance/FinanceService.js';
import { FunnelService } from '../src/modules/funnel/FunnelService.js';
import { MetricsService } from '../src/modules/metrics/MetricsService.js';
import { MetaSyncService, META_SYNC_JOB } from '../src/modules/meta/MetaSyncService.js';
import { CloudApiAdapter } from '../src/modules/whatsapp/adapters/CloudApiAdapter.js';
import { signMetaPayload } from '../src/modules/whatsapp/webhookSignature.js';
import { PROCESS_EVENT_JOB, WebhookIngestionService } from '../src/modules/whatsapp/WebhookIngestionService.js';
import { WhatsAppEventProcessor } from '../src/modules/whatsapp/WhatsAppEventProcessor.js';
import { CredentialVault } from '../src/infra/crypto/CredentialVault.js';
import { IntegrationService } from '../src/modules/integrations/IntegrationService.js';
import { MemoryRepos } from '../src/infra/memory/MemoryRepos.js';
import { InMemoryJobQueue } from '../src/queue/InMemoryJobQueue.js';
import { Worker } from '../src/queue/Worker.js';
import { FixedClock } from '../src/shared/ids.js';
import type { HttpClient, HttpResponse } from '../src/shared/http.js';

export const APP_SECRET = 'test-app-secret';
export const PHONE_NUMBER_ID = '1098765432';
export const WABA_ID = '2223334445';
export const BUSINESS_PHONE = '5511900000000';

export class FakeHttp implements HttpClient {
  calls: string[] = [];
  requests: { url: string; init?: { method: string; headers?: Record<string, string>; body?: unknown } }[] = [];
  handler: (url: string) => HttpResponse | Promise<HttpResponse> = () => ({ status: 200, json: { data: [] } });
  async request(url: string, init?: { method: 'GET' | 'POST' | 'DELETE'; headers?: Record<string, string>; body?: unknown }): Promise<HttpResponse> {
    this.calls.push(url);
    this.requests.push({ url, init });
    return this.handler(url);
  }
}

export function buildWorld(start = '2026-11-02T12:00:00.000Z') {
  const repos = new MemoryRepos();
  const clock = new FixedClock(new Date(start));
  const queue = new InMemoryJobQueue();
  const http = new FakeHttp();
  const vault = new CredentialVault(randomBytes(32).toString('base64'));
  const engine = new AttributionEngine(repos, clock, { reopenAfterDays: 30 });
  const processor = new WhatsAppEventProcessor(repos, engine, queue, clock, 'HOMOLOG');
  const ingestion = new WebhookIngestionService(repos, queue, clock, 'HOMOLOG');
  const funnel = new FunnelService(repos, clock);
  const metrics = new MetricsService(repos);
  const finance = new FinanceService(repos);
  const accounts = new AccountsService(repos);
  const metaSync = new MetaSyncService(repos, vault, http, clock, 'HOMOLOG', 'v23.0', engine, 'https://graph.test');
  const integrations = new IntegrationService(repos, vault, http, clock, 'HOMOLOG', {
    graphVersion: 'v23.0',
    appSecret: APP_SECRET,
    verifyToken: 'verify',
    publicUrl: 'https://api.test',
  });
  const provider = new CloudApiAdapter(
    { graphVersion: 'v23.0', appSecret: APP_SECRET, accessToken: 'x', phoneNumberId: PHONE_NUMBER_ID, wabaId: WABA_ID, coexistence: true },
    http,
  );
  const worker = new Worker(queue, clock)
    .register(PROCESS_EVENT_JOB, (p, job) => processor.handleJob(p, job))
    .register(META_SYNC_JOB, () => metaSync.sync().then(() => undefined));

  /** Entrega um webhook assinado como a Meta faria. */
  async function deliver(payload: unknown, opts: { sign?: boolean } = {}) {
    const raw = Buffer.from(JSON.stringify(payload));
    const headers: Record<string, string> = {};
    if (opts.sign !== false) headers['x-hub-signature-256'] = signMetaPayload(raw, APP_SECRET);
    return ingestion.ingest(provider, raw, headers);
  }

  return { repos, clock, queue, http, vault, engine, processor, ingestion, funnel, metrics, finance, accounts, metaSync, integrations, provider, worker, deliver };
}

export type World = ReturnType<typeof buildWorld>;

export const actor = { id: 'usr_recepcao' };

const unix = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));

function envelope(field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field,
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: PHONE_NUMBER_ID },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

export function inboundMessage(o: {
  id: string;
  from: string;
  at: string;
  text?: string;
  name?: string;
  adId?: string;
  postId?: string;
}) {
  const referral = o.adId
    ? {
        source_url: `https://fb.me/${o.adId}`,
        source_id: o.adId,
        source_type: 'ad',
        headline: 'Avaliação gratuita',
        body: 'Agende sua avaliação',
        media_type: 'image',
        ctwa_clid: `clid-${o.id}`,
      }
    : o.postId
      ? { source_url: 'https://fb.me/post', source_id: o.postId, source_type: 'post' }
      : undefined;
  return envelope('messages', {
    contacts: [{ profile: { name: o.name ?? 'Paciente' }, wa_id: o.from }],
    messages: [
      {
        from: o.from,
        id: o.id,
        timestamp: unix(o.at),
        type: 'text',
        text: { body: o.text ?? 'Olá, gostaria de informações' },
        ...(referral ? { referral } : {}),
      },
    ],
  });
}

export function businessEcho(o: { id: string; to: string; at: string; text?: string }) {
  return envelope('smb_message_echoes', {
    message_echoes: [{ from: BUSINESS_PHONE, to: o.to, id: o.id, timestamp: unix(o.at), type: 'text', text: { body: o.text ?? 'Olá! Como posso ajudar?' } }],
  });
}

export function statusUpdate(o: { id: string; status: string; at: string; recipient: string }) {
  return envelope('messages', {
    statuses: [{ id: o.id, status: o.status, timestamp: unix(o.at), recipient_id: o.recipient }],
  });
}

export function contactSync(o: { phone: string; name: string; at: string; action?: 'add' | 'remove' }) {
  return envelope('smb_app_state_sync', {
    state_sync: [
      {
        type: 'contact',
        contact: { full_name: o.name, first_name: o.name.split(' ')[0], phone_number: o.phone },
        action: o.action ?? 'add',
        metadata: { timestamp: unix(o.at) },
      },
    ],
  });
}

export function historyChunk(o: { contact: string; messages: { id: string; at: string; fromBusiness?: boolean; text: string }[] }) {
  return envelope('history', {
    history: [
      {
        metadata: { phase: 0, chunk_order: 1, progress: 100 },
        threads: [
          {
            id: o.contact,
            messages: o.messages.map((m) => ({
              from: m.fromBusiness ? BUSINESS_PHONE : o.contact,
              ...(m.fromBusiness ? { to: o.contact } : {}),
              id: m.id,
              timestamp: unix(m.at),
              type: 'text',
              text: { body: m.text },
              history_context: { status: 'read' },
            })),
          },
        ],
      },
    ],
  });
}

export function accountUpdate(event: string, reason?: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA_ID,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'account_update',
            value: { event, ...(reason ? { disconnection_info: { reason, initiated_by: 'USER' } } : {}) },
          },
        ],
      },
    ],
  };
}

/** Cadastra anúncio/conjunto/campanha como se tivessem vindo da Meta. */
export async function seedAd(w: World, adId = 'AD-100', name = 'Botox - Avaliação') {
  await w.repos.ads.upsertCampaign({ metaId: 'CMP-1', name: 'Campanha Harmonização', status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT' });
  await w.repos.ads.upsertAdSet({ metaId: 'SET-1', campaignMetaId: 'CMP-1', name: 'Mulheres 30-55 SP', status: 'ACTIVE' });
  await w.repos.ads.upsertAd({ metaId: adId, adSetMetaId: 'SET-1', campaignMetaId: 'CMP-1', name, status: 'ACTIVE' });
}

export async function seedProcedure(w: World, name = 'Toxina botulínica', price = 120000) {
  return w.repos.procedures.create({ name, defaultPriceCents: price, active: true });
}

export const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });
