import { NextResponse } from 'next/server';

const RAW_API = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const API = (/^https?:\/\//.test(RAW_API) ? RAW_API : `http://${RAW_API}`).replace(/\/+$/, '');

/** Encaminha só as rotas públicas da API (página da paciente), sem token. */
async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = `${API}/public/${path.map(encodeURIComponent).join('/')}`;
  const body = req.method === 'GET' ? undefined : await req.text();
  const res = await fetch(target, {
    method: req.method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      // Registrado junto da assinatura do termo (prova de onde foi assinado).
      'user-agent': req.headers.get('user-agent') ?? '',
    },
    body,
    cache: 'no-store',
  });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}

export { forward as GET, forward as POST };
