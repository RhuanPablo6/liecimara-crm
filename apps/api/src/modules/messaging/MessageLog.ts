import type { Contact, Conversation, Message, MessageDirection, MessageSource } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import { DAY_MS, maxDate, minDate } from '../../shared/ids.js';

/** Janela que separa conversas: 24h sem mensagens inicia nova conversa. */
export const CONVERSATION_GAP_MS = DAY_MS;

export interface ContactIdentity {
  waId: string | null;
  bsuid: string | null;
  name?: string | null;
  profileName?: string | null;
}

/**
 * Passos 1 e 2 do motor: identificar o contato e verificar se já existe.
 * Procura por wa_id e, na falta, pelo BSUID (identificador por username).
 * Datas de primeira/última mensagem usam o horário do evento, não o de chegada,
 * para tolerar eventos fora de ordem.
 */
export async function resolveContact(
  r: Repos,
  id: ContactIdentity,
  at: Date,
  opts: { preExisting?: boolean; touchLastMessage?: boolean } = {},
): Promise<{ contact: Contact; isNew: boolean }> {
  let contact = (id.waId && (await r.contacts.findByWaId(id.waId))) || (id.bsuid && (await r.contacts.findByBsuid(id.bsuid))) || null;

  if (!contact) {
    contact = await r.contacts.create({
      waId: id.waId,
      bsuid: id.bsuid,
      name: id.name ?? null,
      profileName: id.profileName ?? null,
      preExisting: opts.preExisting ?? false,
      firstSeenAt: at,
      lastMessageAt: opts.touchLastMessage === false ? null : at,
      removedFromAppAt: null,
    });
    return { contact, isNew: true };
  }

  const patch: Partial<Contact> = {};
  if (id.waId && !contact.waId) patch.waId = id.waId;
  if (id.bsuid && !contact.bsuid) patch.bsuid = id.bsuid;
  if (id.profileName && id.profileName !== contact.profileName) patch.profileName = id.profileName;
  if (id.name && !contact.name) patch.name = id.name;
  if (at < contact.firstSeenAt) patch.firstSeenAt = at;
  if (opts.touchLastMessage !== false) {
    const last = maxDate(contact.lastMessageAt, at);
    if (last.getTime() !== contact.lastMessageAt?.getTime()) patch.lastMessageAt = last;
  }
  if (Object.keys(patch).length) contact = await r.contacts.update(contact.id, patch);
  return { contact, isNew: false };
}

export interface RecordMessageInput {
  waMessageId: string;
  contactId: string;
  direction: MessageDirection;
  source: MessageSource;
  type: string;
  body: string | null;
  occurredAt: Date;
  status?: string | null;
  adReferralMetaId?: string | null;
  hasAdReferral?: boolean;
  receivedAt: Date;
}

/**
 * Grava a mensagem (idempotente por waMessageId) e a encaixa numa conversa.
 * Se a mensagem chegar fora de ordem, a janela da conversa é estendida.
 */
export async function recordMessage(
  r: Repos,
  input: RecordMessageInput,
): Promise<{ message: Message; conversation: Conversation; duplicate: boolean; conversationCreated: boolean }> {
  const existing = await r.messages.findByWaMessageId(input.waMessageId);
  if (existing) {
    const conv = existing.conversationId
      ? await r.conversations.findCovering(existing.contactId, existing.occurredAt, CONVERSATION_GAP_MS)
      : null;
    return { message: existing, conversation: conv!, duplicate: true, conversationCreated: false };
  }

  let conversation = await r.conversations.findCovering(input.contactId, input.occurredAt, CONVERSATION_GAP_MS);
  let conversationCreated = false;
  if (!conversation) {
    conversation = await r.conversations.create({
      contactId: input.contactId,
      startedAt: input.occurredAt,
      lastMessageAt: input.occurredAt,
      openedByAdMetaId: input.adReferralMetaId ?? null,
    });
    conversationCreated = true;
  } else {
    const startedAt = minDate(conversation.startedAt, input.occurredAt);
    const lastMessageAt = maxDate(conversation.lastMessageAt, input.occurredAt);
    const isNowFirst = input.occurredAt < conversation.startedAt;
    const patch: Partial<Conversation> = { startedAt, lastMessageAt };
    // Mensagem com referral que chegou atrasada, mas ocorreu antes: ela abriu a conversa.
    if (isNowFirst && input.adReferralMetaId) patch.openedByAdMetaId = input.adReferralMetaId;
    if (!conversation.openedByAdMetaId && input.adReferralMetaId && input.occurredAt <= conversation.startedAt) {
      patch.openedByAdMetaId = input.adReferralMetaId;
    }
    conversation = await r.conversations.update(conversation.id, patch);
  }

  const message = await r.messages.create({
    waMessageId: input.waMessageId,
    contactId: input.contactId,
    conversationId: conversation.id,
    direction: input.direction,
    source: input.source,
    type: input.type,
    body: input.body,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    status: input.status ?? null,
    hasAdReferral: input.hasAdReferral ?? false,
  });

  return { message, conversation, duplicate: false, conversationCreated };
}
