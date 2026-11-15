// Tipos de domínio independentes de ORM. Espelham o schema Prisma.

export type Role = 'ADMIN' | 'MANAGER' | 'RECEPTIONIST' | 'VIEWER';

export type LeadStage = 'NEW' | 'CONTACTED' | 'SCHEDULED' | 'ATTENDED' | 'WON' | 'LOST';
export const OPEN_STAGES: readonly LeadStage[] = ['NEW', 'CONTACTED', 'SCHEDULED', 'ATTENDED'];

export type AttributionConfidence = 'OFFICIAL_REFERRAL' | 'MANUAL' | 'UNKNOWN';
/** Ordem de força da evidência: maior vence. */
export const CONFIDENCE_RANK: Record<AttributionConfidence, number> = {
  UNKNOWN: 0,
  MANUAL: 1,
  OFFICIAL_REFERRAL: 2,
};

export type LostReason =
  | 'PRICE'
  | 'NO_RESPONSE'
  | 'CHOSE_COMPETITOR'
  | 'NOT_A_CANDIDATE'
  | 'SCHEDULE_CONFLICT'
  | 'JUST_RESEARCHING'
  | 'OTHER';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageSource = 'CUSTOMER' | 'BUSINESS_APP' | 'CLOUD_API' | 'HISTORY';

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'CANCELED' | 'NO_SHOW' | 'ATTENDED';
export type SaleStatus = 'ACTIVE' | 'CANCELED';
export type PaymentMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH' | 'BANK_TRANSFER' | 'OTHER';

export type IntegrationProvider = 'WHATSAPP_CLOUD_API' | 'WHATSAPP_COEXISTENCE_PARTNER' | 'META_MARKETING';
export type IntegrationEnvironment = 'HOMOLOG' | 'PRODUCTION';
export type ConnectionStatus = 'PENDING' | 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'ERROR';
export type InboundEventStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'DEAD' | 'IGNORED';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
}

export interface Contact {
  id: string;
  waId: string | null;
  bsuid: string | null;
  name: string | null;
  profileName: string | null;
  preExisting: boolean;
  firstSeenAt: Date;
  lastMessageAt: Date | null;
  removedFromAppAt: Date | null;
}

export interface Conversation {
  id: string;
  contactId: string;
  startedAt: Date;
  lastMessageAt: Date;
  openedByAdMetaId: string | null;
}

export interface Message {
  id: string;
  waMessageId: string;
  contactId: string;
  conversationId: string | null;
  direction: MessageDirection;
  source: MessageSource;
  type: string;
  body: string | null;
  occurredAt: Date;
  receivedAt: Date;
  status: string | null;
  hasAdReferral: boolean;
}

export interface Campaign {
  metaId: string;
  name: string;
  status: string | null;
  objective: string | null;
}
export interface AdSet {
  metaId: string;
  campaignMetaId: string;
  name: string;
  status: string | null;
}
export interface Ad {
  metaId: string;
  adSetMetaId: string;
  campaignMetaId: string;
  name: string;
  status: string | null;
  /** Código curto para a mensagem pronta (ex.: "U1"); definido no CRM. */
  code?: string | null;
}
export interface AdInsightDaily {
  adMetaId: string;
  date: string; // YYYY-MM-DD
  spendCents: number;
  impressions: number;
  clicks: number;
  metaMessagingConversationsStarted: number;
  currency: string;
}

export interface Lead {
  id: string;
  contactId: string;
  stage: LeadStage;
  procedureInterestId: string | null;
  ownerId: string | null;
  attributionConfidence: AttributionConfidence;
  adMetaId: string | null;
  adSetMetaId: string | null;
  campaignMetaId: string | null;
  attributionEvidenceId: string | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  openedAt: Date;
  firstResponseAt: Date | null;
  closedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
}

export interface AttributionEvidence {
  id: string;
  leadId: string;
  contactId: string;
  messageId: string | null;
  kind: 'OFFICIAL_REFERRAL' | 'MANUAL';
  sourceType: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  ctwaClid: string | null;
  headline: string | null;
  adMetaId: string | null;
  occurredAt: Date;
  recordedById: string | null;
  note: string | null;
  raw: unknown;
  createdAt: Date;
}

export interface LeadStageHistory {
  id: string;
  leadId: string;
  fromStage: LeadStage | null;
  toStage: LeadStage;
  userId: string | null;
  reason: string | null;
  at: Date;
}

export interface Procedure {
  id: string;
  name: string;
  defaultPriceCents: number | null;
  active: boolean;
}

export interface Appointment {
  id: string;
  leadId: string;
  procedureId: string | null;
  scheduledFor: Date;
  status: AppointmentStatus;
  cancelReason: string | null;
  createdById: string | null;
  createdAt: Date;
}

export interface Sale {
  id: string;
  leadId: string;
  procedureId: string;
  amountCents: number;
  soldAt: Date;
  status: SaleStatus;
  attributionConfidence: AttributionConfidence;
  adMetaId: string | null;
  campaignMetaId: string | null;
  createdById: string | null;
  createdAt: Date;
}

export interface Payment {
  id: string;
  saleId: string;
  amountCents: number;
  method: PaymentMethod;
  installments: number;
  paidAt: Date;
  createdById: string | null;
}

export interface ProcedurePerformed {
  id: string;
  leadId: string;
  saleId: string | null;
  procedureId: string;
  performedAt: Date;
  createdById: string | null;
}

export interface Reminder {
  id: string;
  leadId: string;
  dueAt: Date;
  note: string;
  assignedToId: string | null;
  doneAt: Date | null;
  createdById: string | null;
}

export interface IntegrationConnection {
  id: string;
  provider: IntegrationProvider;
  environment: IntegrationEnvironment;
  status: ConnectionStatus;
  label: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  adAccountId: string | null;
  coexistence: boolean;
  encryptedCredentials: string | null;
  partnerConfig: unknown;
  webhookStatus: string | null;
  lastWebhookAt: Date | null;
  lastSyncAt: Date | null;
  permissionsDiagnostic: unknown;
  updatedAt: Date;
}

export interface IntegrationError {
  id: string;
  connectionId: string | null;
  provider: IntegrationProvider;
  code: string;
  message: string;
  context: unknown;
  createdAt: Date;
}

export interface InboundEvent {
  id: string;
  provider: IntegrationProvider;
  dedupKey: string;
  kind: string;
  payload: unknown;
  occurredAt: Date;
  receivedAt: Date;
  status: InboundEventStatus;
  attempts: number;
  lastError: string | null;
  processedAt: Date | null;
}

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export const STAGE_LABELS_PT: Record<LeadStage, string> = {
  NEW: 'Novo',
  CONTACTED: 'Em atendimento',
  SCHEDULED: 'Agendado',
  ATTENDED: 'Compareceu',
  WON: 'Venda realizada',
  LOST: 'Perdido',
};

export const CONFIDENCE_LABELS_PT: Record<AttributionConfidence, string> = {
  OFFICIAL_REFERRAL: 'Confirmada por referência oficial',
  MANUAL: 'Informada manualmente',
  UNKNOWN: 'Origem desconhecida',
};

export const LOST_REASON_LABELS_PT: Record<LostReason, string> = {
  PRICE: 'Preço',
  NO_RESPONSE: 'Parou de responder',
  CHOSE_COMPETITOR: 'Escolheu outra clínica',
  NOT_A_CANDIDATE: 'Sem indicação para o procedimento',
  SCHEDULE_CONFLICT: 'Incompatibilidade de agenda',
  JUST_RESEARCHING: 'Apenas pesquisando',
  OTHER: 'Outro',
};
