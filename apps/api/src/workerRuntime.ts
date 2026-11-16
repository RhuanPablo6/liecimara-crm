// Runtime do worker: consome a fila persistente (eventos WhatsApp, sincronização Meta)
// e executa rotinas periódicas. Três formas de uso:
// - processo dedicado (worker.ts);
// - embutido na API com laço contínuo (RUN_WORKER_IN_API=true), ex.: Render;
// - serverless (SERVERLESS=true, ex.: Vercel): sem processo contínuo, a fila é
//   "bombeada" depois de cada requisição e por uma tarefa agendada (/cron/tick).
import type { Env } from './config/env.js';
import type { Container } from './container.js';
import { META_SYNC_JOB } from './modules/meta/MetaSyncService.js';
import { PROCESS_EVENT_JOB } from './modules/whatsapp/WebhookIngestionService.js';
import { CONFIRMATIONS_JOB } from './modules/whatsapp/ConfirmationService.js';
import { Worker } from './queue/Worker.js';

export const workerLog = {
  info: (o: object, m?: string) => console.log(JSON.stringify({ level: 'info', msg: m, ...o })),
  warn: (o: object, m?: string) => console.warn(JSON.stringify({ level: 'warn', msg: m, ...o })),
  error: (o: object, m?: string) => console.error(JSON.stringify({ level: 'error', msg: m, ...o })),
};

function createWorker(c: Container, log = workerLog): Worker {
  return new Worker(c.queue, c.clock, `worker-${process.pid}`, log)
    .register(PROCESS_EVENT_JOB, (payload, job) => c.processor.handleJob(payload, job))
    .register(META_SYNC_JOB, async (payload: { days?: number }) => {
      const r = await c.metaSync.sync({ days: payload?.days ?? 30 });
      log.info(r, 'sincronização Meta concluída');
    })
    .register(CONFIRMATIONS_JOB, async () => {
      const r = await c.confirmations.runDue();
      if (r.sent || r.failed) log.info(r, 'confirmações pelo WhatsApp');
    });
}

/** Enfileira a sincronização da Meta se ela estiver configurada e desatualizada. */
async function enqueueMetaSyncIfStale(c: Container, env: Env): Promise<void> {
  const s = await c.integrations.metaStatus();
  if (!s.configured) return;
  const age = s.lastSyncAt ? Date.now() - new Date(s.lastSyncAt).getTime() : Infinity;
  if (age >= env.META_SYNC_CRON_MINUTES * 60_000) {
    await c.queue.enqueue(META_SYNC_JOB, { days: 7 }, { dedupKey: 'meta-sync' });
  }
}

/** Inicia o consumo contínuo da fila e as rotinas periódicas; devolve a função que para tudo. */
export function startWorker(c: Container, env: Env, log = workerLog): () => void {
  const worker = createWorker(c, log);
  worker.start(env.WORKER_POLL_INTERVAL_MS, env.WORKER_CONCURRENCY);

  const periodic = [
    setInterval(
      () => void c.queue.enqueue(META_SYNC_JOB, { days: 7 }, { dedupKey: 'meta-sync' }).catch((e) => log.error({ e: String(e) })),
      env.META_SYNC_CRON_MINUTES * 60_000,
    ),
    setInterval(
      () => void c.queue.enqueue(CONFIRMATIONS_JOB, {}, { dedupKey: 'whatsapp-confirmations' }).catch((e) => log.error({ e: String(e) })),
      10 * 60_000,
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

/**
 * Modo serverless: devolve `pump()`, que processa a fila até esvaziar ou até
 * `budgetMs`, reenfileira eventos órfãos e agenda a sincronização da Meta quando
 * desatualizada. Chamadas simultâneas na mesma instância são agrupadas, e as
 * chamadas sem `force` respeitam um intervalo mínimo.
 */
export function createPump(c: Container, env: Env, log = workerLog) {
  const worker = createWorker(c, log);
  let running: Promise<number> | null = null;
  let lastHousekeeping = 0;

  async function run(budgetMs: number, housekeeping: boolean): Promise<number> {
    const deadline = Date.now() + budgetMs;
    let processed = 0;
    if (housekeeping) {
      lastHousekeeping = Date.now();
      try {
        const n = await c.ingestion.sweepOrphans();
        if (n) log.warn({ n }, 'eventos órfãos reenfileirados');
        await enqueueMetaSyncIfStale(c, env);
        await c.queue.enqueue(CONFIRMATIONS_JOB, {}, { dedupKey: 'whatsapp-confirmations' });
      } catch (e) {
        log.error({ e: String(e) }, 'erro na manutenção da fila');
      }
    }
    while (Date.now() < deadline) {
      const n = await worker.tick(env.WORKER_CONCURRENCY);
      processed += n;
      if (n === 0) break;
    }
    return processed;
  }

  return function pump(opts: { force?: boolean; budgetMs?: number } = {}): Promise<number> {
    if (running) return running;
    const housekeeping = opts.force || Date.now() - lastHousekeeping > 60_000;
    running = run(opts.budgetMs ?? 20_000, housekeeping)
      .catch((e) => {
        log.error({ e: String(e) }, 'erro ao processar a fila');
        return 0;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
}
