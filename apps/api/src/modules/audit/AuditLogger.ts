import type { AuditEntry } from '../../domain/types.js';
import type { AuditRepo } from '../../ports/repositories.js';

const SENSITIVE_KEYS = /pass(word)?|token|secret|credential|authorization/i;

/** Remove campos sensíveis antes de gravar no log de auditoria. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v)]),
    );
  }
  return value;
}

export class AuditLogger {
  constructor(private readonly repo: AuditRepo) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.repo.log({ ...entry, before: redact(entry.before), after: redact(entry.after) });
  }
}
