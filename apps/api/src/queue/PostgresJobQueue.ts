import type { PrismaClient } from '../generated/prisma/client.js';
import { newId } from '../shared/ids.js';
import type { EnqueueOptions, JobQueue, JobRecord } from './JobQueue.js';

/**
 * Fila persistente sobre a tabela `jobs` (PostgreSQL).
 * Usa `FOR UPDATE SKIP LOCKED` para permitir vários workers sem disputa.
 * Jobs RUNNING presos (worker caiu) são devolvidos à fila após `staleAfterMs`.
 */
export class PostgresJobQueue implements JobQueue {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly staleAfterMs = 10 * 60 * 1000,
  ) {}

  async enqueue<P>(type: string, payload: P, opts: EnqueueOptions = {}): Promise<JobRecord<P> | null> {
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      INSERT INTO jobs (id, type, payload, status, "dedupKey", attempts, "maxAttempts", "runAt", "createdAt", "updatedAt")
      VALUES (${newId('job_')}, ${type}, ${JSON.stringify(payload)}::jsonb, 'PENDING', ${opts.dedupKey ?? null},
              0, ${opts.maxAttempts ?? 8}, ${opts.runAt ?? new Date()}, now(), now())
      ON CONFLICT ("dedupKey") DO NOTHING
      RETURNING *`;
    return rows[0] ? (toRecord(rows[0]) as JobRecord<P>) : null;
  }

  async claim(limit: number, workerId: string, now: Date): Promise<JobRecord[]> {
    const staleBefore = new Date(now.getTime() - this.staleAfterMs);
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      UPDATE jobs SET status = 'RUNNING', "lockedAt" = ${now}, "lockedBy" = ${workerId},
             attempts = attempts + 1, "updatedAt" = now()
      WHERE id IN (
        SELECT id FROM jobs
        WHERE (status = 'PENDING' AND "runAt" <= ${now})
           OR (status = 'RUNNING' AND "lockedAt" < ${staleBefore})
        ORDER BY "runAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    return rows.map(toRecord);
  }

  async complete(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE jobs SET status = 'DONE', "dedupKey" = NULL, "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
      WHERE id = ${id}`;
  }

  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    if (retryAt) {
      await this.prisma.$executeRaw`
        UPDATE jobs SET status = 'PENDING', "lastError" = ${error}, "runAt" = ${retryAt},
               "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
        WHERE id = ${id}`;
    } else {
      await this.prisma.$executeRaw`
        UPDATE jobs SET status = 'DEAD', "lastError" = ${error}, "dedupKey" = NULL,
               "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
        WHERE id = ${id}`;
    }
  }

  async requeue(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE jobs SET status = 'PENDING', attempts = 0, "runAt" = now(), "updatedAt" = now()
      WHERE id = ${id} AND status IN ('DEAD', 'FAILED')`;
  }

  async list(filter: { status?: JobRecord['status']; limit?: number } = {}): Promise<JobRecord[]> {
    const rows = await this.prisma.job.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: filter.limit ?? 100,
    });
    return rows.map((r) => toRecord(r as unknown as JobRow));
  }
}

interface JobRow {
  id: string;
  type: string;
  payload: unknown;
  status: JobRecord['status'];
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lastError: string | null;
  dedupKey: string | null;
}

function toRecord(r: JobRow): JobRecord {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    runAt: new Date(r.runAt),
    lastError: r.lastError,
    dedupKey: r.dedupKey,
  };
}
