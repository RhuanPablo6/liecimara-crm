import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import Fastify from 'fastify';
import { loadEnv, type Env } from './config/env.js';
import { buildContainer } from './container.js';
import { buildServer } from './http/server.js';
import { createPump, startWorker } from './workerRuntime.js';

const isServerless = !!process.env.VERCEL || process.env.SERVERLESS === 'true';

/**
 * Configuração incompleta: em ambiente serverless, em vez de derrubar a função
 * (erro 500 sem explicação), sobe um servidor mínimo que responde 503 dizendo o
 * que falta. A mensagem só contém nomes de variáveis, nunca valores.
 */
function startConfigErrorServer(message: string) {
  const fallback = Fastify();
  fallback.all('/*', async (_req, reply) =>
    reply.code(503).send({
      ok: false,
      error: 'CONFIG',
      message,
      help: 'Confira as Environment Variables do projeto da API e faça Redeploy.',
    }),
  );
  void fallback.listen({ port: Number(process.env.PORT) || 4000, host: '0.0.0.0' });
}

function start(env: Env) {
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

  if (!env.SERVERLESS) {
    const shutdown = async () => {
      stopWorker();
      await app.close();
      await container.prisma.$disconnect();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  // Sem `await` no nível do módulo: na Vercel o listen é interceptado pela plataforma
  // e a inicialização do módulo não pode ficar esperando por ele.
  app
    .listen({ port: env.API_PORT, host: '0.0.0.0' })
    .then(() => app.log.info(`API Liecimara Ads CRM (${env.APP_ENV}) em ${env.API_PUBLIC_URL}`))
    .catch((err) => {
      app.log.error(err, 'falha ao iniciar o servidor');
      if (!env.SERVERLESS) process.exit(1);
    });
}

let env: Env | null = null;
try {
  env = loadEnv();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  if (!isServerless) throw err;
  startConfigErrorServer(message);
}
if (env) start(env);
