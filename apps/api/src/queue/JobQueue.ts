// Fila persistente de jobs. Em produção: PostgresJobQueue (tabela `jobs`,
// FOR UPDATE SKIP LOCKED). Em testes: InMemoryJobQueue.

export interface EnqueueOptions {
  /** Evita jobs duplicados enquanto houver um com a mesma chave. */
  dedupKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

export interface JobRecord<P = unknown> {
  id: string;
  type: string;
  payload: P;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'DEAD';
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lastError: string | null;
  dedupKey: string | null;
}

export interface JobQueue {
  enqueue<P>(type: string, payload: P, opts?: EnqueueOptions): Promise<JobRecord<P> | null>;
  /** Reserva até `limit` jobs prontos para execução. */
  claim(limit: number, workerId: string, now: Date): Promise<JobRecord[]>;
  complete(id: string): Promise<void>;
  /** Registra falha. Se `retryAt` for null o job vira DEAD. */
  fail(id: string, error: string, retryAt: Date | null): Promise<void>;
  /** Recoloca jobs DEAD/FAILED na fila (reprocessamento manual). */
  requeue(id: string): Promise<void>;
  list(filter?: { status?: JobRecord['status']; limit?: number }): Promise<JobRecord[]>;
}

/** Backoff exponencial com teto: 5s, 10s, 20s, ... até 1h. */
export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}
