// Portas de persistência. O domínio depende apenas destas interfaces.
// Implementações: infra/prisma (produção) e infra/memory (testes).

import type {
  Ad,
  AdInsightDaily,
  AdSet,
  Appointment,
  AttributionEvidence,
  AuditEntry,
  Campaign,
  Contact,
  Conversation,
  InboundEvent,
  InboundEventStatus,
  IntegrationConnection,
  IntegrationEnvironment,
  IntegrationError,
  IntegrationProvider,
  Lead,
  LeadStage,
  LeadStageHistory,
  Message,
  Payment,
  Procedure,
  ProcedurePerformed,
  Reminder,
  Sale,
  SupplyPurchase,
  User,
} from '../domain/types.js';

export interface DateRange {
  from: Date; // inclusivo
  to: Date; // exclusivo
}

type Create<T extends { id: string }> = Omit<T, 'id'> & { id?: string };

export interface UserRepo {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: Create<User>): Promise<User>;
  list(): Promise<User[]>;
}

export interface ContactRepo {
  findById(id: string): Promise<Contact | null>;
  findByWaId(waId: string): Promise<Contact | null>;
  findByBsuid(bsuid: string): Promise<Contact | null>;
  create(data: Create<Contact>): Promise<Contact>;
  update(id: string, data: Partial<Contact>): Promise<Contact>;
}

export interface ConversationRepo {
  /** Conversa do contato cuja janela [startedAt - gap, lastMessageAt + gap] contém `at`. */
  findCovering(contactId: string, at: Date, gapMs: number): Promise<Conversation | null>;
  create(data: Create<Conversation>): Promise<Conversation>;
  update(id: string, data: Partial<Conversation>): Promise<Conversation>;
  countStartedIn(range: DateRange): Promise<number>;
  countStartedByAdIn(range: DateRange): Promise<Map<string, number>>;
}

export interface MessageRepo {
  findByWaMessageId(waMessageId: string): Promise<Message | null>;
  create(data: Create<Message>): Promise<Message>;
  update(id: string, data: Partial<Message>): Promise<Message>;
  listByContact(contactId: string, limit?: number): Promise<Message[]>;
  countIn(range: DateRange): Promise<{ inbound: number; outbound: number }>;
  firstOutboundAfter(contactId: string, after: Date): Promise<Message | null>;
}

