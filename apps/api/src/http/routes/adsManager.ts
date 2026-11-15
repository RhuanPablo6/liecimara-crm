// Gerenciador de anúncios no CRM (campanhas, conjuntos, anúncios; status, orçamento e programações).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { META_SYNC_JOB } from '../../modules/meta/MetaSyncService.js';
import { dayRange, isDay, spDay } from '../../shared/days.js';
import type { Guard } from '../server.js';

const day = z.string().refine(isDay, 'Data no formato AAAA-MM-DD');
const level = z.enum(['campaign', 'adset', 'ad']);
const budgetLevel = z.enum(['campaign', 'adset']);
const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });

export function registerAdsManagerRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.get('/ads-manager', { preHandler: guard('reports:read') }, async (req) => {
    const q = z
      .object({ from: day.optional(), to: day.optional(), accountId: z.string().optional(), includeArchived: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const today = spDay(new Date());
    const from = q.from ?? `${today.slice(0, 7)}-01`;
    const to = q.to ?? today;
    if (to < from) throw new DomainError('VALIDATION', 'A data final é anterior à inicial');
    const conn = await c.repos.connections.find('META_MARKETING', c.env.APP_ENV === 'production' ? 'PRODUCTION' : 'HOMOLOG');
    return {
      from,
      to,
      lastSyncAt: conn?.lastSyncAt ?? null,
      ...(await c.adsManager.tree(dayRange(from, to), { accountId: q.accountId || undefined, includeArchived: q.includeArchived === 'true' })),
    };
  });

  /** Busca agora os dados da Meta (status, orçamentos, gastos dos últimos 30 dias). */
  app.post('/ads-manager/sync', { preHandler: guard('reports:read') }, async () => {
    const job = await c.queue.enqueue(META_SYNC_JOB, { days: 30 }, { dedupKey: 'meta-sync' });
    return { queued: !!job };
  });

  app.post('/ads-manager/:level/:id/status', { preHandler: guard('ads:manage') }, async (req) => {
    const p = z.object({ level, id: z.string().min(1) }).parse(req.params);
    const b = z.object({ status: z.enum(['ACTIVE', 'PAUSED']) }).parse(req.body);
    return c.adsManager.setStatus(p.level, p.id, b.status, actorOf(req));
  });

  app.post('/ads-manager/:level/:id/budget', { preHandler: guard('ads:manage') }, async (req) => {
    const p = z.object({ level: budgetLevel, id: z.string().min(1) }).parse(req.params);
    const b = z.object({ kind: z.enum(['daily', 'lifetime']), cents: z.number().int().min(100).max(1_000_000_00) }).parse(req.body);
    return c.adsManager.setBudget(p.level, p.id, b.kind, b.cents, actorOf(req));
  });

  app.get('/ads-manager/:level/:id/schedules', { preHandler: guard('reports:read') }, async (req) => {
    const p = z.object({ level: budgetLevel, id: z.string().min(1) }).parse(req.params);
    return c.adsManager.schedules(p.level, p.id);
  });

  app.post('/ads-manager/:level/:id/schedules', { preHandler: guard('ads:manage') }, async (req) => {
    const p = z.object({ level: budgetLevel, id: z.string().min(1) }).parse(req.params);
    const b = z
      .object({
        windows: z
          .array(z.object({ start: z.coerce.date(), end: z.coerce.date(), increaseCents: z.number().int().positive() }))
          .min(1)
          .max(50),
      })
      .parse(req.body);
    return c.adsManager.createSchedules(p.level, p.id, b.windows, actorOf(req));
  });

  app.delete('/ads-manager/:level/:id/schedules/:scheduleId', { preHandler: guard('ads:manage') }, async (req) => {
    const p = z.object({ level: budgetLevel, id: z.string().min(1), scheduleId: z.string().min(1) }).parse(req.params);
    return c.adsManager.deleteSchedule(p.level, p.id, p.scheduleId, actorOf(req));
  });
}
