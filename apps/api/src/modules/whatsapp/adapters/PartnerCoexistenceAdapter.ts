import { createHmac, timingSafeEqual } from 'node:crypto';
import { GraphApiError, type HttpClient } from '../../../shared/http.js';
import type { NormalizedEvent } from '../events.js';
import type { PermissionCheck, PhoneNumberInfo, WhatsAppProvider } from '../WhatsAppProvider.js';
import { normalizeMetaWebhook } from './metaWebhookNormalizer.js';

/**
 * Adaptador genérico para Provedores de Soluções de Negócios (BSP) oficiais
 * que oferecem coexistência via Embedded Signup e repassam os webhooks no
 * formato da Meta (ex.: 360dialog, Gupshup em modo pass-through).
 *
 * Tudo que varia por parceiro fica em configuração: URL base, cabeçalho de
 * autenticação, forma de assinar o webhook e caminhos de API. Para parceiros
 * que transformam o payload (ex.: formato próprio), crie um novo adaptador
 * que implemente WhatsAppProvider — o restante da aplicação não muda.
 */
export interface PartnerConfig {
  partnerName: string;
  baseUrl: string; // ex.: https://waba-v2.360dialog.io
  authHeaderName: string; // ex.: D360-API-KEY ou Authorization
  authHeaderValue: string;
  phoneNumberId: string;
  /** Como o parceiro assina o webhook. */
  webhookAuth:
    | { mode: 'hmac-sha256'; header: string; secret: string; prefix?: string }
    | { mode: 'static-header'; header: string; value: string }
    | { mode: 'none-ip-allowlist' };
  paths?: {
    phoneInfo?: string; // relativo a baseUrl
    appDataSync?: string;
  };
  /** Caminho no JSON onde está o payload Meta (quando o parceiro envelopa). */
  envelopeKey?: string;
}

export class PartnerCoexistenceAdapter implements WhatsAppProvider {
  readonly id = 'WHATSAPP_COEXISTENCE_PARTNER' as const;
  readonly displayName: string;

  constructor(
    private readonly cfg: PartnerConfig,
    private readonly http: HttpClient,
  ) {
    this.displayName = `Parceiro oficial: ${cfg.partnerName}`;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const res = await this.http.request(`${this.cfg.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
      method,
      headers: { [this.cfg.authHeaderName]: this.cfg.authHeaderValue },
      body,
    });
    if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
    return res.json;
  }

  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const a = this.cfg.webhookAuth;
    const get = (h: string) => {
      const v = headers[h.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    if (a.mode === 'none-ip-allowlist') return true; // validação feita pela camada HTTP (lista de IPs)
    if (a.mode === 'static-header') {
      const v = get(a.header);
      if (!v) return false;
      const x = Buffer.from(v);
      const y = Buffer.from(a.value);
      return x.length === y.length && timingSafeEqual(x, y);
    }
    const given = get(a.header);
    if (!given) return false;
    const expected = (a.prefix ?? '') + createHmac('sha256', a.secret).update(rawBody).digest('hex');
    const x = Buffer.from(given);
    const y = Buffer.from(expected);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  normalize(payload: unknown): NormalizedEvent[] {
    const p = this.cfg.envelopeKey ? (payload as any)?.[this.cfg.envelopeKey] : payload;
    return normalizeMetaWebhook(p);
  }

  async getPhoneNumberInfo(): Promise<PhoneNumberInfo> {
    const j = await this.call('GET', this.cfg.paths?.phoneInfo ?? `${this.cfg.phoneNumberId}`);
    return {
      phoneNumberId: this.cfg.phoneNumberId,
      displayPhoneNumber: j?.display_phone_number ?? null,
      verifiedName: j?.verified_name ?? null,
      qualityRating: j?.quality_rating ?? null,
      platformType: j?.platform_type ?? null,
      isCoexistence: typeof j?.is_on_biz_app === 'boolean' ? j.is_on_biz_app : null,
      throughputLevel: j?.throughput?.level ?? null,
    };
  }

  async diagnosePermissions(): Promise<PermissionCheck[]> {
    try {
      const info = await this.getPhoneNumberInfo();
      return [
        { name: `Credencial do parceiro ${this.cfg.partnerName}`, ok: true, detail: 'aceita' },
        { name: 'Número acessível', ok: true, detail: info.displayPhoneNumber ?? this.cfg.phoneNumberId },
        {
          name: 'Webhooks de coexistência',
          ok: true,
          detail: 'Confirme no painel do parceiro: history, smb_app_state_sync, smb_message_echoes, account_update',
        },
      ];
    } catch (e) {
      return [{ name: `Credencial do parceiro ${this.cfg.partnerName}`, ok: false, detail: (e as Error).message }];
    }
  }

  async requestAppDataSync(kind: 'smb_app_state_sync' | 'history'): Promise<{ requestId: string | null }> {
    const j = await this.call('POST', this.cfg.paths?.appDataSync ?? `${this.cfg.phoneNumberId}/smb_app_data`, {
      messaging_product: 'whatsapp',
      sync_type: kind,
    });
    return { requestId: j?.request_id ?? null };
  }
}
