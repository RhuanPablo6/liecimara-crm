// Link pessoal da paciente para confirmar, desmarcar ou pedir remarcação, sem login.
// O token é o id do agendamento + assinatura HMAC: não dá para adivinhar nem trocar de agendamento.
import { createHmac, timingSafeEqual } from 'node:crypto';

const sign = (id: string, secret: string) => createHmac('sha256', `${secret}:appointment-link`).update(id).digest('base64url').slice(0, 22);

export const appointmentToken = (id: string, secret: string) => `${id}.${sign(id, secret)}`;

/** Devolve o id do agendamento se o token for válido. */
export function readAppointmentToken(token: string, secret: string): string | null {
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[\w-]{6,64}$/.test(id)) return null;
  const expected = Buffer.from(sign(id, secret));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null;
}
