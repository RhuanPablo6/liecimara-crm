import { DomainError } from '../../domain/errors.js';
import type { IntegrationConnection, IntegrationEnvironment, Role } from '../../domain/types.js';
import { CredentialVault } from '../../infra/crypto/CredentialVault.js';
import type { Repos } from '../../ports/repositories.js';
import type { Clock } from '../../shared/ids.js';
import type { HttpClient } from '../../shared/http.js';
import { CloudApiAdapter } from '../whatsapp/adapters/CloudApiAdapter.js';
import { PartnerCoexistenceAdapter, type PartnerConfig } from '../whatsapp/adapters/PartnerCoexistenceAdapter.js';
import { ALL_AD_ACCOUNTS, normalizeAdAccountsInput, parseAdAccounts } from '../meta/adAccounts.js';
import type { WhatsAppProvider } from '../whatsapp/WhatsAppProvider.js';

export interface IntegrationSettings {
  graphVersion: string;
  appSecret: string;
  verifyToken: string;
  publicUrl: string;
}

const STALE_WEBHOOK_MS = 48 * 60 * 60 * 1000;

export const RECONNECT_PROCEDURE = [
  'Confirme no celular da clínica que o app WhatsApp Business está aberto, atualizado (2.24.17 ou superior) e conectado.',
  'Em Configurações → Integrações, clique em "Executar diagnóstico" e verifique quais itens estão com falha.',
  'Se o status for "Desconectado" (PARTNER_REMOVED ou ACCOUNT_OFFBOARDED), refaça o Embedded Signup do parceiro escolhendo "Conectar app WhatsApp Business existente". Isso NÃO troca o número.',
  'Se o token estiver inválido, gere um novo token de usuário do sistema no Gerenciador de Negócios e atualize em "Credenciais".',
  'Clique em "Reinscrever webhooks" e confira se a URL de callback e o token de verificação estão corretos no app da Meta.',
  'Envie uma mensagem de teste de outro celular para o número e confirme que ela aparece em "Eventos recentes".',
  'Se houver eventos com falha, use "Reprocessar" — a deduplicação garante que nada será duplicado.',
];

/**
 * Configuração e diagnóstico das integrações. Nunca executa operações que
 * migram, registram ou desconectam o número (register/deregister): o CRM apenas
 * consome eventos e consulta dados.
 */
export class IntegrationService {
  constructor(
    private readonly repos: Repos,
    private readonly vault: CredentialVault,
    private readonly http: HttpClient,
    private readonly clock: Clock,
    private readonly env: IntegrationEnvironment,
    private readonly settings: IntegrationSettings,
  ) {}

  get environment() {
    return this.env;
  }

  private guardProduction(environment: IntegrationEnvironment, role: Role, confirm?: boolean) {
    if (environment !== 'PRODUCTION') return;
    if (role !== 'ADMIN') throw new DomainError('ADMIN_REQUIRED', 'Somente o administrador pode configurar o número de produção', 403);
    if (!confirm) {
      throw new DomainError(
        'PRODUCTION_CONFIRMATION_REQUIRED',
        'Confirme explicitamente a vinculação do número de produção (confirmProductionNumber=true) após validar a homologação.',
      );
    }
  }

  async configureWhatsAppCloud(
    input: { wabaId: string; phoneNumberId: string; accessToken: string; coexistence: boolean; confirmProductionNumber?: boolean },
    actor: { id: string; role: Role },
  ): Promise<IntegrationConnection> {
    this.guardProduction(this.env, actor.role, input.confirmProductionNumber);
    const conn = await this.repos.connections.upsert('WHATSAPP_CLOUD_API', this.env, {
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      coexistence: input.coexistence,
      encryptedCredentials: this.vault.encrypt({ accessToken: input.accessToken }),
      status: 'PENDING',
    });
    await this.repos.audit.log({
      userId: actor.id,
      action: 'integration.whatsapp_cloud.configure',
      entityType: 'IntegrationConnection',
      entityId: conn.id,
      after: { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, coexistence: input.coexistence, environment: this.env },
    });
    return conn;
  }

