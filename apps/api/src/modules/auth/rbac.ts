import { ForbiddenError } from '../../domain/errors.js';
import type { Role } from '../../domain/types.js';

export type Permission =
  | 'leads:read'
  | 'leads:write'
  | 'sales:write'
  | 'payments:write'
  | 'attribution:manual'
  | 'reports:read'
  | 'integrations:read'
  | 'integrations:write'
  | 'events:reprocess'
  | 'users:manage'
  | 'audit:read'
  | 'procedures:manage'
  | 'purchases:read'
  | 'purchases:write'
  | 'finance:read'
  | 'finance:write'
  | 'ads:manage'
  | 'messages:manage'
  /** Apagar de vez (lead de teste, lançamento errado). Só administrador. */
  | 'records:delete'
  | 'app:use';

const MATRIX: Record<Role, readonly Permission[]> = {
  ADMIN: [
    'leads:read',
    'leads:write',
    'sales:write',
    'payments:write',
    'attribution:manual',
    'reports:read',
    'integrations:read',
    'integrations:write',
    'events:reprocess',
    'users:manage',
    'audit:read',
    'procedures:manage',
    'purchases:read',
    'purchases:write',
    'finance:read',
    'finance:write',
    'ads:manage',
    'messages:manage',
    'records:delete',
    'app:use',
  ],
  MANAGER: [
    'leads:read',
    'leads:write',
    'sales:write',
    'payments:write',
    'attribution:manual',
    'reports:read',
    'integrations:read',
    'events:reprocess',
    'audit:read',
    'procedures:manage',
    'purchases:read',
    'purchases:write',
    'finance:read',
    'finance:write',
    'ads:manage',
    'messages:manage',
    'app:use',
  ],
  RECEPTIONIST: ['leads:read', 'leads:write', 'sales:write', 'payments:write', 'attribution:manual', 'reports:read'],
  VIEWER: ['leads:read', 'reports:read'],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(`Perfil ${role} não possui a permissão ${permission}`);
}

export function permissionsOf(role: Role): readonly Permission[] {
  return MATRIX[role];
}
