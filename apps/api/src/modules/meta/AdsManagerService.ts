// Gerenciador de anúncios dentro do CRM: campanhas, conjuntos e anúncios com métricas da Meta e do CRM,
// ativar/pausar, alterar orçamento e programar janelas de aumento de orçamento (budget scheduling da Meta).
// Toda alteração é feita na Meta (a fonte da verdade), registrada na auditoria e refletida aqui na hora.

import { DomainError } from '../../domain/errors.js';
import type { IntegrationEnvironment } from '../../domain/types.js';
import type { CredentialVault } from '../../infra/crypto/CredentialVault.js';
import type { DateRange, Repos } from '../../ports/repositories.js';
import { GraphApiError, type HttpClient } from '../../shared/http.js';
import type { MetricsService } from '../metrics/MetricsService.js';
import {
  AD_FIELDS,
  ADSET_FIELDS,
  CAMPAIGN_FIELDS,
  type MetaAd,
  type MetaAdSet,
  type MetaBudgetSchedule,
  type MetaCampaign,
  MetaMarketingClient,
  toAd,
  toAdSet,
  toCampaign,
} from './MetaMarketingClient.js';

export type Level = 'campaign' | 'adset' | 'ad';
type Actor = { id: string; ip?: string };

export interface Metrics {
  spendCents: number;
  impressions: number;
  clicks: number;
  conversations: number;
  leads: number;
  appointments: number;
  sales: number;
  revenueCents: number;
}

const zero = (): Metrics => ({ spendCents: 0, impressions: 0, clicks: 0, conversations: 0, leads: 0, appointments: 0, sales: 0, revenueCents: 0 });
const addInto = (a: Metrics, b: Metrics) => {
  for (const k of Object.keys(a) as (keyof Metrics)[]) a[k] += b[k];
};
const derived = (m: Metrics) => ({
  ...m,
  ctrPct: m.impressions ? Math.round((m.clicks / m.impressions) * 10000) / 100 : null,
  cpmCents: m.impressions ? Math.round((m.spendCents / m.impressions) * 1000) : null,
  costPerConversationCents: m.conversations ? Math.round(m.spendCents / m.conversations) : null,
  costPerLeadCents: m.leads ? Math.round(m.spendCents / m.leads) : null,
  roas: m.spendCents ? Math.round((m.revenueCents / m.spendCents) * 100) / 100 : null,
});

/** Limites da Meta para janelas de orçamento. */
export const SCHEDULE_RULES = { minHours: 3, maxPerObject: 50, maxMultiplier: 8, stepMinutes: 15 };

/** Valida uma janela antes de mandar para a Meta (mensagens em português). */
export function validateWindow(w: { start: Date; end: Date; increaseCents: number }, dailyBudgetCents: number | null, now: Date) {
  if (!dailyBudgetCents) return 'A programação de orçamento só funciona com orçamento diário.';
  const step = SCHEDULE_RULES.stepMinutes * 60_000;
  if (w.start.getTime() % step || w.end.getTime() % step) return 'Use horários cheios ou de 15 em 15 minutos (ex.: 18:00, 18:15).';
  if (w.start <= now) return 'O início precisa ser no futuro.';
  if (w.end.getTime() - w.start.getTime() < SCHEDULE_RULES.minHours * 3_600_000) return 'Cada janela precisa ter pelo menos 3 horas.';
  if (w.increaseCents <= 0) return 'Informe de quanto é o aumento.';
  if (dailyBudgetCents + w.increaseCents > dailyBudgetCents * SCHEDULE_RULES.maxMultiplier) {
    return `O orçamento na janela não pode passar de 8× o diário (máximo de aumento: ${((dailyBudgetCents * 7) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`;
  }
  return null;
}

export class AdsManagerService {
  constructor(
    private readonly repos: Repos,
    private readonly vault: CredentialVault,
    private readonly http: HttpClient,
    private readonly env: IntegrationEnvironment,
    private readonly graphVersion: string,
    private readonly metrics: MetricsService,
    private readonly baseUrl?: string,
  ) {}

  private async client() {
    const conn = await this.repos.connections.find('META_MARKETING', this.env);
    if (!conn?.encryptedCredentials) throw new DomainError('META_NOT_CONFIGURED', 'Conecte o Meta Ads em Integrações primeiro.', 409);
    const { accessToken } = this.vault.decrypt(conn.encryptedCredentials);
    if (!accessToken) throw new DomainError('META_NOT_CONFIGURED', 'Token da Meta ausente. Reconecte em Integrações.', 409);
    return new MetaMarketingClient(this.http, accessToken, this.graphVersion, this.baseUrl);
  }

