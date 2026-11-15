import { GraphApiError, type HttpClient } from '../../shared/http.js';

export interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
}
export interface MetaAdSet {
  id: string;
  name: string;
  status?: string;
  campaign_id: string;
}
export interface MetaAd {
  id: string;
  name: string;
  status?: string;
  adset_id: string;
  campaign_id: string;
}
export interface MetaInsightRow {
  ad_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  account_currency?: string;
  actions?: { action_type: string; value: string }[];
}

export interface MetaAdAccount {
  id: string; // "act_123"
  account_id: string; // "123"
  name: string;
  account_status?: number; // 1 = ativa
}

export const MESSAGING_STARTED_ACTION = 'onsite_conversion.messaging_conversation_started_7d';

/** Cliente da Meta Marketing API (somente leitura: campanhas, anúncios e investimento). */
export class MetaMarketingClient {
  constructor(
    private readonly http: HttpClient,
    private readonly accessToken: string,
    private readonly graphVersion: string,
    private readonly baseUrl = 'https://graph.facebook.com',
  ) {}

  private act(adAccountId: string) {
    return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  }

  private async getAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const qs = new URLSearchParams({ ...params, limit: params.limit ?? '200' });
    let url: string | null = `${this.baseUrl}/${this.graphVersion}/${path}?${qs}`;
    const out: T[] = [];
    let guard = 0;
    while (url && guard++ < 200) {
      const res = await this.http.request(url, { method: 'GET', headers: { authorization: `Bearer ${this.accessToken}` } });
      if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
      const body = res.json as { data?: T[]; paging?: { next?: string } };
      out.push(...(body.data ?? []));
      url = body.paging?.next ?? null;
    }
    return out;
  }

  /** Contas de anúncios a que o token tem acesso (usuário do sistema ou pessoa). */
  listAdAccounts() {
    return this.getAll<MetaAdAccount>('me/adaccounts', { fields: 'id,account_id,name,account_status' });
  }

  listCampaigns(adAccountId: string) {
    return this.getAll<MetaCampaign>(`${this.act(adAccountId)}/campaigns`, { fields: 'id,name,status,objective' });
  }

  listAdSets(adAccountId: string) {
    return this.getAll<MetaAdSet>(`${this.act(adAccountId)}/adsets`, { fields: 'id,name,status,campaign_id' });
  }

  listAds(adAccountId: string) {
    return this.getAll<MetaAd>(`${this.act(adAccountId)}/ads`, { fields: 'id,name,status,adset_id,campaign_id' });
  }

  insightsByAdDaily(adAccountId: string, since: string, until: string) {
    return this.getAll<MetaInsightRow>(`${this.act(adAccountId)}/insights`, {
      level: 'ad',
      fields: 'ad_id,spend,impressions,clicks,actions,account_currency',
      time_increment: '1',
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    });
  }

  async tokenScopes(): Promise<{ valid: boolean; scopes: string[]; expiresAt: number | null }> {
    const res = await this.http.request(
      `${this.baseUrl}/${this.graphVersion}/debug_token?input_token=${encodeURIComponent(this.accessToken)}`,
      { method: 'GET', headers: { authorization: `Bearer ${this.accessToken}` } },
    );
    if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
    const d = (res.json as any)?.data ?? {};
    return { valid: d.is_valid === true, scopes: d.scopes ?? [], expiresAt: d.expires_at ?? null };
  }
}

export const toCents = (v: string | undefined): number => (v ? Math.round(Number.parseFloat(v) * 100) : 0);
