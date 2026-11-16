import { GraphApiError, type HttpClient } from '../../shared/http.js';

export interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  account_id?: string;
  daily_budget?: string; // centavos, como texto
  lifetime_budget?: string;
  stop_time?: string;
}
export interface MetaAdSet {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  campaign_id: string;
  daily_budget?: string;
  lifetime_budget?: string;
}
export interface MetaAd {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  adset_id: string;
  campaign_id: string;
}

/** Janela de aumento de orçamento ("high demand period") da Meta. */
export interface MetaBudgetSchedule {
  id: string;
  time_start: string | number;
  time_end: string | number;
  budget_value: string | number;
  budget_value_type: 'ABSOLUTE' | 'MULTIPLIER';
  recurrence_type?: string;
}

export const CAMPAIGN_FIELDS = 'id,name,status,effective_status,objective,account_id,daily_budget,lifetime_budget,stop_time';
export const ADSET_FIELDS = 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget';
export const AD_FIELDS = 'id,name,status,effective_status,adset_id,campaign_id';
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
  currency?: string;
  timezone_name?: string;
  /** Tarefas do usuário do token na conta (ex.: ANALYZE, ADVERTISE, MANAGE). Precisa de ADVERTISE/MANAGE para alterar. */
  user_tasks?: string[];
}

export const MESSAGING_STARTED_ACTION = 'onsite_conversion.messaging_conversation_started_7d';

/** Cliente da Meta Marketing API: leitura (campanhas, anúncios, investimento) e gestão (status, orçamento). */
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
    return this.getAll<MetaAdAccount>('me/adaccounts', { fields: 'id,account_id,name,account_status,currency,timezone_name,user_tasks' });
  }

  listCampaigns(adAccountId: string) {
    return this.getAll<MetaCampaign>(`${this.act(adAccountId)}/campaigns`, { fields: CAMPAIGN_FIELDS });
  }

  listAdSets(adAccountId: string) {
    return this.getAll<MetaAdSet>(`${this.act(adAccountId)}/adsets`, { fields: ADSET_FIELDS });
  }

  listAds(adAccountId: string) {
    return this.getAll<MetaAd>(`${this.act(adAccountId)}/ads`, { fields: AD_FIELDS });
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

  // ── Gestão (exige a permissão ads_management) ────────────────

  async getNode<T>(id: string, fields: string): Promise<T> {
    const res = await this.http.request(`${this.baseUrl}/${this.graphVersion}/${id}?fields=${encodeURIComponent(fields)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
    return res.json as T;
  }

  /** Atualiza um objeto (campanha, conjunto ou anúncio): status, daily_budget, lifetime_budget. */
  async update(id: string, params: Record<string, string | number>) {
    const res = await this.http.request(`${this.baseUrl}/${this.graphVersion}/${id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.accessToken}` },
      body: params,
    });
    if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
    return res.json as { success?: boolean };
  }

  listChildren<T>(id: string, edge: 'adsets' | 'ads', fields: string) {
    return this.getAll<T>(`${id}/${edge}`, { fields });
  }

  listBudgetSchedules(id: string) {
    return this.getAll<MetaBudgetSchedule>(`${id}/budget_schedules`, {
      fields: 'id,time_start,time_end,budget_value,budget_value_type,recurrence_type',
    });
  }

  async createBudgetSchedule(id: string, spec: { budget_value: number; budget_value_type: 'ABSOLUTE' | 'MULTIPLIER'; time_start: number; time_end: number }) {
    const res = await this.http.request(`${this.baseUrl}/${this.graphVersion}/${id}/budget_schedules`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.accessToken}` },
      body: spec,
    });
    if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
    return res.json as { id?: string };
  }

  async deleteNode(id: string) {
    const res = await this.http.request(`${this.baseUrl}/${this.graphVersion}/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status >= 400) throw GraphApiError.from(res.status, res.json);
    return res.json as { success?: boolean };
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

/** Orçamento da Meta (texto em centavos) → número; vazio/zero = sem orçamento neste nível. */
export const budgetCents = (v: string | undefined | null): number | null => {
  const n = v == null || v === '' ? 0 : Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const toCampaign = (c: MetaCampaign, accountId?: string) => ({
  metaId: c.id,
  name: c.name,
  status: c.status ?? null,
  objective: c.objective ?? null,
  accountId: c.account_id ?? accountId ?? null,
  effectiveStatus: c.effective_status ?? null,
  dailyBudgetCents: budgetCents(c.daily_budget),
  lifetimeBudgetCents: budgetCents(c.lifetime_budget),
  stopTime: c.stop_time ? new Date(c.stop_time) : null,
});

export const toAdSet = (s: MetaAdSet) => ({
  metaId: s.id,
  campaignMetaId: s.campaign_id,
  name: s.name,
  status: s.status ?? null,
  effectiveStatus: s.effective_status ?? null,
  dailyBudgetCents: budgetCents(s.daily_budget),
  lifetimeBudgetCents: budgetCents(s.lifetime_budget),
});

export const toAd = (a: MetaAd) => ({
  metaId: a.id,
  adSetMetaId: a.adset_id,
  campaignMetaId: a.campaign_id,
  name: a.name,
  status: a.status ?? null,
  effectiveStatus: a.effective_status ?? null,
});
