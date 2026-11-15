import { PermanentError } from '../domain/errors.js';
import type { Clock } from '../shared/ids.js';
import { backoffMs, type JobQueue, type JobRecord } from './JobQueue.js';

export type JobHandler = (payload: any, job: JobRecord) => Promise<void>;

export interface WorkerLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const silentLogger: WorkerLogger = { info() {}, warn() {}, error() {} };

/**
 * Executa jobs da fila com retry/backoff.
 * - RetryableError ou erros desconhecidos → nova tentativa com backoff exponencial.
 * - PermanentError → DEAD imediatamente.
 * - Excedeu maxAttempts → DEAD (pode ser reprocessado manualmente).
 */
export class Worker {
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly clock: Clock,
    private readonly workerId = `worker-${process.pid}`,
    private readonly logger: WorkerLogger = silentLogger,
  ) {}

  register(type: string, handler: JobHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  /** Processa um lote. Retorna quantos jobs foram executados. */
  async tick(batch = 10): Promise<number> {
    const jobs = await this.queue.claim(batch, this.workerId, this.clock.now());
    for (const job of jobs) await this.runOne(job);
    return jobs.length;
  }

  /** Processa até a fila esvaziar (útil em testes). Não espera backoff. */
  async drain(maxRounds = 100): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      if ((await this.tick()) === 0) return;
    }
  }

  private async runOne(job: JobRecord): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.queue.fail(job.id, `Sem handler para ${job.type}`, null);
      return;
    }
    try {
      await handler(job.payload, job);
      await this.queue.complete(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentError;
      const exhausted = job.attempts >= job.maxAttempts;
      const retryAt =
        permanent || exhausted ? null : new Date(this.clock.now().getTime() + backoffMs(job.attempts));
      this.logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, err: message }, 'job falhou');
      await this.queue.fail(job.id, message, retryAt);
    }
  }

  start(intervalMs: number, concurrency: number): void {
    if (this.timer) return;
    const loop = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tick(concurrency);
      } catch (err) {
        this.logger.error({ err: String(err) }, 'erro no ciclo do worker');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(loop, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
