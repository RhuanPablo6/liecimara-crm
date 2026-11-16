// Telas do CRM e o que cada uma libera na API. Usuário personalizado = soma das telas marcadas.
// Administrador vê tudo (inclusive Usuários e Integrações).
import type { Role, User } from '../../domain/types.js';
import { type Permission, permissionsOf } from './rbac.js';

export interface Screen {
  key: string;
  label: string;
  path: string;
  group: string;
  permissions: Permission[];
}

export const SCREENS: Screen[] = [
  { key: 'painel', label: 'Painel', path: '/', group: 'Atendimento', permissions: ['reports:read', 'leads:read'] },
  { key: 'agenda', label: 'Agenda', path: '/agenda', group: 'Atendimento', permissions: ['leads:read', 'leads:write'] },
  { key: 'leads', label: 'Leads', path: '/leads', group: 'Atendimento', permissions: ['leads:read', 'leads:write', 'attribution:manual', 'sales:write', 'payments:write'] },
  { key: 'orcamentos', label: 'Orçamentos', path: '/orcamentos', group: 'Atendimento', permissions: ['leads:read', 'leads:write', 'sales:write'] },
  { key: 'pacientes', label: 'Pacientes', path: '/pacientes', group: 'Atendimento', permissions: ['leads:read', 'leads:write'] },
  { key: 'retornos', label: 'Retornos', path: '/retornos', group: 'Atendimento', permissions: ['leads:read', 'leads:write', 'messages:manage'] },
  { key: 'funil', label: 'Funil', path: '/funil', group: 'Atendimento', permissions: ['leads:read', 'leads:write'] },
  { key: 'relatorios', label: 'Relatórios', path: '/relatorios', group: 'Marketing', permissions: ['reports:read'] },
  { key: 'anuncios', label: 'Anúncios', path: '/anuncios', group: 'Marketing', permissions: ['reports:read', 'ads:manage', 'procedures:manage'] },
  { key: 'financeiro', label: 'Financeiro', path: '/financeiro', group: 'Financeiro', permissions: ['finance:read', 'finance:write', 'sales:write', 'payments:write', 'procedures:manage'] },
  { key: 'contas', label: 'Contas', path: '/contas', group: 'Financeiro', permissions: ['finance:read', 'finance:write', 'payments:write'] },
  { key: 'metas', label: 'Metas', path: '/metas', group: 'Financeiro', permissions: ['finance:read', 'finance:write'] },
  { key: 'compras', label: 'Compras', path: '/compras', group: 'Financeiro', permissions: ['purchases:read', 'purchases:write'] },
  { key: 'despesas', label: 'Despesas', path: '/despesas', group: 'Financeiro', permissions: ['finance:read', 'finance:write'] },
  { key: 'integracoes', label: 'Integrações', path: '/configuracoes', group: 'Administração', permissions: ['integrations:read', 'integrations:write', 'events:reprocess'] },
];

export const SCREEN_KEYS = SCREENS.map((s) => s.key);

/** Modelos prontos para agilizar o cadastro. */
export const SCREEN_PRESETS: Record<string, { label: string; screens: string[] }> = {
  reception: { label: 'Recepção', screens: ['painel', 'agenda', 'leads', 'orcamentos', 'pacientes', 'retornos', 'funil'] },
  finance: { label: 'Financeiro', screens: ['financeiro', 'contas', 'metas', 'compras', 'despesas'] },
  marketing: { label: 'Marketing', screens: ['painel', 'relatorios', 'anuncios', 'leads'] },
};

/** Permissões efetivas: administrador = tudo; com telas marcadas = soma das telas; sem telas = perfil antigo. */
export function effectivePermissions(user: Pick<User, 'role' | 'screens'>): Permission[] {
  const base: Permission[] = ['app:use'];
  if (user.role === 'ADMIN') return [...new Set([...base, ...permissionsOf('ADMIN')])];
  if (Array.isArray(user.screens)) {
    return [...new Set([...base, ...user.screens.flatMap((k) => SCREENS.find((s) => s.key === k)?.permissions ?? [])])];
  }
  return [...new Set([...base, ...permissionsOf(user.role as Role)])];
}

/** Telas que o usuário vê no menu. */
export function effectiveScreens(user: Pick<User, 'role' | 'screens'>): string[] {
  if (user.role === 'ADMIN') return [...SCREEN_KEYS, 'usuarios'];
  if (Array.isArray(user.screens)) return SCREEN_KEYS.filter((k) => user.screens!.includes(k));
  // Usuário antigo sem telas definidas: deduz pelas permissões do perfil.
  const perms = new Set(permissionsOf(user.role as Role));
  return SCREENS.filter((s) => s.permissions.every((p) => perms.has(p))).map((s) => s.key);
}
