// Processo worker dedicado. Pode rodar em várias instâncias (a fila usa SKIP LOCKED).
import { loadEnv } from './config/env.js';
import { buildContainer } from './container.js';
import { startWorker } from './workerRuntime.js';

const env = loadEnv();
const c = buildContainer(env);
const stop = startWorker(c, env);

const shutdown = async () => {
  stop();
  await c.prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
