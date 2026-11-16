// Formação de preço dos procedimentos (ficha técnica, insumos e parâmetros).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import type { Guard } from '../server.js';

const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });
const pct = z.number().min(0).max(100);
const cents = z.number().int().min(0).max(1_000_000_000);

export function registerPricingRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.get('/pricing', { preHandler: guard('finance:read') }, async () => c.pricing.overview());

  app.put('/pricing/settings', { preHandler: guard('finance:write') }, async (req) => {
    const b = z
      .object({
        fixedCostMonthlyCents: cents.nullable(),
        excludedCategories: z.array(z.string().max(80)).max(100),
        hoursPerMonth: z.number().min(1).max(744),
        occupancyPct: pct,
        taxPct: pct,
        cardFeePct: pct,
        commissionPct: pct,
        marketingPct: pct,
        marginPct: pct,
        roundToCents: z.number().int().min(0).max(100_000),
      })
      .parse(req.body);
    return c.pricing.saveSettings(b, actorOf(req));
  });

  app.post('/pricing/supplies', { preHandler: guard('finance:write') }, async (req) => {
    const b = z
      .object({
        id: z.string().min(1).nullish(),
        name: z.string().trim().min(2).max(120),
        unit: z.string().trim().min(1).max(30),
        packageCostCents: cents,
        packageQty: z.number().positive().max(1_000_000),
        notes: z.string().max(500).nullish(),
      })
      .parse(req.body);
    return c.pricing.saveSupply({ ...b, notes: b.notes?.trim() || null }, actorOf(req));
  });

  app.delete('/pricing/supplies/:id', { preHandler: guard('finance:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await c.pricing.deleteSupply(id, actorOf(req));
    return { ok: true };
  });

  app.put('/pricing/sheets/:procedureId', { preHandler: guard('finance:write') }, async (req) => {
    const { procedureId } = z.object({ procedureId: z.string().min(1) }).parse(req.params);
    const b = z
      .object({
        durationMin: z.number().int().min(0).max(1440),
        items: z.array(z.object({ supplyId: z.string().min(1), quantity: z.number().min(0).max(100_000) })).max(60),
        otherCostCents: cents,
        equipmentCostCents: cents,
        commissionPct: pct.nullable(),
        marginPct: pct.nullable(),
        notes: z.string().max(1000).nullish(),
      })
      .parse(req.body);
    return c.pricing.saveSheet({ procedureId, ...b, notes: b.notes?.trim() || null }, actorOf(req));
  });

  app.post('/pricing/sheets/:procedureId/apply', { preHandler: guard('procedures:manage') }, async (req) => {
    const { procedureId } = z.object({ procedureId: z.string().min(1) }).parse(req.params);
    const { priceCents } = z.object({ priceCents: z.number().int().positive().max(1_000_000_000) }).parse(req.body);
    return c.pricing.applyPrice(procedureId, priceCents, actorOf(req));
  });
}
