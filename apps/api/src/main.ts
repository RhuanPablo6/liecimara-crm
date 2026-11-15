import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { loadEnv } from './config/env.js';
import { buildContainer } from './container.js';
import { buildServer } from './http/server.js';
import { createPump, startWorker } from './workerRuntime.js';

const env = loadEnv();
const container = buildContainer(env);
const app = buildServer(container);

let stopWorker = () => {};
if (env.SERVERLESS) {
  // Sem processo contínuo: depois de cada resposta, processa a fila em segundo plano
  // (waitUntil mantém a função viva até terminar).
  const pump = createPump(container, env);
  app.addHook('onResponse', async (req) => {
    if (req.url.startsWith('/health') || req.url.startsWith('/cron/')) return;
    waitUntil(pump());
  });

  // Tarefa agendada: garante o processamento mesmo sem movimento no painel.
  app.get('/cron/tick', async (req, reply) => {
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    const got = Buffer.from(req.headers.authorization ?? '');
    if (!env.CRON_SECRET || got.length !== expected.length || !timingSafeEqual(got, expected)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
    const processed = await pump({ force: true, budgetMs: 50_000 });
    return { ok: true, processed };
  });
} else if (env.RUN_WORKER_IN_API) {
  // Hospedagem com um único serviço (ex.: Render): a API também roda o worker contínuo.
  stopWorker = startWorker(container, env);
}

const shutdown = async () => {
  stopWorker();
  await app.close();
  await container.prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
app.log.info(`API Liecimara Ads CRM (${env.APP_ENV}) em ${env.API_PUBLIC_URL}`);