  /** Traduz erros da Meta para mensagens que a clínica entende. */
  private explain(err: unknown): never {
    if (err instanceof DomainError) throw err;
    if (err instanceof GraphApiError) {
      if (err.code === 190) throw new DomainError('META_TOKEN', 'O token da Meta expirou ou foi revogado. Gere um novo em Integrações → Meta Ads.', 409);
      if (err.code === 200 || err.code === 10 || (err.code != null && err.code >= 200 && err.code < 300)) {
        throw new DomainError(
          'META_PERMISSION',
          'O CRM não tem permissão para alterar anúncios nesta conta. Gere um token com a permissão ads_management e dê ao usuário do sistema acesso de "Gerenciar campanhas" na conta de anúncios.',
          403,
        );
      }
      throw new DomainError('META_ERROR', `A Meta recusou a alteração: ${err.userMessage ?? err.message}`, 422);
    }
    throw err;
  }

  // ── Leitura ─────────────────────────────────────────────

  async tree(range: DateRange, opts: { accountId?: string; includeArchived?: boolean } = {}) {
    const [accounts, campaigns, adSets, ads, rows] = await Promise.all([
      this.repos.ads.listAdAccounts(),
      this.repos.ads.listCampaigns(),
      this.repos.ads.listAdSets(),
      this.repos.ads.listAds(),
      this.metrics.byAd(range),
    ]);
    const hidden = (s?: string | null) => !opts.includeArchived && (s === 'ARCHIVED' || s === 'DELETED');
    const campaignOk = new Map(
      campaigns.map((c) => [c.metaId, !hidden(c.status) && (!opts.accountId || c.accountId === opts.accountId)]),
    );

    const adM = new Map<string, Metrics>();
    for (const r of rows) {
      adM.set(r.adMetaId, {
        spendCents: r.spendCents,
        impressions: r.impressions,
        clicks: r.clicks,
        conversations: r.metaConversationsStarted,
        leads: r.leadsOfficial + r.leadsManual,
        appointments: r.appointments,
        sales: r.sales,
        revenueCents: r.revenueCents,
      });
    }
    const setM = new Map<string, Metrics>();
    const campM = new Map<string, Metrics>();
    const counts = new Map<string, { adSets: number; ads: number }>();
    for (const a of ads) {
      const m = adM.get(a.metaId) ?? zero();
      const s = setM.get(a.adSetMetaId) ?? zero();
      addInto(s, m);
      setM.set(a.adSetMetaId, s);
      const c = campM.get(a.campaignMetaId) ?? zero();
      addInto(c, m);
      campM.set(a.campaignMetaId, c);
    }
    for (const s of adSets) {
      const k = counts.get(s.campaignMetaId) ?? { adSets: 0, ads: 0 };
      if (!hidden(s.status)) k.adSets++;
      counts.set(s.campaignMetaId, k);
    }
    for (const a of ads) {
      const k = counts.get(a.campaignMetaId) ?? { adSets: 0, ads: 0 };
      if (!hidden(a.status)) k.ads++;
      counts.set(a.campaignMetaId, k);
    }

    const campaignById = new Map(campaigns.map((c) => [c.metaId, c]));
    const adSetById = new Map(adSets.map((s) => [s.metaId, s]));
    const out = {
      accounts,
      campaigns: campaigns
        .filter((c) => campaignOk.get(c.metaId))
        .map((c) => ({
          id: c.metaId,
          name: c.name,
          accountId: c.accountId ?? null,
          status: c.status,
          effectiveStatus: c.effectiveStatus ?? c.status,
          objective: c.objective,
          dailyBudgetCents: c.dailyBudgetCents ?? null,
          lifetimeBudgetCents: c.lifetimeBudgetCents ?? null,
          budgetLevel: c.dailyBudgetCents || c.lifetimeBudgetCents ? ('campaign' as const) : ('adset' as const),
          stopTime: c.stopTime ?? null,
          adSets: counts.get(c.metaId)?.adSets ?? 0,
          ads: counts.get(c.metaId)?.ads ?? 0,
          ...derived(campM.get(c.metaId) ?? zero()),
        })),
      adSets: adSets
        .filter((s) => campaignOk.get(s.campaignMetaId) && !hidden(s.status))
        .map((s) => {
          const camp = campaignById.get(s.campaignMetaId);
          return {
            id: s.metaId,
            name: s.name,
            campaignId: s.campaignMetaId,
            campaignName: camp?.name ?? null,
            status: s.status,
            effectiveStatus: s.effectiveStatus ?? s.status,
            dailyBudgetCents: s.dailyBudgetCents ?? null,
            lifetimeBudgetCents: s.lifetimeBudgetCents ?? null,
            usesCampaignBudget: !!(camp?.dailyBudgetCents || camp?.lifetimeBudgetCents),
            ...derived(setM.get(s.metaId) ?? zero()),
          };
        }),
      ads: ads
        .filter((a) => campaignOk.get(a.campaignMetaId) && !hidden(a.status))
        .map((a) => ({
          id: a.metaId,
          name: a.name,
          code: a.code ?? null,
          campaignId: a.campaignMetaId,
          campaignName: campaignById.get(a.campaignMetaId)?.name ?? null,
          adSetId: a.adSetMetaId,
          adSetName: adSetById.get(a.adSetMetaId)?.name ?? null,
          status: a.status,
          effectiveStatus: a.effectiveStatus ?? a.status,
          ...derived(adM.get(a.metaId) ?? zero()),
        })),
    };
    return out;
  }