export interface LeadFilter {
  stage?: LeadStage;
  open?: boolean;
  adMetaId?: string;
  campaignMetaId?: string;
  confidence?: Lead['attributionConfidence'];
  openedIn?: DateRange;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LeadRepo {
  findById(id: string): Promise<Lead | null>;
  findOpenByContact(contactId: string): Promise<Lead | null>;
  findLatestByContact(contactId: string): Promise<Lead | null>;
  create(data: Create<Lead>): Promise<Lead>;
  update(id: string, data: Partial<Lead>): Promise<Lead>;
  list(filter: LeadFilter): Promise<Lead[]>;
  count(filter: LeadFilter): Promise<number>;
  listMissingHierarchy(): Promise<Lead[]>;
}

export interface EvidenceRepo {
  create(data: Create<AttributionEvidence>): Promise<AttributionEvidence>;
  findById(id: string): Promise<AttributionEvidence | null>;
  listByLead(leadId: string): Promise<AttributionEvidence[]>;
}

export interface StageHistoryRepo {
  create(data: Create<LeadStageHistory>): Promise<LeadStageHistory>;
  listByLead(leadId: string): Promise<LeadStageHistory[]>;
}

export interface AdRepo {
  findAd(metaId: string): Promise<Ad | null>;
  findAdByCode(code: string): Promise<Ad | null>;
  /** Define (ou remove, com null) o código do anúncio. Rejeita código já usado por outro anúncio. */
  setAdCode(metaId: string, code: string | null): Promise<Ad>;
  upsertCampaign(c: Campaign): Promise<void>;
  upsertAdSet(a: AdSet): Promise<void>;
  upsertAd(a: Ad): Promise<void>;
  upsertInsight(i: AdInsightDaily): Promise<void>;
  /** Gravação em lote (uma consulta por bloco): usada na sincronização da Meta. */
  upsertCampaigns(rows: Campaign[]): Promise<void>;
  upsertAdSets(rows: AdSet[]): Promise<void>;
  upsertAds(rows: Ad[]): Promise<void>;
  upsertInsights(rows: AdInsightDaily[]): Promise<void>;
  listAds(): Promise<Ad[]>;
  listCampaigns(): Promise<Campaign[]>;
  listAdSets(): Promise<AdSet[]>;
  listInsights(range: DateRange): Promise<AdInsightDaily[]>;
}

export interface ProcedureRepo {
  findById(id: string): Promise<Procedure | null>;
  list(): Promise<Procedure[]>;
  create(data: Create<Procedure>): Promise<Procedure>;
}

export interface AppointmentRepo {
  findById(id: string): Promise<Appointment | null>;
  create(data: Create<Appointment>): Promise<Appointment>;
  update(id: string, data: Partial<Appointment>): Promise<Appointment>;
  listByLead(leadId: string): Promise<Appointment[]>;
  listCreatedIn(range: DateRange): Promise<Appointment[]>;
  listScheduledBetween(range: DateRange): Promise<Appointment[]>;
}

export interface SaleRepo {
  findById(id: string): Promise<Sale | null>;
  create(data: Create<Sale>): Promise<Sale>;
  update(id: string, data: Partial<Sale>): Promise<Sale>;
  listByLead(leadId: string): Promise<Sale[]>;
  listSoldIn(range: DateRange): Promise<Sale[]>;
}

export interface PaymentRepo {
  create(data: Create<Payment>): Promise<Payment>;
  listBySale(saleId: string): Promise<Payment[]>;
  listPaidIn(range: DateRange): Promise<Payment[]>;
}

export interface SupplyPurchaseRepo {
  create(data: Omit<SupplyPurchase, 'id' | 'createdAt' | 'updatedAt'>): Promise<SupplyPurchase>;
  update(id: string, data: Partial<Omit<SupplyPurchase, 'id' | 'createdAt' | 'updatedAt'>>): Promise<SupplyPurchase>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<SupplyPurchase | null>;
  /** Mais recentes primeiro. Sem período = todas. */
  list(range?: DateRange): Promise<SupplyPurchase[]>;
}

export interface ProcedurePerformedRepo {
  create(data: Create<ProcedurePerformed>): Promise<ProcedurePerformed>;
  listByLead(leadId: string): Promise<ProcedurePerformed[]>;
  listPerformedIn(range: DateRange): Promise<ProcedurePerformed[]>;
}

export interface ReminderRepo {
  create(data: Create<Reminder>): Promise<Reminder>;
  update(id: string, data: Partial<Reminder>): Promise<Reminder>;
  findById(id: string): Promise<Reminder | null>;
  listPending(until: Date, assignedToId?: string): Promise<Reminder[]>;
  listByLead(leadId: string): Promise<Reminder[]>;
}

export interface ConnectionRepo {
  find(provider: IntegrationProvider, env: IntegrationEnvironment): Promise<IntegrationConnection | null>;
  findByPhoneNumberId(phoneNumberId: string): Promise<IntegrationConnection | null>;
  upsert(
    provider: IntegrationProvider,
    env: IntegrationEnvironment,
    data: Partial<IntegrationConnection>,
  ): Promise<IntegrationConnection>;
  list(): Promise<IntegrationConnection[]>;
  addError(e: Omit<IntegrationError, 'id' | 'createdAt'>): Promise<void>;
  recentErrors(provider: IntegrationProvider, limit: number): Promise<IntegrationError[]>;
}

export interface InboundEventRepo {
  /** Insere se a dedupKey for inédita. Retorna null se já existia (duplicado). */
  insertIfNew(
    e: Omit<InboundEvent, 'id' | 'receivedAt' | 'status' | 'attempts' | 'lastError' | 'processedAt'>,
  ): Promise<InboundEvent | null>;
  findById(id: string): Promise<InboundEvent | null>;
  update(id: string, data: Partial<InboundEvent>): Promise<InboundEvent>;
  list(filter: { status?: InboundEventStatus; limit?: number }): Promise<InboundEvent[]>;
  countByStatus(): Promise<Record<string, number>>;
}

export interface AuditRepo {
  log(entry: AuditEntry): Promise<void>;
  list(filter: { entityType?: string; entityId?: string; limit?: number }): Promise<
    (AuditEntry & { id: string; createdAt: Date })[]
  >;
}

export interface Repos {
  users: UserRepo;
  contacts: ContactRepo;
  conversations: ConversationRepo;
  messages: MessageRepo;
  leads: LeadRepo;
  evidence: EvidenceRepo;
  stageHistory: StageHistoryRepo;
  ads: AdRepo;
  procedures: ProcedureRepo;
  appointments: AppointmentRepo;
  sales: SaleRepo;
  payments: PaymentRepo;
  purchases: SupplyPurchaseRepo;
  performed: ProcedurePerformedRepo;
  reminders: ReminderRepo;
  connections: ConnectionRepo;
  events: InboundEventRepo;
  audit: AuditRepo;
  /** Executa `fn` em transação. */
  tx<T>(fn: (r: Repos) => Promise<T>): Promise<T>;
}
