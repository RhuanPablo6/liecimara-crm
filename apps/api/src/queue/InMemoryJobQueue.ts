import { newId } from '../shared/ids.js';
import type { EnqueueOptions, JobQueue, JobRecord } from './JobQueue.js';

export class InMemoryJobQueue implements JobQueue {
  readonly jobs = new Map<string, JobRecord>();

  async enqueue<P>(type: string, payload: P, opts: EnqueueOptions = {}): Promise<JobRecord<P> | null> {
    if (opts.dedupKey) {
      for (const j of this.jobs.values()) {
        if (j.dedupKey === opts.dedupKey) return null;
      }
    }
    const job: JobRecord<P> = {
      id: newId('job_'),
      type,
      payload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 8,
      runAt: opts.runAt ?? new Date(0),
      lastError: null,
      dedupKey: opts.dedupKey ?? null,
    };
    this.jobs.set(job.id, job as JobRecord);
    return job;
  }

  async claim(limit: number, _workerId: string, now: Date): Promise<JobRecord[]> {
    const ready = [...this.jobs.values()]
      .filter((j) => j.status === 'PENDING' && j.runAt <= now)
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
      .slice(0, limit);
    for (const j of ready) {
      j.status = 'RUNNING';
      j.attempts += 1;
    }
    return ready.map((j) => ({ ...j }));
  }

  async complete(id: string): Promise<void> {
    const j = this.jobs.get(id);
    if (j) {
      j.status = 'DONE';
      // libera a chave de deduplicação para execuções futuras (ex.: sync periódico)
      j.dedupKey = null;
    }
  }

  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    const j = this.jobs.get(id);
    if (!j) return;
    j.lastError = error;
    if (retryAt) {
      j.status = 'PENDING';
      j.runAt = retryAt;
    } else {
      j.status = 'DEAD';
      j.dedupKey = null;
    }
  }

  async requeue(id: string): Promise<void> {
    const j = this.jobs.get(id);
    if (j && (j.status === 'DEAD' || j.status === 'FAILED')) {
      j.status = 'PENDING';
      j.attempts = 0;
      j.runAt = new Date(0);
    }
  }

  async list(filter: { status?: JobRecord['status']; limit?: number } = {}): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => !filter.status || j.status === filter.status)
      .slice(0, filter.limit ?? 100);
  }
}