  // ── Alterações ──────────────────────────────────────────

  /** Atualiza do zero uma campanha e tudo abaixo dela (status efetivos mudam em cascata). */
  private async refreshCampaign(client: MetaMarketingClient, campaignId: string) {
    const [c, sets, ads] = await Promise.all([
      client.getNode<MetaCampaign>(campaignId, CAMPAIGN_FIELDS),
      client.listChildren<MetaAdSet>(campaignId, 'adsets', ADSET_FIELDS),
      client.listChildren<MetaAd>(campaignId, 'ads', AD_FIELDS),
    ]);
    await this.repos.ads.upsertCampaigns([toCampaign(c)]);
    await this.repos.ads.upsertAdSets(sets.map(toAdSet));
    await this.repos.ads.upsertAds(ads.map(toAd));
  }

  private async campaignOf(level: Level, id: string) {
    if (level === 'campaign') {
      if (!(await this.repos.ads.listCampaigns()).some((c) => c.metaId === id)) throw new DomainError('NOT_FOUND', 'Campanha não encontrada', 404);
      return id;
    }
    if (level === 'adset') {
      const s = (await this.repos.ads.listAdSets()).find((x) => x.metaId === id);
      if (!s) throw new DomainError('NOT_FOUND', 'Conjunto de anúncios não encontrado', 404);
      return s.campaignMetaId;
    }
    const a = await this.repos.ads.findAd(id);
    if (!a) throw new DomainError('NOT_FOUND', 'Anúncio não encontrado', 404);
    return a.campaignMetaId;
  }

  async setStatus(level: Level, id: string, status: 'ACTIVE' | 'PAUSED', actor: Actor) {
    const campaignId = await this.campaignOf(level, id);
    const client = await this.client();
    try {
      await client.update(id, { status });
      await this.refreshCampaign(client, campaignId);
    } catch (e) {
      this.explain(e);
    }
    await this.repos.audit.log({
      userId: actor.id,
      action: 'meta.status',
      entityType: level,
      entityId: id,
      after: { status },
      ip: actor.ip,
    });
    return { ok: true };
  }

  async setBudget(level: 'campaign' | 'adset', id: string, kind: 'daily' | 'lifetime', cents: number, actor: Actor) {
    const campaignId = await this.campaignOf(level, id);
    const node =
      level === 'campaign'
        ? (await this.repos.ads.listCampaigns()).find((c) => c.metaId === id)!
        : (await this.repos.ads.listAdSets()).find((s) => s.metaId === id)!;
    const current = kind === 'daily' ? node.dailyBudgetCents : node.lifetimeBudgetCents;
    if (!current) {
      throw new DomainError(
        'BUDGET_LEVEL',
        level === 'campaign'
          ? 'Esta campanha não tem orçamento próprio: o orçamento fica em cada conjunto de anúncios.'
          : `Este conjunto não tem orçamento ${kind === 'daily' ? 'diário' : 'total'} próprio (ele usa o orçamento da campanha ou o outro tipo).`,
        409,
      );
    }
    if (!Number.isInteger(cents) || cents < 100) throw new DomainError('VALIDATION', 'Orçamento inválido.');
    const client = await this.client();
    try {
      await client.update(id, { [kind === 'daily' ? 'daily_budget' : 'lifetime_budget']: cents });
      await this.refreshCampaign(client, campaignId);
    } catch (e) {
      this.explain(e);
    }
    await this.repos.audit.log({
      userId: actor.id,
      action: 'meta.budget',
      entityType: level,
      entityId: id,
      before: { [kind]: current },
      after: { [kind]: cents },
      ip: actor.ip,
    });
    return { ok: true };
  }