  async configurePartner(
    input: { wabaId?: string; config: Omit<PartnerConfig, 'authHeaderValue'>; apiKey: string; webhookSecret?: string; confirmProductionNumber?: boolean },
    actor: { id: string; role: Role },
  ): Promise<IntegrationConnection> {
    this.guardProduction(this.env, actor.role, input.confirmProductionNumber);
    const conn = await this.repos.connections.upsert('WHATSAPP_COEXISTENCE_PARTNER', this.env, {
      wabaId: input.wabaId ?? null,
      phoneNumberId: input.config.phoneNumberId,
      coexistence: true,
      partnerConfig: { ...input.config, webhookAuth: { ...input.config.webhookAuth, secret: undefined, value: undefined } },
      encryptedCredentials: this.vault.encrypt({ apiKey: input.apiKey, webhookSecret: input.webhookSecret ?? '' }),
      status: 'PENDING',
    });
    await this.repos.audit.log({
      userId: actor.id,
      action: 'integration.partner.configure',
      entityType: 'IntegrationConnection',
      entityId: conn.id,
      after: { partner: input.config.partnerName, phoneNumberId: input.config.phoneNumberId, environment: this.env },
    });
    return conn;
  }

  /**
   * Salva as contas de anúncios (lista ou "todas") e, se informado, um novo token.
   * Sem token novo, mantém o já salvo (permite trocar só as contas).
   */
  async configureMeta(input: { adAccountIds?: string; accessToken?: string }, actor: { id: string; role: Role }) {
    let adAccountId: string;
    try {
      adAccountId = normalizeAdAccountsInput(input.adAccountIds);
    } catch (e) {
      throw new DomainError('VALIDATION', (e as Error).message);
    }
    const current = await this.repos.connections.find('META_MARKETING', this.env);
    const token = input.accessToken?.trim();
    if (!token && !current?.encryptedCredentials) throw new DomainError('VALIDATION', 'Informe o token de acesso');
    const conn = await this.repos.connections.upsert('META_MARKETING', this.env, {
      adAccountId,
      ...(token ? { encryptedCredentials: this.vault.encrypt({ accessToken: token }) } : {}),
      status: 'PENDING',
    });
    await this.repos.audit.log({
      userId: actor.id,
      action: 'integration.meta.configure',
      entityType: 'IntegrationConnection',
      entityId: conn.id,
      after: { adAccountId: conn.adAccountId, tokenUpdated: !!token },
    });
    return conn;
  }

  /** Monta o adaptador a partir da conexão salva. */
  async getProvider(kind: 'cloud' | 'partner'): Promise<WhatsAppProvider | null> {
    if (kind === 'cloud') {
      const c = await this.repos.connections.find('WHATSAPP_CLOUD_API', this.env);
      if (!c?.phoneNumberId || !c.wabaId) {
        // Sem conexão salva ainda: permite validar assinatura (homologação inicial).
        return new CloudApiAdapter(
          { graphVersion: this.settings.graphVersion, appSecret: this.settings.appSecret, accessToken: '', phoneNumberId: '', wabaId: '', coexistence: false },
          this.http,
        );
      }
      const creds = c.encryptedCredentials ? this.vault.decrypt(c.encryptedCredentials) : {};
      return new CloudApiAdapter(
        {
          graphVersion: this.settings.graphVersion,
          appSecret: this.settings.appSecret,
          accessToken: creds.accessToken ?? '',
          phoneNumberId: c.phoneNumberId,
          wabaId: c.wabaId,
          coexistence: c.coexistence,
        },
        this.http,
      );
    }
    const c = await this.repos.connections.find('WHATSAPP_COEXISTENCE_PARTNER', this.env);
    if (!c?.partnerConfig || !c.encryptedCredentials) return null;
    const creds = this.vault.decrypt(c.encryptedCredentials);
    const pc = c.partnerConfig as PartnerConfig;
    const webhookAuth =
      pc.webhookAuth.mode === 'hmac-sha256'
        ? { ...pc.webhookAuth, secret: creds.webhookSecret ?? '' }
        : pc.webhookAuth.mode === 'static-header'
          ? { ...pc.webhookAuth, value: creds.webhookSecret ?? '' }
          : pc.webhookAuth;
    return new PartnerCoexistenceAdapter({ ...pc, authHeaderValue: creds.apiKey ?? '', webhookAuth }, this.http);
  }

