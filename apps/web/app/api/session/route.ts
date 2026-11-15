import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const RAW_API = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
// Aceita "host:porta" (rede privada da Render) além de URLs completas.
const API = (/^https?:\/\//.test(RAW_API) ? RAW_API : `http://${RAW_API}`).replace(/\/+$/, '');
const COOKIE = 'crm_session';

/** Login: troca e-mail/senha por token e guarda em cookie httpOnly (inacessível a JavaScript). */
export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  (await cookies()).set(COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  return NextResponse.json({ user: data.user, permissions: data.permissions });
}

export async function DELETE() {
  (await cookies()).delete(COOKIE);
  return NextResponse.json({ ok: true });
}
