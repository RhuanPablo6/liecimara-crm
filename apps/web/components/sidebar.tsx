'use client';

import { BarChart3, BellRing, CalendarClock, CalendarDays, KanbanSquare, HeartHandshake, KeyRound, LayoutDashboard, LogOut, Megaphone, Menu, Package, Receipt, Settings, ShieldCheck, Target, Users, Wallet, FileText } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '@/components/access';
import { ChangePasswordDialog } from '@/components/change-password';
import { cn } from '@/lib/utils';

const NAV = [
  { key: 'painel', href: '/', label: 'Painel', icon: LayoutDashboard },
  { key: 'agenda', href: '/agenda', label: 'Agenda', icon: CalendarDays },
  { key: 'leads', href: '/leads', label: 'Leads', icon: Users },
  { key: 'orcamentos', href: '/orcamentos', label: 'Orçamentos', icon: FileText },
  { key: 'pacientes', href: '/pacientes', label: 'Pacientes', icon: HeartHandshake },
  { key: 'retornos', href: '/retornos', label: 'Retornos', icon: BellRing },
  { key: 'funil', href: '/funil', label: 'Funil', icon: KanbanSquare },
  { key: 'relatorios', href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { key: 'anuncios', href: '/anuncios', label: 'Anúncios', icon: Megaphone },
  { key: 'financeiro', href: '/financeiro', label: 'Financeiro', icon: Wallet },
  { key: 'contas', href: '/contas', label: 'Contas', icon: CalendarClock },
  { key: 'metas', href: '/metas', label: 'Metas', icon: Target },
  { key: 'compras', href: '/compras', label: 'Compras', icon: Package },
  { key: 'despesas', href: '/despesas', label: 'Despesas', icon: Receipt },
  { key: 'integracoes', href: '/configuracoes', label: 'Integrações', icon: Settings },
  { key: 'usuarios', href: '/usuarios', label: 'Usuários', icon: ShieldCheck },
];

export function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState(false);
  const me = useMe();
  const items = me ? NAV.filter((n) => me.screens.includes(n.key)) : [];

  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    window.location.href = '/login';
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-gold-400/15 text-gold-300' : 'text-navy-100 hover:bg-white/5 hover:text-white',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Barra superior no celular */}
      <header className="sticky top-0 z-40 flex h-14 print:hidden items-center justify-between bg-navy-800 px-4 md:hidden">
        <span className="font-serif text-lg text-gold-300">Liecimara</span>
        <button aria-label="Menu" onClick={() => setOpen((v) => !v)} className="text-white">
          <Menu className="h-5 w-5" />
        </button>
      </header>
      {open && <div className="fixed inset-0 z-40 bg-navy-900/50 md:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-navy-800 py-6 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 print:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-8 px-6">
          <p className="font-serif text-2xl text-gold-300">Liecimara</p>
          <p className="text-xs uppercase tracking-[0.2em] text-navy-200">Ads CRM</p>
        </div>
        {nav}
        <div className="border-t border-white/10 px-6 pt-4">
          <p className="truncate text-sm text-navy-100">{me?.user.name ?? ' '}</p>
          <div className="mt-2 flex items-center gap-4">
            <button onClick={() => setPwd(true)} className="flex items-center gap-2 text-xs text-navy-200 hover:text-white">
              <KeyRound className="h-3.5 w-3.5" /> Alterar senha
            </button>
            <button onClick={logout} className="flex items-center gap-2 text-xs text-navy-200 hover:text-white">
              <LogOut className="h-3.5 w-3.5" /> Sair
            </button>
          </div>
        </div>
      </aside>
      {pwd && <ChangePasswordDialog open={pwd} onOpenChange={setPwd} />}
    </>
  );
}
