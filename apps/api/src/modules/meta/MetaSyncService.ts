import { PermanentError, RetryableError } from '../../domain/errors.js';
import type { IntegrationEnvironment } from '../../domain/types.js';
import type { CredentialVault } from '../../infra/crypto/CredentialVault.js';
import type { Repos } from '../../ports/repositories.js';
import { DAY_MS, type Clock } from '../../shared/ids.js';
import { GraphApiError, type HttpClient } from '../../shared/http.js';
import type { AttributionEngine } from '../attribution/AttributionEngine.js';
import { parseAdAccounts } from './adAccounts.js';
import { MESSAGING_STARTED_ACTION, MetaMarketingClient, toCents } from './MetaMarketingClient.js';

export const META_SYNC_JOB = 'meta.sync';

export interface MetaSyncResult {
  accounts: number;
  failedAccounts: string[];
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
      const accountIds = await this.resolveAccounts(client, conn.adAccountId);
      if (accountIds.length === 0) {
        throw new PermanentError('O token não tem acesso a nenhuma conta de anúncios. Atribua as contas ao usuário do sistema.');
      }

      const totals = { campaigns: 0, adSets: 0, ads: 0, insightRows: 0 };
      const failures: { accountId: string; err: unknown }[] = [];
      for (const accountId of accountIds) {
        try {
          const n = await this.syncAccount(client, accountId, since, until);
          totals.campaigns += n.campaigns;
          totals.adSets += n.adSets;
          totals.ads += n.ads;
          totals.insightRows += n.insightRows;
        } catch (err) {
          failures.push({ accountId, err });
        }
      }
      // Todas falharam: trata como falha geral (mesma regra de antes).
      if (failures.length === accountIds.length) throw failures[0]!.err;

      // Falha parcial: as demais contas foram importadas; registra as que falharam.
      for (const f of failures) {
        await this.repos.connections.addError({
          connectionId: conn.id,
          provider: 'META_MARKETING',
          code: f.err instanceof GraphApiError ? `GRAPH_${f.err.code ?? f.err.status}` : 'ACCOUNT',
          message: `Conta act_${f.accountId}: ${(f.err as Error).message}`,
          context: { accountId: f.accountId },
        });
      }

      const hierarchyResolved = await this.engine.resolvePendingHierarchy();
      await this.repos.connections.upsert('META_MARKETING', this.env, {
        status: failures.length ? 'DEGRADED' : 'CONNECTED',
        lastSyncAt: now,
      });
      await this.repos.audit.log({
        userId: null,
        action: 'meta.sync',
        entityType: 'IntegrationConnection',
        entityId: conn.id,
        after: { accounts: accountIds, failedAccounts: failures.map((f) => f.accountId), ...totals, since, until },
      });
      return { accounts: accountIds.length, failedAccounts: failures.map((f) => f.accountId), ...totals, hierarchyResolved };
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

  /** IDs das contas a sincronizar: as configuradas ou, no modo "todas", as que o token acessa. */
  private async resolveAccounts(client: MetaMarketingClient, stored: string): Promise<string[]> {
    const configured = parseAdAccounts(stored);
    if (configured.length) return configured;
    const accessible = await client.listAdAccounts();
    return accessible.map((a) => a.account_id ?? a.id.replace(/^act_/, ''));
  }

  /** Importa uma conta de anúncios. */
  private async syncAccount(client: MetaMarketingClient, accountId: string, since: string, until: string) {
    const [campaigns, adSets, ads, insights] = await Promise.all([
      client.listCampaigns(accountId),
      client.listAdSets(accountId),
      client.listAds(accountId),
      client.insightsByAdDaily(accountId, since, until),
    ]);

    // Gravação em lote (poucas consultas, sem transação longa). Ordem: campanhas → conjuntos →
    // anúncios → investimento; se algo falhar no meio, a próxima sincronização completa (upsert).
    await this.repos.ads.upsertCampaigns(
      campaigns.map((c) => ({ metaId: c.id, name: c.name, status: c.status ?? null, objective: c.objective ?? null })),
    );
    await this.repos.ads.upsertAdSets(
      adSets.map((s) => ({ metaId: s.id, campaignMetaId: s.campaign_id, name: s.name, status: s.status ?? null })),
    );
    await this.repos.ads.upsertAds(
      ads.map((a) => ({ metaId: a.id, adSetMetaId: a.adset_id, campaignMetaId: a.campaign_id, name: a.name, status: a.status ?? null })),
    );
    await this.repos.ads.upsertInsights(
      insights.map((row) => ({
        adMetaId: row.ad_id,
        date: row.date_start,
        spendCents: toCents(row.spend),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        metaMessagingConversationsStarted: Number(row.actions?.find((a) => a.action_type === MESSAGING_STARTED_ACTION)?.value ?? 0),
        currency: row.account_currency ?? 'BRL',
      })),
    );
    return { campaigns: campaigns.length, adSets: adSets.length, ads: ads.length, insightRows: insights.length };
  }

  async diagnose(): Promise<{ name: string; ok: boolean; detail: string }[]> {
    const conn = await this.repos.connections.find('META_MARKETING', this.env);
    if (!conn?.encryptedCredentials) return [{ name: 'Credenciais', ok: false, detail: 'não configuradas' }];
    const { accessToken } = this.vault.decrypt(conn.encryptedCredentials);
    const client = new MetaMarketingClient(this.http, accessToken ?? '', this.graphVersion, this.baseUrl);
    try {
      const t = await client.tokenScopes();
      const checks = [
        { name: 'Token válido', ok: t.valid, detail: t.valid ? 'sim' : 'inválido' },
        { name: 'Escopo ads_read', ok: t.scopes.includes('ads_read'), detail: t.scopes.join(', ') || 'nenhum' },
      ];
      const accessible = await client.listAdAccounts().catch(() => null);
      const configured = parseAdAccounts(conn.adAccountId);
      if (!accessible) {
        checks.push({ name: 'Contas de anúncios acessíveis', ok: false, detail: 'não foi possível listar' });
      } else {
        checks.push({
          name: 'Contas de anúncios acessíveis',
          ok: accessible.length > 0,
          detail: accessible.length ? accessible.map((a) => `${a.name} (act_${a.account_id})`).join(' · ') : 'nenhuma: atribua as contas ao usuário do sistema',
        });
        const missing = configured.filter((id) => !accessible.some((a) => a.account_id === id));
        if (configured.length) {
          checks.push({
            name: 'Contas configuradas',
            ok: missing.length === 0,
            detail: missing.length ? `sem acesso a: ${missing.map((m) => `act_${m}`).join(', ')}` : configured.map((c) => `act_${c}`).join(', '),
          });
        } else {
          checks.push({ name: 'Contas configuradas', ok: true, detail: 'todas as contas acessíveis' });
        }
      }
      return checks;
    } catch (e) {
      return [{ name: 'Token', ok: false, detail: (e as Error).message }];
    }
  }
}
