// Composição da aplicação (injeção de dependências).
import type { Env } from './config/env.js';
import type { IntegrationEnvironment } from './domain/types.js';
import { CredentialVault } from './infra/crypto/CredentialVault.js';
import { createPrismaClient } from './infra/prisma/client.js';
import { PrismaRepos } from './infra/prisma/PrismaRepos.js';
import type { Repos } from './ports/repositories.js';
import { AttributionEngine } from './modules/attribution/AttributionEngine.js';
import { AuditLogger } from './modules/audit/AuditLogger.js';
import { AuthService } from './modules/auth/auth.js';
import { AccountsService } from './modules/finance/accounts.js';
import { FinanceService } from './modules/finance/FinanceService.js';
import { GoalsService } from './modules/finance/goals.js';
import { PatientsService } from './modules/patients/PatientsService.js';
import { RecallService } from './modules/recalls/RecallService.js';
import { HeonImportService } from './modules/imports/HeonImportService.js';
import { FunnelService } from './modules/funnel/FunnelService.js';
import { QuoteService } from './modules/quotes/QuoteService.js';
import { PricingService } from './modules/pricing/PricingService.js';
import { ClinicalService } from './modules/clinical/ClinicalService.js';
import { AppointmentSaleService } from './modules/funnel/AppointmentSales.js';
import { IntegrationService } from './modules/integrations/IntegrationService.js';
import { AdsManagerService } from './modules/meta/AdsManagerService.js';
import { MetaSyncService } from './modules/meta/MetaSyncService.js';
import { MetricsService } from './modules/metrics/MetricsService.js';
import { WebhookIngestionService } from './modules/whatsapp/WebhookIngestionService.js';
import { WhatsAppEventProcessor } from './modules/whatsapp/WhatsAppEventProcessor.js';
import { ConfirmationService } from './modules/whatsapp/ConfirmationService.js';
import { PostgresJobQueue } from './queue/PostgresJobQueue.js';
import { FetchHttpClient } from './shared/http.js';
import { systemClock } from './shared/ids.js';

export function buildContainer(env: Env) {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const repos: Repos = PrismaRepos.create(prisma);
  const clock = systemClock;
  const http = new FetchHttpClient();
  const vault = new CredentialVault(env.CREDENTIALS_ENCRYPTION_KEY);
  const queue = new PostgresJobQueue(prisma);
  const integrationEnv: IntegrationEnvironment = env.APP_ENV === 'production' ? 'PRODUCTION' : 'HOMOLOG';

  const engine = new AttributionEngine(repos, clock, { reopenAfterDays: env.LEAD_REOPEN_AFTER_DAYS });
  const funnel = new FunnelService(repos, clock);
  const metrics = new MetricsService(repos);
  const finance = new FinanceService(repos);
  const accounts = new AccountsService(repos);
  const goals = new GoalsService(repos, finance);
  const patients = new PatientsService(repos);
  const recalls = new RecallService(repos);
  const heonImport = new HeonImportService(repos);
  const auth = new AuthService(repos.users, env.JWT_SECRET, env.JWT_TTL_SECONDS);
  const audit = new AuditLogger(repos.audit);
  const ingestion = new WebhookIngestionService(repos, queue, clock, integrationEnv);
  const processor = new WhatsAppEventProcessor(repos, engine, queue, clock, integrationEnv);
  const integrations = new IntegrationService(repos, vault, http, clock, integrationEnv, {
    graphVersion: env.META_GRAPH_VERSION,
    appSecret: env.META_APP_SECRET,
    verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    publicUrl: env.API_PUBLIC_URL,
  });
  const metaSync = new MetaSyncService(repos, vault, http, clock, integrationEnv, env.META_GRAPH_VERSION, engine);
  const adsManager = new AdsManagerService(repos, vault, http, integrationEnv, env.META_GRAPH_VERSION, metrics);
  const quotes = new QuoteService(repos, funnel, clock);
  const pricing = new PricingService(repos, clock);
  const clinical = new ClinicalService(repos, clock, env.JWT_SECRET);
  const appointmentSales = new AppointmentSaleService(repos, funnel);
  const confirmations = new ConfirmationService(repos, integrations, funnel, clock);
  processor.buttonHandler = (evt) => confirmations.handleButton(evt);
  processor.statusHandler = (evt) => confirmations.handleStatus(evt);

  return { env, prisma, repos, clock, queue, vault, engine, funnel, metrics, finance, accounts, goals, patients, recalls, heonImport, auth, audit, ingestion, processor, integrations, metaSync, adsManager, confirmations, quotes, pricing, clinical, appointmentSales };
}

export type Container = ReturnType<typeof buildContainer>;