  async schedules(level: 'campaign' | 'adset', id: string) {
    await this.campaignOf(level, id);
    const client = await this.client();
    try {
      const list = await client.listBudgetSchedules(id);
      return list
        .map((s: MetaBudgetSchedule) => ({
          id: s.id,
          start: toDate(s.time_start),
          end: toDate(s.time_end),
          value: Number(s.budget_value),
          type: s.budget_value_type,
          recurrence: s.recurrence_type ?? null,
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    } catch (e) {
      this.explain(e);
    }
  }

  /**
   * Cria janelas de aumento de orçamento. O aumento vai como valor ABSOLUTO na moeda da conta, em
   * unidades inteiras (ex.: 150 = R$ 150), como descrito na documentação da Meta.
   */
  async createSchedules(level: 'campaign' | 'adset', id: string, windows: { start: Date; end: Date; increaseCents: number }[], actor: Actor, now = new Date()) {
    await this.campaignOf(level, id);
    const node =
      level === 'campaign'
        ? (await this.repos.ads.listCampaigns()).find((c) => c.metaId === id)!
        : (await this.repos.ads.listAdSets()).find((s) => s.metaId === id)!;
    for (const w of windows) {
      const problem = validateWindow(w, node.dailyBudgetCents ?? null, now);
      if (problem) throw new DomainError('VALIDATION', problem);
    }
    const client = await this.client();
    const existing = await client.listBudgetSchedules(id).catch(() => []);
    if (existing.length + windows.length > SCHEDULE_RULES.maxPerObject) {
      throw new DomainError('VALIDATION', `A Meta permite até ${SCHEDULE_RULES.maxPerObject} janelas por ${level === 'campaign' ? 'campanha' : 'conjunto'}.`);
    }
    if (existing.some((s) => s.budget_value_type === 'MULTIPLIER')) {
      throw new DomainError('VALIDATION', 'Esta campanha já tem janelas em porcentagem criadas no Gerenciador da Meta; a Meta não deixa misturar com valor em reais.');
    }
    const created: string[] = [];
    try {
      for (const w of windows) {
        const r = await client.createBudgetSchedule(id, {
          budget_value: Math.round(w.increaseCents / 100),
          budget_value_type: 'ABSOLUTE',
          time_start: Math.floor(w.start.getTime() / 1000),
          time_end: Math.floor(w.end.getTime() / 1000),
        });
        if (r.id) created.push(r.id);
      }
    } catch (e) {
      // Algumas janelas podem ter sido criadas antes do erro: ficam registradas e aparecem na lista.
      await this.repos.audit.log({ userId: actor.id, action: 'meta.budgetSchedule.partial', entityType: level, entityId: id, after: { created }, ip: actor.ip });
      this.explain(e);
    }
    await this.repos.audit.log({
      userId: actor.id,
      action: 'meta.budgetSchedule.create',
      entityType: level,
      entityId: id,
      after: { windows: windows.map((w) => ({ start: w.start, end: w.end, increaseCents: w.increaseCents })), created },
      ip: actor.ip,
    });
    return { created: created.length };
  }

  async deleteSchedule(level: 'campaign' | 'adset', parentId: string, scheduleId: string, actor: Actor) {
    await this.campaignOf(level, parentId);
    const client = await this.client();
    const mine = await client.listBudgetSchedules(parentId).catch((e) => this.explain(e));
    if (!mine.some((s) => s.id === scheduleId)) throw new DomainError('NOT_FOUND', 'Janela não encontrada nesta campanha.', 404);
    try {
      await client.deleteNode(scheduleId);
    } catch (e) {
      this.explain(e);
    }
    await this.repos.audit.log({ userId: actor.id, action: 'meta.budgetSchedule.delete', entityType: level, entityId: parentId, after: { scheduleId }, ip: actor.ip });
    return { ok: true };
  }
}

const toDate = (v: string | number) => (typeof v === 'number' || /^\d+$/.test(String(v)) ? new Date(Number(v) * 1000) : new Date(v));
