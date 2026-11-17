// YCloud: provedor oficial (BSP) com plano grátis e coexistência com o app WhatsApp Business.
// Webhooks no formato próprio do YCloud (envelope { id, type, createTime, whatsappInboundMessage | whatsappMessage })
// assinados com o cabeçalho YCloud-Signature: "t=<unix>,s=<hex hmac-sha256(t + '.' + corpo)>".
// Docs: https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/implement-a-webhook-receiver.md

import { createHmac, timingSafeEqual } from 'node:crypto';
import { GraphApiError, type HttpClient } from '../../../shared/http.js';
import type { NormalizedEvent } from '../events.js';
import type { PermissionCheck, PhoneNumberInfo, WhatsAppProvider } from '../WhatsAppProvider.js';
import { buttonPayloadOf, messageTextOf, referralOf } from './metaWebhookNormalizer.js';

export const YCLOUD_BASE_URL = 'https://api.ycloud.com/v2';
export const YCLOUD_EVENTS = [
  'whatsapp.inbound_message.received',
  'whatsapp.message.updated',
  'whatsapp.smb.message.echoes',
  'whatsapp.template.reviewed',
];
const SIGNATURE_TOLERANCE_S = 300;

export interface YCloudConfig {
  apiKey: string;
  webhookSecret: string;
  /** Número da clínica em E.164 (ex.: +5511959699628). */
  phoneNumber: string;
  wabaId: string | null;
}

export interface TemplateComponentParam {
  type: 'body' | 'button';
  sub_type?: 'quick_reply';
  index?: number;
  parameters: ({ type: 'text'; text: string } | { type: 'payload'; payload: string })[];
}

const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : null) || null;

/** Mensagem de erro da API do YCloud, quando vier. */
function ycloudError(status: number, body: any): GraphApiError {
  const e = body?.error ?? body ?? {};
  const wa = e?.whatsappApiError ?? body?.whatsappApiError ?? {};
  const parts = [e?.message, wa?.error_user_title, wa?.error_user_msg, wa?.message, e?.details?.[0]?.message]
    .filter((x): x is string => typeof x === 'string' && !!x.trim());
  const msg = [...new Set(parts)].join(' · ') || `HTTP ${status}`;
  return new GraphApiError(`YCloud: ${msg}`, status, typeof e?.code === 'number' ? e.code : null, null, status >= 500 || status === 429, `YCloud: ${msg}`);
}

export class YCloudAdapter implements WhatsAppProvider {
  readonly id = 'WHATSAPP_COEXISTENCE_PARTNER' as const;
  readonly displayName = 'Parceiro oficial: YCloud';

