import { PermanentError, RetryableError } from '../../domain/errors.js';
import type { IntegrationEnvironment } from '../../domain/types.js';
import type { CredentialVault } from '../../infra/crypto/CredentialVault.js';
import type { Repos } from '../../ports/repositories.js';
import { DAY_MS, type Clock } from '../../shared/ids.js';
import { GraphApiError, type HttpClient } from '../../shared/http.js';
import type { AttributionEngine } from '../attribution/AttributionEngine.js';
import { MESSAGING_STARTED_ACTION, MetaMarketingClient, toCents } from './MetaMarketingClient.js';

export const META_SYNC_JOB = 'meta.sync';

export interface MetaSyncResult {
  campaigns: number;
  adSets: number;
  ads: number;
  insightRows: number;
  hierarchyResolved: number;
}

/**
 * Importa campanhas, conjuntos, anúncios e investimento diário da Meta.
 * Se a Meta estiver indisponível, os dados já importados continuam valendo,
 * o erro é registrado na tela de integrações e o job é reagendado.
 */
export class MetaSyncService {
  constructor(
    private readonly repos: Repos,
    private readonly vault: CredentialVault,
    private readonly http: HttpClient,
    private readonly clock: Clock,
    private readonly env: IntegrationEnvironment,
    private readonly graphVersion: string,
    private readonly engine: AttributionEngine,
    private readonly baseUrl?: string,
  ) {}

  async sync(opts: { days?: number } = {}): Promise<MetaSyncResult> {
    const conn = await this.repos.connections.find('META_MARKETING', this.env);
    if (!conn?.encryptedCredentials || !conn.adAccountId) {
      throw new PermanentError('Integração Meta Marketing não configurada (conta de anúncios e token)');
    }
    const { accessToken } = this.vault.decrypt(conn.encryptedCredentials);
    if (!accessToken) throw new PermanentError('Token da Meta ausente');

    const client = new MetaMarketingClient(this.http, accessToken, this.graphVersion, this.baseUrl);
    const now = this.clock.now();
    const since = new Date(now.getTime() - (opts.days ?? 30) * DAY_MS).toISOString().slice(0, 10);
    const until = now.toISOString().slice(0, 10);

    try {
      const [campaigns, adSets, ads, insights] = await Promise.all([
        client.listCampaigns(conn.adAccountId),
        client.listAdSets(conn.adAccountId),
        client.listAds(conn.adAccountId),
        client.insightsByAdDaily(conn.adAccountId, since, until),
      ]);

      await this.repos.tx(async (r) => {
        for (const c of campaigns) await r.ads.upsertCampaign({ metaId: c.id, name: c.name, status: c.status ?? null, objective: c.objective ?? null });
        for (const s of adSets) await r.ads.upsertAdSet({ metaId: s.id, campaignMetaId: s.campaign_id, name: s.name, status: s.status ?? null });
        for (const a of ads) {
          await r.ads.upsertAd({ metaId: a.id, adSetMetaId: a.adset_id, campaignMetaId: a.campaign_id, name: a.name, status: a.status ?? null });
        }
        for (const i of insights) {
          await r.ads.upsertInsight({
            adMetaId: i.ad_id,
            date: i.date_start,
            spendCents: toCents(i.spend),
            impressions: Number(i.impressions ?? 0),
            clicks: Number(i.clicks ?? 0),
            metaMessagingConversationsStarted: Number(i.actions?.find((a) => a.action_type === MESSAGING_STARTED_ACTION)?.value ?? 0),
            currency: i.account_currency ?? 'BRL',
          });
        }
      });

      const hierarchyResolved = await this.engine.resolvePendingHierarchy();
      await this.repos.connections.upsert('META_MARKETING', this.env, { status: 'CONNECTED', lastSyncAt: now });
      await this.repos.audit.log({
        userId: null,
        action: 'meta.sync',
        entityType: 'IntegrationConnection',
        entityId: conn.id,
        after: { campaigns: campaigns.length, ads: ads.length, insightRows: insights.length, since, until },
      });
      return { campaigns: campaigns.length, adSets: adSets.length, ads: ads.length, insightRows: insights.length, hierarchyResolved };
    } catch (err) {
      const graph = err instanceof GraphApiError ? err : null;
      // Erros de rede (fetch) não são GraphApiError e são tratados como transitórios.
      const transient = graph ? graph.transient : !(err instanceof PermanentError);
      const authProblem = graph?.code === 190 || graph?.status === 401;
      await this.repos.connections.upsert('META_MARKETING', this.env, { status: authProblem ? 'ERROR' : 'DEGRADED' });
      await this.repos.connections.addError({
        connectionId: conn.id,
        provider: 'META_MARKETING',
        code: graph ? `GRAPH_${graph.code ?? graph.status}` : 'NETWORK',
        message: authProblem
          ? 'Token da Meta inválido ou expirado. Reautentique na tela de integrações.'
          : `Falha ao consultar a Meta: ${(err as Error).message}`,
        context: { transient },
      });
      if (transient && !authProblem) throw new RetryableError('Meta indisponível; nova tentativa agendada', err);
      throw new PermanentError((err as Error).message);
    }
  }

  async diagnose(): Promise<{ name: string; ok: boolean; detail: string }[]> {
    const conn = await this.repos.connections.find('META_MARKETING', this.env);
    if (!conn?.encryptedCredentials) return [{ name: 'Credenciais', ok: false, detail: 'não configuradas' }];
    const { accessToken } = this.vault.decrypt(conn.encryptedCredentials);
    const client = new MetaMarketingClient(this.http, accessToken ?? '', this.graphVersion, this.baseUrl);
    try {
      const t = await client.tokenScopes();
      return [
        { name: 'Token válido', ok: t.valid, detail: t.valid ? 'sim' : 'inválido' },
        { name: 'Escopo ads_read', ok: t.scopes.includes('ads_read'), detail: t.scopes.join(', ') || 'nenhum' },
      ];
    } catch (e) {
      return [{ name: 'Token', ok: false, detail: (e as Error).message }];
    }
  }
}
