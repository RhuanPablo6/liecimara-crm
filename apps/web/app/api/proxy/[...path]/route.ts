import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const RAW_API = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
// Aceita "host:porta" (rede privada da Render) além de URLs completas.
const API = (/^https?:\/\//.test(RAW_API) ? RAW_API : `http://${RAW_API}`).replace(/\/+$/, '');

/** Encaminha chamadas do navegador para a API, anexando o token do cookie httpOnly. */
async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const token = (await cookies()).get('crm_session')?.value;
  if (!token) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(req.url);
  const target = `${API}/${path.map(encodeURIComponent).join('/')}${url.search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  const res = await fetch(target, {
    method: req.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
    },
    body,
    cache: 'no-store',
  });
  // arrayBuffer: também serve as fotos do prontuário (binário) sem corromper.
  const headers: Record<string, string> = { 'content-type': res.headers.get('content-type') ?? 'application/json' };
  const cache = res.headers.get('cache-control');
  if (cache) headers['cache-control'] = cache;
  return new NextResponse(await res.arrayBuffer(), { status: res.status, headers });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
