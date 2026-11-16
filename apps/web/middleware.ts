import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'crm_session';

/** Redireciona para /login quando não há sessão. A validação real do token ocorre na API. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // /c/... e /api/public/...: página da paciente (link de confirmação), sem login.
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/session') ||
    pathname.startsWith('/c/') ||
    pathname.startsWith('/o/') ||
    pathname.startsWith('/f/') ||
    pathname.startsWith('/api/public/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';
  if (isPublic) return NextResponse.next();
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
