import { loadEnv } from './config/env.js';
import { buildContainer } from './container.js';
import { buildServer } from './http/server.js';
import { startWorker } from './workerRuntime.js';

const env = loadEnv();
const container = buildContainer(env);
const app = buildServer(container);
// Hospedagem com um único serviço: a API também processa a fila.
const stopWorker = env.RUN_WORKER_IN_API ? startWorker(container, env) : () => {};

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