  constructor(
    private readonly cfg: YCloudConfig,
    private readonly http: HttpClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  static async call(http: HttpClient, apiKey: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<any> {
    const res = await http.request(`${YCLOUD_BASE_URL}/${path.replace(/^\//, '')}`, { method, headers: { 'X-API-Key': apiKey }, body });
    if (res.status >= 400) throw ycloudError(res.status, res.json);
    return res.json;
  }

  private call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
    return YCloudAdapter.call(this.http, this.cfg.apiKey, method, path, body);
  }

  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const raw = headers['ycloud-signature'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || !this.cfg.webhookSecret) return false;
    let t: string | null = null;
    const sigs: string[] = [];
    for (const part of header.split(',')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k === 't') t = v;
      else if (k === 's') sigs.push(v);
    }
    if (!t || !/^\d+$/.test(t)) return false;
    if (Math.abs(Math.floor(this.now() / 1000) - Number(t)) > SIGNATURE_TOLERANCE_S) return false;
    const digest = createHmac('sha256', this.cfg.webhookSecret).update(`${t}.`).update(rawBody).digest();
    return sigs.some((s) => /^[0-9a-f]{64}$/i.test(s) && timingSafeEqual(Buffer.from(s, 'hex'), digest));
  }

  normalize(payload: unknown): NormalizedEvent[] {
    const p = payload as any;
    if (!p || typeof p !== 'object' || typeof p.type !== 'string') return [];
    const occurredAt = (m: any) => m?.sendTime ?? m?.createTime ?? p.createTime ?? new Date(this.now()).toISOString();
    const phoneNumberId = this.cfg.phoneNumber || null;

    if (p.type === 'whatsapp.inbound_message.received') {
      const m = p.whatsappInboundMessage;
      if (!m) return [];
      const wamid = String(m.wamid ?? m.id);
      return [
        {
          kind: 'MESSAGE_INBOUND',
          dedupKey: `msg:${wamid}`,
          occurredAt: occurredAt(m),
          phoneNumberId,
          wabaId: m.wabaId ?? this.cfg.wabaId,
          waMessageId: wamid,
          fromWaId: digits(m.from),
          fromBsuid: m.fromUserId ?? null,
          profileName: m.customerProfile?.name ?? m.customerProfile?.username ?? null,
          type: m.type ?? 'unknown',
          text: messageTextOf(m),
          referral: referralOf(m),
          buttonPayload: buttonPayloadOf(m),
        },
      ];
    }

    if (p.type === 'whatsapp.smb.message.echoes') {
      const m = p.whatsappMessage;
      if (!m) return [];
      const wamid = String(m.wamid ?? m.id);
      return [
        {
          kind: 'MESSAGE_ECHO',
          dedupKey: `echo:${wamid}`,
          occurredAt: occurredAt(m),
          phoneNumberId,
          wabaId: m.wabaId ?? this.cfg.wabaId,
          waMessageId: wamid,
          toWaId: digits(m.to),
          toBsuid: m.toUserId ?? null,
          type: m.type ?? 'unknown',
          text: messageTextOf(m),
        },
      ];
    }

    if (p.type === 'whatsapp.message.updated') {
      const m = p.whatsappMessage;
      if (!m?.wamid || !m.status || m.status === 'accepted') return [];
      return [
        {
          kind: 'MESSAGE_STATUS',
          dedupKey: `status:${m.wamid}:${m.status}`,
          occurredAt: m.updateTime ?? occurredAt(m),
          phoneNumberId,
          wabaId: m.wabaId ?? this.cfg.wabaId,
          waMessageId: String(m.wamid),
          status: m.status,
          recipientWaId: digits(m.to),
          errors: m.errorCode ? [{ code: Number(m.errorCode) || 0, title: String(m.errorMessage ?? m.errorCode) }] : [],
          providerMessageId: m.id ? String(m.id) : null,
          externalId: m.externalId ? String(m.externalId) : null,
        },
      ];
    }

    return [{ kind: 'UNKNOWN', dedupKey: `yc:${p.id ?? `${p.type}:${p.createTime}`}`, occurredAt: p.createTime ?? new Date(this.now()).toISOString(), phoneNumberId, wabaId: this.cfg.wabaId, field: p.type }];
  }

  async getPhoneNumberInfo(): Promise<PhoneNumberInfo> {
    const j = await this.call('GET', 'whatsapp/phoneNumbers?limit=100');
    const n = (j?.items ?? []).find((x: any) => digits(x.phoneNumber) === digits(this.cfg.phoneNumber)) ?? null;
    return {
      phoneNumberId: this.cfg.phoneNumber,
      displayPhoneNumber: n?.displayPhoneNumber ?? this.cfg.phoneNumber,
      verifiedName: n?.verifiedName ?? null,
      qualityRating: n?.qualityRating ?? null,
      platformType: null,
      isCoexistence: true,
      throughputLevel: n?.throughputLevel ?? null,
    };
  }

  async diagnosePermissions(): Promise<PermissionCheck[]> {
    const checks: PermissionCheck[] = [];
    try {
      const j = await this.call('GET', 'whatsapp/phoneNumbers?limit=100');
      const n = (j?.items ?? []).find((x: any) => digits(x.phoneNumber) === digits(this.cfg.phoneNumber));
      checks.push({ name: 'Chave da API do YCloud', ok: true, detail: 'aceita' });
      checks.push({
        name: 'Número conectado no YCloud',
        ok: !!n && (n.status ?? 'CONNECTED') === 'CONNECTED',
        detail: n ? `${n.displayPhoneNumber ?? n.phoneNumber} · ${n.status ?? '—'}` : 'número não encontrado na conta',
      });
    } catch (e) {
      return [{ name: 'Chave da API do YCloud', ok: false, detail: (e as Error).message }];
    }
    try {
      const w = await this.call('GET', 'webhookEndpoints?limit=100');
      const mine = (w?.items ?? []).find((x: any) => x.secret === this.cfg.webhookSecret);
      checks.push({
        name: 'Webhook do CRM no YCloud',
        ok: !!mine && mine.status !== 'disabled',
        detail: mine ? `${mine.status} · ${(mine.enabledEvents ?? []).length} eventos` : 'não encontrado: conecte de novo em Integrações',
      });
    } catch (e) {
      checks.push({ name: 'Webhook do CRM no YCloud', ok: false, detail: (e as Error).message });
    }
    return checks;
  }

  async requestAppDataSync(): Promise<{ requestId: string | null }> {
    // No YCloud a sincronização do histórico é escolhida no próprio assistente de conexão.
    return { requestId: null };
  }

  // ---------- Envio ----------

  async sendTemplate(to: string, name: string, language: string, components: TemplateComponentParam[], externalId?: string) {
    const j = await this.call('POST', 'whatsapp/messages/sendDirectly', {
      from: `+${digits(this.cfg.phoneNumber)}`,
      to: `+${digits(to)}`,
      type: 'template',
      template: { name, language: { code: language }, components },
      ...(externalId ? { externalId } : {}),
    });
    if (j?.status === 'failed') throw new GraphApiError(j?.errorMessage ?? 'Falha no envio', 400, null, null, false, j?.errorMessage ?? null);
    return { id: String(j?.id ?? ''), wamid: j?.wamid ? String(j.wamid) : null, status: String(j?.status ?? 'accepted') };
  }

  /** Situação de uma mensagem enviada (aceita, enviada, entregue, lida ou falhou + motivo). */
  async getMessage(id: string) {
    const j = await this.call('GET', `whatsapp/messages/${encodeURIComponent(id)}`);
    return {
      id: String(j?.id ?? id),
      wamid: j?.wamid ? String(j.wamid) : null,
      status: String(j?.status ?? 'unknown'),
      errorCode: j?.errorCode != null ? Number(j.errorCode) || null : null,
      errorMessage: j?.errorMessage ? String(j.errorMessage) : null,
    };
  }

  async sendText(to: string, body: string) {
    const j = await this.call('POST', 'whatsapp/messages/sendDirectly', {
      from: `+${digits(this.cfg.phoneNumber)}`,
      to: `+${digits(to)}`,
      type: 'text',
      text: { body },
    });
    return { id: String(j?.id ?? ''), wamid: j?.wamid ? String(j.wamid) : null, status: String(j?.status ?? 'accepted') };
  }

  /** WABA do número (guardada na conexão; se faltar, consulta o YCloud). */
  async wabaId(): Promise<string> {
    if (this.cfg.wabaId) return this.cfg.wabaId;
    const j = await this.call('GET', 'whatsapp/phoneNumbers?limit=100');
    const n = (j?.items ?? []).find((x: any) => digits(x.phoneNumber) === digits(this.cfg.phoneNumber));
    if (!n?.wabaId) throw new GraphApiError('Conta do WhatsApp (WABA) não encontrada no YCloud', 400, null, null, false, 'Conta do WhatsApp (WABA) não encontrada no YCloud');
    return String(n.wabaId);
  }

  async createTemplate(t: { name: string; language: string; category: 'UTILITY'; components: unknown[] }) {
    return this.call('POST', 'whatsapp/templates', { wabaId: await this.wabaId(), ...t });
  }

  async findTemplate(name: string, language: string) {
    const q = new URLSearchParams({ 'filter.name': name, 'filter.language': language, limit: '10' });
    q.set('filter.wabaId', await this.wabaId());
    const j = await this.call('GET', `whatsapp/templates?${q}`);
    return (j?.items ?? [])[0] ?? null;
  }
}
