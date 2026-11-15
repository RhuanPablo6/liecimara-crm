import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { METRIC_DEFINITIONS } from '../../modules/metrics/MetricsService.js';
import type { Guard } from '../server.js';

/** Período padrão: últimos 30 dias (fuso de São Paulo tratado no frontend). */
function rangeOf(req: FastifyRequest) {
  const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

export function registerReportRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.get('/reports/definitions', { preHandler: guard('reports:read') }, async () => METRIC_DEFINITIONS);
  app.get('/reports/summary', { preHandler: guard('reports:read') }, async (req) => c.metrics.summary(rangeOf(req)));
  app.get('/reports/ads', { preHandler: guard('reports:read') }, async (req) => c.metrics.byAd(rangeOf(req)));
  app.get('/reports/campaigns', { preHandler: guard('reports:read') }, async (req) => c.metrics.byCampaign(rangeOf(req)));
  app.get('/reports/funnel', { preHandler: guard('reports:read') }, async (req) => c.metrics.funnel(rangeOf(req)));
  app.get('/reports/timeseries', { preHandler: guard('reports:read') }, async (req) => c.metrics.timeseries(rangeOf(req)));
}
