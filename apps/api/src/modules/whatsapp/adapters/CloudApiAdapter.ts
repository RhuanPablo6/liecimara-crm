import { GraphApiError, type HttpClient } from '../../../shared/http.js';
import type { NormalizedEvent } from '../events.js';
import { verifyMetaSignature } from '../webhookSignature.js';
import {
  COEXISTENCE_WEBHOOK_FIELDS,
  REQUIRED_WEBHOOK_FIELDS,
  type PermissionCheck,
  type PhoneNumberInfo,
  type WhatsAppProvider,
} from '../WhatsAppProvider.js';
import { normalizeMetaWebhook } from './metaWebhookNormalizer.js';

export interface CloudApiConfig {
  graphVersion: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  coexistence: boolean;
  baseUrl?: string;
}

/** Adaptador oficial: WhatsApp Cloud API diretamente na Graph API da Meta. */
export class CloudApiAdapter implements WhatsAppProvider {
  readonly id = 'WHATSAPP_CLOUD_API' as const;
  readonly displayName = 'WhatsApp Cloud API (Meta)';

  constructor(
    private readonly cfg: CloudApiConfig,
    private readonly http: HttpClient,
  ) {}

  private url(path: string) {
    return `${this.cfg.baseUrl ?? 'https://graph.facebook.com'}/${this.cfg.graphVersion}/${path}`;
  }

  private async graph(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const res = await this.http.request(this.url(path), {
      method,
      headers: { authorization: `Bearer ${this.cfg.accessToken}` },
      body,
    });
    if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
    return res.json;
  }

  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const h = headers['x-hub-signature-256'];
    return verifyMetaSignature(rawBody, Array.isArray(h) ? h[0] : h, this.cfg.appSecret);
  }

  normalize(payload: unknown): NormalizedEvent[] {
    return normalizeMetaWebhook(payload);
  }

  async getPhoneNumberInfo(): Promise<PhoneNumberInfo> {
    const j = await this.graph(
      'GET',
      `${this.cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,platform_type,throughput,is_on_biz_app`,
    );
    return {
      phoneNumberId: this.cfg.phoneNumberId,
      displayPhoneNumber: j.display_phone_number ?? null,
      verifiedName: j.verified_name ?? null,
      qualityRating: j.quality_rating ?? null,
      platformType: j.platform_type ?? null,
      isCoexistence: typeof j.is_on_biz_app === 'boolean' ? j.is_on_biz_app : null,
      throughputLevel: j.throughput?.level ?? null,
    };
  }

  async diagnosePermissions(): Promise<PermissionCheck[]> {
    const checks: PermissionCheck[] = [];
    // 1. Token e escopos
    try {
      const dbg = await this.graph(
        'GET',
        `debug_token?input_token=${encodeURIComponent(this.cfg.accessToken)}`,
      );
      const scopes: string[] = dbg?.data?.scopes ?? [];
      for (const s of ['whatsapp_business_management', 'whatsapp_business_messaging']) {
        checks.push({ name: `Escopo ${s}`, ok: scopes.includes(s), detail: scopes.includes(s) ? 'concedido' : 'ausente no token' });
      }
      const exp = dbg?.data?.expires_at;
      checks.push({
        name: 'Validade do token',
        ok: dbg?.data?.is_valid === true,
        detail: exp === 0 ? 'token sem expiração (usuário do sistema)' : exp ? `expira em ${new Date(exp * 1000).toISOString()}` : 'desconhecida',
      });
    } catch (e) {
      checks.push({ name: 'Token de acesso', ok: false, detail: (e as Error).message });
    }
    // 2. App inscrito na WABA (necessário para receber webhooks)
    try {
      const subs = await this.graph('GET', `${this.cfg.wabaId}/subscribed_apps`);
      const ok = Array.isArray(subs?.data) && subs.data.length > 0;
      checks.push({ name: 'App inscrito na conta WhatsApp (WABA)', ok, detail: ok ? 'inscrito' : 'nenhum app inscrito — use "Reinscrever webhooks"' });
    } catch (e) {
      checks.push({ name: 'Inscrição de webhooks', ok: false, detail: (e as Error).message });
    }
    // 3. Número acessível
    try {
      const info = await this.getPhoneNumberInfo();
      checks.push({ name: 'Número acessível pela API', ok: true, detail: `${info.displayPhoneNumber} (${info.platformType ?? 'n/d'})` });
      if (this.cfg.coexistence) {
        checks.push({
          name: 'Coexistência com app WhatsApp Business',
          ok: info.isCoexistence !== false,
          detail: info.isCoexistence === null ? 'não informado pela API' : info.isCoexistence ? 'ativa' : 'número não está no app',
        });
      }
    } catch (e) {
      checks.push({ name: 'Número acessível pela API', ok: false, detail: (e as Error).message });
    }
    checks.push({
      name: 'Campos de webhook necessários',
      ok: true,
      detail: `Assinar no app Meta: ${[...REQUIRED_WEBHOOK_FIELDS, ...(this.cfg.coexistence ? COEXISTENCE_WEBHOOK_FIELDS : [])].join(', ')}`,
    });
    return checks;
  }

  async requestAppDataSync(kind: 'smb_app_state_sync' | 'history'): Promise<{ requestId: string | null }> {
    const j = await this.graph('POST', `${this.cfg.phoneNumberId}/smb_app_data`, {
      messaging_product: 'whatsapp',
      sync_type: kind,
    });
    return { requestId: j?.request_id ?? null };
  }

  /** Reinscreve o app na WABA (parte do procedimento de reconexão). */
  async subscribeApp(): Promise<void> {
    await this.graph('POST', `${this.cfg.wabaId}/subscribed_apps`);
  }
}
