import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { Container } from '../container.js';
import { DomainError, UnauthorizedError } from '../domain/errors.js';
import type { TokenClaims } from '../modules/auth/auth.js';
import { assertCan, type Permission } from '../modules/auth/rbac.js';
import { registerAdsManagerRoutes } from './routes/adsManager.js';
import { registerAgendaRoutes } from './routes/agenda.js';
import { registerPublicAppointmentRoutes } from './routes/publicAppointments.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerFinanceRoutes } from './routes/finance.js';
import { registerIntegrationRoutes } from './routes/integrations.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerPatientRoutes } from './routes/patients.js';
import { registerRecallRoutes } from './routes/recalls.js';
import { registerPurchaseRoutes } from './routes/purchases.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
    user?: TokenClaims;
  }
}

export function buildServer(c: Container) {
  const app = Fastify({
    logger: {
      level: c.env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]'],
    },
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });

  // Mantém o corpo bruto: a assinatura do webhook é calculada sobre os bytes originais.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString('utf8')) : {});
    } catch (err) {
      (err as any).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.register(cors, { origin: c.env.WEB_ORIGIN.split(','), credentials: true });
  app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const custom = err.issues.find((i) => i.code === 'custom');
      return reply.status(400).send({ error: 'VALIDATION', message: custom?.message ?? 'Dados inválidos', issues: err.issues });
    }
    if (err instanceof DomainError) {
      return reply.status(err.httpStatus).send({ error: err.code, message: err.message });
    }
    req.log.error({ err }, 'erro não tratado');
    return reply.status((err as any).statusCode ?? 500).send({ error: 'INTERNAL', message: 'Erro interno' });
  });

  /** preHandler: exige token válido e a permissão informada. */
  const guard = (permission: Permission) => async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();
    req.user = c.auth.authenticate(header.slice(7));
    assertCan(req.user.role, permission);
  };

  app.get('/health', async () => {
    await c.prisma.$queryRaw`SELECT 1`;
    return { ok: true, env: c.env.APP_ENV };
  });

  registerAuthRoutes(app, c, guard);
  registerWebhookRoutes(app, c);
  registerLeadRoutes(app, c, guard);
  registerReportRoutes(app, c, guard);
  registerIntegrationRoutes(app, c, guard);
  registerPurchaseRoutes(app, c, guard);
  registerFinanceRoutes(app, c, guard);
  registerPatientRoutes(app, c, guard);
  registerAdsManagerRoutes(app, c, guard);
  registerRecallRoutes(app, c, guard);
  registerAgendaRoutes(app, c, guard);
  registerPublicAppointmentRoutes(app, c);

  return app;
}

export type Guard = (permission: Permission) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export const actorOf = (req: FastifyRequest) => ({ id: req.user!.sub, role: req.user!.role, ip: req.ip });