  async runDiagnostics(kind: 'cloud' | 'partner', actorId: string | null) {
    const providerId = kind === 'cloud' ? 'WHATSAPP_CLOUD_API' : 'WHATSAPP_COEXISTENCE_PARTNER';
    const provider = await this.getProvider(kind);
    if (!provider) throw new DomainError('NOT_CONFIGURED', 'Integração não configurada');
    const checks = await provider.diagnosePermissions();
    let info = null;
    try {
      info = await provider.getPhoneNumberInfo();
    } catch (e) {
      await this.repos.connections.addError({ connectionId: null, provider: providerId, code: 'PHONE_INFO', message: (e as Error).message, context: null });
    }
    const ok = checks.every((c) => c.ok);
    const conn = await this.repos.connections.find(providerId, this.env);
    const prev = (conn?.permissionsDiagnostic as Record<string, unknown> | null) ?? {};
    await this.repos.connections.upsert(providerId, this.env, {
      status: ok ? 'CONNECTED' : 'DEGRADED',
      displayPhoneNumber: info?.displayPhoneNumber ?? conn?.displayPhoneNumber ?? null,
      permissionsDiagnostic: { ...prev, checks, checkedAt: this.clock.now().toISOString(), phone: info },
    });
    await this.repos.audit.log({ userId: actorId, action: 'integration.diagnose', entityType: 'IntegrationConnection', entityId: conn?.id ?? null, after: { ok } });
    return { ok, checks, phone: info };
  }

  async resubscribeWebhooks(actorId: string): Promise<void> {
    const provider = await this.getProvider('cloud');
    if (!(provider instanceof CloudApiAdapter)) throw new DomainError('NOT_SUPPORTED', 'Disponível apenas para Cloud API direta');
    await provider.subscribeApp();
    await this.repos.audit.log({ userId: actorId, action: 'integration.whatsapp.resubscribe', entityType: 'IntegrationConnection', entityId: null });
  }

  async requestCoexistenceSync(kind: 'cloud' | 'partner', sync: 'smb_app_state_sync' | 'history', actorId: string) {
    const provider = await this.getProvider(kind);
    if (!provider) throw new DomainError('NOT_CONFIGURED', 'Integração não configurada');
    const res = await provider.requestAppDataSync(sync);
    await this.repos.audit.log({ userId: actorId, action: `integration.sync.${sync}`, entityType: 'IntegrationConnection', entityId: null, after: res });
    return res;
  }

  /** Dados da tela de configuração do WhatsApp. */
  async whatsappStatus() {
    const now = this.clock.now().getTime();
    const out = [];
    for (const provider of ['WHATSAPP_CLOUD_API', 'WHATSAPP_COEXISTENCE_PARTNER'] as const) {
      const c = await this.repos.connections.find(provider, this.env);
      if (!c) continue;
      const creds = c.encryptedCredentials ? this.vault.decrypt(c.encryptedCredentials) : {};
      const webhook =
        c.webhookStatus === 'SIGNATURE_FAILURES'
          ? 'SIGNATURE_FAILURES'
          : !c.lastWebhookAt
            ? 'NO_EVENTS'
            : now - c.lastWebhookAt.getTime() > STALE_WEBHOOK_MS
              ? 'STALE'
              : 'OK';
      out.push({
        provider,
        environment: c.environment,
        status: c.status,
        displayPhoneNumber: c.displayPhoneNumber,
        wabaId: c.wabaId,
        phoneNumberId: c.phoneNumberId,
        coexistence: c.coexistence,
        credential: CredentialVault.mask(creds.accessToken ?? creds.apiKey),
        webhook: {
          status: webhook,
          lastEventAt: c.lastWebhookAt,
          callbackUrl: `${this.settings.publicUrl}/webhooks/whatsapp/${provider === 'WHATSAPP_CLOUD_API' ? 'cloud' : 'partner'}`,
          verifyTokenConfigured: !!this.settings.verifyToken,
          appSecretConfigured: !!this.settings.appSecret,
        },
        lastSyncAt: c.lastSyncAt,
        diagnostic: c.permissionsDiagnostic,
        recentErrors: await this.repos.connections.recentErrors(provider, 10),
      });
    }
    return {
      environment: this.env,
      connections: out,
      events: await this.repos.events.countByStatus(),
      reconnectProcedure: RECONNECT_PROCEDURE,
    };
  }

  async metaStatus() {
    const c = await this.repos.connections.find('META_MARKETING', this.env);
    return {
      configured: !!c?.encryptedCredentials,
      status: c?.status ?? 'PENDING',
      adAccountId: c?.adAccountId ?? null,
      allAdAccounts: c?.adAccountId === ALL_AD_ACCOUNTS,
      adAccountIds: parseAdAccounts(c?.adAccountId),
      lastSyncAt: c?.lastSyncAt ?? null,
      recentErrors: await this.repos.connections.recentErrors('META_MARKETING', 10),
    };
  }
}
