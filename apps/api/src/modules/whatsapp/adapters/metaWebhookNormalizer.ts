// Converte o payload de webhook no formato Meta (object = whatsapp_business_account)
// em eventos normalizados. Usado pela Cloud API direta e por parceiros que
// repassam o payload da Meta sem alteração.
//
// Campos tratados: messages (mensagens + statuses), smb_message_echoes,
// smb_app_state_sync, history, account_update.

import { sha256 } from '../webhookSignature.js';
import type { AdReferral, NormalizedEvent } from '../events.js';

const tsToIso = (ts: unknown, fallback: Date): string => {
  const n = typeof ts === 'string' ? Number(ts) : typeof ts === 'number' ? ts : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : fallback.toISOString();
};

const textOf = (m: any): string | null =>
  m?.text?.body ??
  m?.button?.text ??
  m?.interactive?.button_reply?.title ??
  m?.interactive?.list_reply?.title ??
  m?.image?.caption ??
  m?.video?.caption ??
  m?.document?.caption ??
  null;

function referralOf(m: any): AdReferral | null {
  const r = m?.referral;
  if (!r || typeof r !== 'object') return null;
  return {
    sourceType: String(r.source_type ?? 'unknown'),
    sourceId: r.source_id ? String(r.source_id) : null,
    sourceUrl: r.source_url ?? null,
    headline: r.headline ?? null,
    body: r.body ?? null,
    mediaType: r.media_type ?? null,
    ctwaClid: r.ctwa_clid ?? null,
  };
}

export function normalizeMetaWebhook(payload: any, receivedAt = new Date()): NormalizedEvent[] {
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return [];
  const out: NormalizedEvent[] = [];

  for (const entry of payload.entry) {
    const wabaId: string | null = entry?.id ? String(entry.id) : null;
    for (const change of entry?.changes ?? []) {
      const field: string = change?.field;
      const v = change?.value ?? {};
      const phoneNumberId: string | null = v?.metadata?.phone_number_id ?? null;
      const base = { wabaId, phoneNumberId };

      switch (field) {
        case 'messages': {
          const profiles = new Map<string, { name: string | null; bsuid: string | null }>();
          for (const c of v.contacts ?? []) {
            profiles.set(c.wa_id ?? c.user_id, { name: c.profile?.name ?? c.profile?.username ?? null, bsuid: c.user_id ?? null });
          }
          for (const m of v.messages ?? []) {
            const prof = profiles.get(m.from) ?? profiles.get(m.from_user_id) ?? null;
            out.push({
              ...base,
              kind: 'MESSAGE_INBOUND',
              dedupKey: `msg:${m.id}`,
              occurredAt: tsToIso(m.timestamp, receivedAt),
              waMessageId: m.id,
              fromWaId: m.from ?? null,
              fromBsuid: m.from_user_id ?? prof?.bsuid ?? null,
              profileName: prof?.name ?? null,
              type: m.type ?? 'unknown',
              text: textOf(m),
              referral: referralOf(m),
            });
          }
          for (const s of v.statuses ?? []) {
            out.push({
              ...base,
              kind: 'MESSAGE_STATUS',
              dedupKey: `status:${s.id}:${s.status}`,
              occurredAt: tsToIso(s.timestamp, receivedAt),
              waMessageId: s.id,
              status: s.status,
              recipientWaId: s.recipient_id ?? null,
              errors: (s.errors ?? []).map((e: any) => ({ code: e.code, title: e.title ?? e.message ?? '' })),
            });
          }
          break;
        }

        case 'smb_message_echoes': {
          for (const m of v.message_echoes ?? []) {
            out.push({
              ...base,
              kind: 'MESSAGE_ECHO',
              dedupKey: `echo:${m.id}`,
              occurredAt: tsToIso(m.timestamp, receivedAt),
              waMessageId: m.id,
              toWaId: m.to ?? null,
              toBsuid: m.to_user_id ?? null,
              type: m.type ?? 'unknown',
              text: textOf(m),
            });
          }
          break;
        }

        case 'smb_app_state_sync': {
          for (const s of v.state_sync ?? []) {
            if (s.type !== 'contact' || !s.contact?.phone_number) continue;
            const ts = s.metadata?.timestamp;
            out.push({
              ...base,
              kind: 'CONTACT_SYNC',
              dedupKey: `contact:${s.contact.phone_number}:${s.action}:${ts ?? sha256(JSON.stringify(s))}`,
              occurredAt: tsToIso(ts, receivedAt),
              phone: String(s.contact.phone_number).replace(/\D/g, ''),
              bsuid: s.contact.user_id ?? null,
              fullName: s.contact.full_name ?? null,
              firstName: s.contact.first_name ?? null,
              action: s.action === 'remove' ? 'remove' : 'add',
            });
          }
          break;
        }

        case 'history': {
          for (const h of v.history ?? []) {
            const md = h.metadata ?? {};
            const declined = (h.errors ?? []).find((e: any) => e.code === 2593109);
            out.push({
              ...base,
              kind: 'HISTORY_PROGRESS',
              dedupKey: `historyprog:${phoneNumberId}:${md.phase ?? '-'}:${md.chunk_order ?? '-'}:${md.progress ?? '-'}:${declined ? 'declined' : 'ok'}`,
              occurredAt: receivedAt.toISOString(),
              phase: md.phase ?? null,
              chunkOrder: md.chunk_order ?? null,
              progress: md.progress ?? null,
              declinedCode: declined ? 2593109 : null,
            });
            for (const thread of h.threads ?? []) {
              const contactWaId = String(thread.id ?? thread.context?.wa_id ?? '');
              for (const m of thread.messages ?? []) {
                if (!m?.id || !contactWaId) continue;
                out.push({
                  ...base,
                  kind: 'HISTORY_MESSAGE',
                  dedupKey: `history:${m.id}`,
                  occurredAt: tsToIso(m.timestamp, receivedAt),
                  waMessageId: m.id,
                  contactWaId,
                  // Mensagens enviadas pela empresa trazem o campo "to".
                  direction: m.to ? 'OUTBOUND' : 'INBOUND',
                  type: m.type ?? 'unknown',
                  text: textOf(m),
                  status: m.history_context?.status ?? null,
                });
              }
            }
          }
          break;
        }

        case 'account_update': {
          out.push({
            ...base,
            kind: 'ACCOUNT_UPDATE',
            dedupKey: `account:${wabaId}:${v.event}:${entry.time ?? sha256(JSON.stringify(v))}`,
            occurredAt: entry.time ? tsToIso(entry.time, receivedAt) : receivedAt.toISOString(),
            event: String(v.event ?? 'UNKNOWN'),
            reason: v.disconnection_info?.reason ?? null,
            initiatedBy: v.disconnection_info?.initiated_by ?? null,
          });
          break;
        }

        default:
          out.push({
            ...base,
            kind: 'UNKNOWN',
            field: String(field),
            dedupKey: `unknown:${field}:${sha256(JSON.stringify(v))}`,
            occurredAt: receivedAt.toISOString(),
          });
      }
    }
  }
  return out;
}
