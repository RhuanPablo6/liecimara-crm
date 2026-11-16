'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface ScreenInfo {
  key: string;
  label: string;
  path: string;
  group: string;
}

export interface Me {
  user: { id: string; name: string; email: string; role: string; isAdmin: boolean };
  permissions: string[];
  screens: string[];
  catalog: ScreenInfo[];
}

const AccessContext = createContext<Me | null>(null);

export const useMe = () => useContext(AccessContext);

/** Tela correspondente ao caminho (rotas filhas herdam a tela-mãe, ex.: /leads/123 → leads). */
export function screenOf(path: string, catalog: ScreenInfo[]): string | null {
  if (path === '/usuarios' || path.startsWith('/usuarios/')) return 'usuarios';
  if (path === '/') return 'painel';
  const hit = catalog.filter((s) => s.path !== '/').find((s) => path === s.path || path.startsWith(`${s.path}/`));
  return hit?.key ?? null;
}

export function firstAllowedPath(me: Me): string | null {
  const first = me.catalog.find((s) => me.screens.includes(s.key));
  return first?.path ?? (me.screens.includes('usuarios') ? '/usuarios' : null);
}

interface AccessState {
  me: Me | null;
  error: string | null;
}

const StateContext = createContext<AccessState>({ me: null, error: null });

/** Carrega quem está logado (uma vez) e disponibiliza para o menu e para o bloqueio de telas. */
export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AccessState>({ me: null, error: null });
  useEffect(() => {
    api<Me>('/auth/me')
      .then((me) => setState({ me, error: null }))
      .catch((e) => setState({ me: null, error: (e as Error).message }));
  }, []);
  return (
    <StateContext.Provider value={state}>
      <AccessContext.Provider value={state.me}>{children}</AccessContext.Provider>
    </StateContext.Provider>
  );
}

/** Mostra a tela só se ela estiver liberada para o usuário (a API também bloqueia). */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { me, error } = useContext(StateContext);
  const path = usePathname();
  const router = useRouter();
  const screen = me ? screenOf(path, me.catalog) : null;
  const allowed = !me || screen === null || me.screens.includes(screen);
  const redirectHome = !!me && path === '/' && !me.screens.includes('painel') && !!firstAllowedPath(me);

  useEffect(() => {
    if (redirectHome && me) router.replace(firstAllowedPath(me)!);
  }, [redirectHome, me, router]);

  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!me || redirectHome) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return allowed ? <>{children}</> : <NoAccess me={me} />;
}

function NoAccess({ me }: { me: Me }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border bg-white p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-gold-500" />
      <h1 className="mt-3 font-serif text-xl text-navy-800">Sem acesso a esta tela</h1>
      <p className="mt-2 text-sm text-muted-foreground">Peça ao administrador para liberar esta tela no seu usuário.</p>
      {firstAllowedPath(me) && (
        <Link href={firstAllowedPath(me)!} className="mt-4 inline-block text-sm font-medium text-navy-700 underline">
          Ir para minhas telas
        </Link>
      )}
    </div>
  );
}
