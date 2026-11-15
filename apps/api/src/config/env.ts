import { z } from 'zod';

const schema = z.object({
  APP_ENV: z.enum(['homolog', 'production']).default('homolog'),
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres'),
  JWT_TTL_SECONDS: z.coerce.number().default(43200),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(40, 'Gere com: openssl rand -base64 32'),
  META_GRAPH_VERSION: z.string().default('v23.0'),
  META_APP_SECRET: z.string().default(''),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default(''),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(1000),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  META_SYNC_CRON_MINUTES: z.coerce.number().default(60),
  LEAD_REOPEN_AFTER_DAYS: z.coerce.number().default(30),
  // Ambiente sem processo contínuo (Vercel): a fila é processada após cada requisição.
  SERVERLESS: z
    .enum(['true', 'false', '1', '0', ''])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Segredo das tarefas agendadas (/cron/tick). Na Vercel, o cron envia "Authorization: Bearer <CRON_SECRET>".
  CRON_SECRET: z.string().default(''),
  RUN_WORKER_IN_API: z
    .enum(['true', 'false', '1', '0', ''])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Render: porta em PORT e URL pública em RENDER_EXTERNAL_URL.
  // Vercel: VERCEL=1 e domínio de produção em VERCEL_PROJECT_PRODUCTION_URL.
  const parsed = schema.safeParse({
    ...source,
    API_PORT: source.API_PORT || source.PORT || undefined,
    API_PUBLIC_URL:
      source.API_PUBLIC_URL ||
      source.RENDER_EXTERNAL_URL ||
      (source.VERCEL_PROJECT_PRODUCTION_URL ? `https://${source.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
    SERVERLESS: source.SERVERLESS || (source.VERCEL ? 'true' : undefined),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${msg}`);
  }
  if (parsed.data.APP_ENV === 'production' && (!parsed.data.META_APP_SECRET || !parsed.data.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
    throw new Error('Em produção, META_APP_SECRET e WHATSAPP_WEBHOOK_VERIFY_TOKEN são obrigatórios');
  }
  return parsed.data;
}
