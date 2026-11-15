// Runtime do worker: consome a fila persistente (eventos WhatsApp, sincronização Meta)
// e executa rotinas periódicas. Usado pelo processo worker dedicado (worker.ts) ou
// embutido na API (RUN_WORKER_IN_API=true), para hospedagens com um único serviço.
import type { Env } from './config/env.js';
import type { Container } from './container.js';
import { META_SYNC_JOB } from './modules/meta/MetaSyncService.js';
import { PROCESS_EVENT_JOB } from './modules/whatsapp/WebhookIngestionService.js';
import { Worker } from './queue/Worker.js';

export const workerLog = {
  info: (o: object, m?: string) => console.log(JSON.stringify({ level: 'info', msg: m, ...o })),
  warn: (o: object, m?: string) => console.warn(JSON.stringify({ level: 'warn', msg: m, ...o })),
  error: (o: object, m?: string) => console.error(JSON.stringify({ level: 'error', msg: m, ...o })),
};

/** Inicia o consumo da fila e as rotinas periódicas; devolve a função que para tudo. */
export function startWorker(c: Container, env: Env, log = workerLog): () => void {
  const worker = new Worker(c.queue, c.clock, `worker-${process.pid}`, log)
    .register(PROCESS_EVENT_JOB, (payload, job) => c.processor.handleJob(payload, job))
    .register(META_SYNC_JOB, async (payload: { days?: number }) => {
      const r = await c.metaSync.sync({ days: payload?.days ?? 30 });
      log.info(r, 'sincronização Meta concluída');
    });

  worker.start(env.WORKER_POLL_INTERVAL_MS, env.WORKER_CONCURRENCY);

  const periodic = [
    setInterval(
      () => void c.queue.enqueue(META_SYNC_JOB, { days: 7 }, { dedupKey: 'meta-sync' }).catch((e) => log.error({ e: String(e) })),
      env.META_SYNC_CRON_MINUTES * 60_000,
    ),
    setInterval(
      () =>
        void c.ingestion
          .sweepOrphans()
          .then((n) => n && log.warn({ n }, 'eventos órfãos reenfileirados'))
          .catch((e) => log.error({ e: String(e) })),
      60_000,
    ),
  ];

  log.info({ env: env.APP_ENV }, 'worker iniciado');
  return () => {
    worker.stop();
    periodic.forEach(clearInterval);
  };
}
