// Eventos normalizados, independentes do fornecedor (Meta direto ou parceiro).
// Todo adaptador converte o payload bruto do webhook nestes formatos.

export interface AdReferral {
  /** referral.source_type: "ad" | "post" */
  sourceType: string;
  /** referral.source_id: ID do anúncio quando sourceType = "ad" */
  sourceId: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  /** Click-to-WhatsApp click ID (usado na Conversions API) */
  ctwaClid: string | null;
}

interface Base {
  dedupKey: string;
  occurredAt: string; // ISO
  phoneNumberId: string | null;
  wabaId: string | null;
}

export interface InboundMessageEvent extends Base {
  kind: 'MESSAGE_INBOUND';
  waMessageId: string;
  fromWaId: string | null;
  fromBsuid: string | null;
  profileName: string | null;
  type: string;
  text: string | null;
  referral: AdReferral | null;
  /** Botão tocado pela paciente (payload do modelo ou id do botão interativo). */
  buttonPayload?: string | null;
}

/** Mensagem enviada pela recepção no app WhatsApp Business (smb_message_echoes). */
export interface BusinessEchoEvent extends Base {
  kind: 'MESSAGE_ECHO';
  waMessageId: string;
  toWaId: string | null;
  toBsuid: string | null;
  type: string;
  text: string | null;
}

export interface MessageStatusEvent extends Base {
  kind: 'MESSAGE_STATUS';
  waMessageId: string;
  status: string; // sent | delivered | read | failed
  recipientWaId: string | null;
  errors: { code: number; title: string }[];
  /** Id da mensagem no parceiro (YCloud) e o externalId que mandamos no envio (id do agendamento). */
  providerMessageId?: string | null;
  externalId?: string | null;
}

export interface ContactSyncEvent extends Base {
  kind: 'CONTACT_SYNC';
  phone: string;
  bsuid: string | null;
  fullName: string | null;
  firstName: string | null;
  action: 'add' | 'remove';
}

export interface HistoryMessageEvent extends Base {
  kind: 'HISTORY_MESSAGE';
  waMessageId: string;
  contactWaId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  text: string | null;
  status: string | null;
}

export interface HistoryProgressEvent extends Base {
  kind: 'HISTORY_PROGRESS';
  phase: number | null;
  chunkOrder: number | null;
  progress: number | null;
  declinedCode: number | null;
}

export interface AccountUpdateEvent extends Base {
  kind: 'ACCOUNT_UPDATE';
  event: string; // PARTNER_REMOVED | ACCOUNT_OFFBOARDED | ACCOUNT_RECONNECTED | ...
  reason: string | null;
  initiatedBy: string | null;
}

export interface UnknownEvent extends Base {
  kind: 'UNKNOWN';
  field: string;
}

export type NormalizedEvent =
  | InboundMessageEvent
  | BusinessEchoEvent
  | MessageStatusEvent
  | ContactSyncEvent
  | HistoryMessageEvent
  | HistoryProgressEvent
  | AccountUpdateEvent
  | UnknownEvent;
