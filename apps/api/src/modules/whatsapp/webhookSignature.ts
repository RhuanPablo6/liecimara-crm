import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valida X-Hub-Signature-256 da Meta: "sha256=" + HMAC-SHA256(app_secret, corpo bruto).
 * O corpo DEVE ser o buffer original recebido (antes de qualquer JSON.parse).
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [algo, given] = header.split('=');
  if (algo !== 'sha256' || !given) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  let givenBuf: Buffer;
  try {
    givenBuf = Buffer.from(given, 'hex');
  } catch {
    return false;
  }
  return givenBuf.length === expected.length && timingSafeEqual(givenBuf, expected);
}

export function signMetaPayload(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** Verificação do handshake GET (hub.mode / hub.verify_token / hub.challenge). */
export function verifySubscription(
  query: Record<string, string | undefined>,
  expectedToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || !token || !challenge || !expectedToken) return { ok: false };
  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, challenge };
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
