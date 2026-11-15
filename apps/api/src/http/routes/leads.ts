import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { CONFIDENCE_LABELS_PT, LOST_REASON_LABELS_PT, STAGE_LABELS_PT, type Lead } from '../../domain/types.js';
import { actorOf, type Guard } from '../server.js';

const stageEnum = z.enum(['NEW', 'CONTACTED', 'SCHEDULED', 'ATTENDED', 'WON', 'LOST']);
const lostEnum = z.enum(['PRICE', 'NO_RESPONSE', 'CHOSE_COMPETITOR', 'NOT_A_CANDIDATE', 'SCHEDULE_CONFLICT', 'JUST_RESEARCHING', 'OTHER']);
const isoDate = z.coerce.date();
const id = z.object({ id: z.string().min(1) });

export function registerLeadRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  /** Enriquecimento para listas: nome do contato e do anúncio. */
  async function present(leads: Lead[]) {
    const procedures = new Map((await c.repos.procedures.list()).map((p) => [p.id, p.name]));
    const ads = new Map((await c.repos.ads.listAds()).map((a) => [a.metaId, a.name]));
    return Promise.all(
      leads.map(async (l) => {
        const contact = await c.repos.contacts.findById(l.contactId);
        return {
          ...l,
          contact: contact && { id: contact.id, name: contact.name ?? contact.profileName, waId: contact.waId },
          adName: l.adMetaId ? ads.get(l.adMetaId) ?? '(anúncio não sincronizado)' : null,
          procedureInterest: l.procedureInterestId ? procedures.get(l.procedureInterestId) ?? null : null,
          stageLabel: STAGE_LABELS_PT[l.stage],
          confidenceLabel: CONFIDENCE_LABELS_PT[l.attributionConfidence],
        };
      }),
    );
  }

  app.get('/meta/labels', { preHandler: guard('leads:read') }, async () => ({
    stages: STAGE_LABELS_PT,
    confidence: CONFIDENCE_LABELS_PT,
    lostReasons: LOST_REASON_LABELS_PT,
  }));

  app.get('/leads', { preHandler: guard('leads:read') }, async (req) => {
    const q = z
      .object({
        stage: stageEnum.optional(),
        open: z.enum(['true', 'false']).optional(),
        confidence: z.enum(['OFFICIAL_REFERRAL', 'MANUAL', 'UNKNOWN']).optional(),
        adMetaId: z.string().optional(),
        campaignMetaId: z.string().optional(),
        search: z.string().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);
    const filter = {
      stage: q.stage,
      open: q.open === undefined ? undefined : q.open === 'true',
      confidence: q.confidence,
      adMetaId: q.adMetaId,
      campaignMetaId: q.campaignMetaId,
      search: q.search,
      openedIn: q.from && q.to ? { from: q.from, to: q.to } : undefined,
    };
    const [rows, total] = await Promise.all([c.repos.leads.list({ ...filter, limit: q.limit, offset: q.offset }), c.repos.leads.count(filter)]);
    return { total, items: await present(rows) };
  });

  /** Quadro do funil: leads abertos + fechados nos últimos 30 dias. */
  app.get('/funnel/board', { preHandler: guard('leads:read') }, async () => {
    const open = await c.repos.leads.list({ open: true, limit: 500 });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const closed = (await c.repos.leads.list({ open: false, limit: 500 })).filter((l) => (l.closedAt ?? l.lastActivityAt) >= since);
    const items = await present([...open, ...closed]);
    return (['NEW', 'CONTACTED', 'SCHEDULED', 'ATTENDED', 'WON', 'LOST'] as const).map((stage) => ({
      stage,
      label: STAGE_LABELS_PT[stage],
      leads: items.filter((l) => l.stage === stage),
    }));
  });

  app.post('/leads', { preHandler: guard('leads:write') }, async (req) => {
    const b = z.object({ waId: z.string().min(10), name: z.string().optional(), procedureInterestId: z.string().nullish() }).parse(req.body);
    return c.funnel.createLeadManually(b, actorOf(req));
  });

  app.get('/leads/:id', { preHandler: guard('leads:read') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const detail = await c.funnel.getLeadDetail(leadId);
    return { ...detail, lead: (await present([detail.lead]))[0] };
  });

  app.patch('/leads/:id/stage', { preHandler: guard('leads:write') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z.object({ stage: stageEnum, reason: z.string().optional() }).parse(req.body);
    return c.funnel.moveStage(leadId, b.stage, actorOf(req), b.reason);
  });

  app.patch('/leads/:id/procedure', { preHandler: guard('leads:write') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z.object({ procedureId: z.string().nullable() }).parse(req.body);
    return c.funnel.setProcedureInterest(leadId, b.procedureId, actorOf(req));
  });

  app.post('/leads/:id/lost', { preHandler: guard('leads:write') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z.object({ reason: lostEnum, note: z.string().nullish() }).parse(req.body);
    return c.funnel.markLost(leadId, b.reason, b.note ?? null, actorOf(req));
  });

  app.post('/leads/:id/attribution', { preHandler: guard('attribution:manual') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z.object({ adMetaId: z.string().min(1), note: z.string().min(3) }).parse(req.body);
    return c.funnel.attributeManually(leadId, b.adMetaId, b.note, actorOf(req));
  });

  app.post('/leads/:id/appointments', { preHandler: guard('leads:write') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z.object({ scheduledFor: isoDate, procedureId: z.string().nullish() }).parse(req.body);
    return c.funnel.scheduleAppointment(leadId, b, actorOf(req));
  });

  app.post('/appointments/:id/cancel', { preHandler: guard('leads:write') }, async (req) => {
    const p = id.parse(req.params);
    const b = z.object({ reason: z.string().min(2) }).parse(req.body);
    return c.funnel.cancelAppointment(p.id, b.reason, actorOf(req));
  });

  app.post('/appointments/:id/status', { preHandler: guard('leads:write') }, async (req) => {
    const p = id.parse(req.params);
    const b = z.object({ status: z.enum(['CONFIRMED', 'ATTENDED', 'NO_SHOW']) }).parse(req.body);
    return c.funnel.setAppointmentStatus(p.id, b.status, actorOf(req));
  });

  app.get('/appointments', { preHandler: guard('leads:read') }, async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    return c.repos.appointments.listScheduledBetween({ from: q.from, to: q.to });
  });

  app.post('/leads/:id/sales', { preHandler: guard('sales:write') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z
      .object({
        procedureId: z.string(),
        amountCents: z.number().int().positive(),
        soldAt: isoDate.optional(),
        manualAttribution: z.object({ adMetaId: z.string(), note: z.string().min(3) }).nullish(),
      })
      .parse(req.body);
    return c.funnel.registerSale(leadId, b, actorOf(req));
  });

  app.post('/sales/:id/cancel', { preHandler: guard('sales:write') }, async (req) => {
    const p = id.parse(req.params);
    const b = z.object({ reason: z.string().min(2) }).parse(req.body);
    return c.funnel.cancelSale(p.id, b.reason, actorOf(req));
  });

  app.post('/sales/:id/payments', { preHandler: guard('payments:write') }, async (req) => {
    const p = id.parse(req.params);
    const b = z
      .object({
        amountCents: z.number().int().positive(),
        method: z.enum(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'BANK_TRANSFER', 'OTHER']),
        installments: z.number().int().min(1).max(24).optional(),
        paidAt: isoDate.optional(),
      })
      .parse(req.body);
    return c.funnel.registerPayment(p.id, b, actorOf(req));
  });

  app.post('/leads/:id/procedures-performed', { preHandler: guard('leads:write') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z.object({ procedureId: z.string(), saleId: z.string().nullish(), performedAt: isoDate.optional() }).parse(req.body);
    return c.funnel.markProcedurePerformed(leadId, b, actorOf(req));
  });

  app.post('/leads/:id/reminders', { preHandler: guard('leads:write') }, async (req) => {
    const { id: leadId } = id.parse(req.params);
    const b = z.object({ dueAt: isoDate, note: z.string().min(2), assignedToId: z.string().nullish() }).parse(req.body);
    return c.funnel.createReminder(leadId, b, actorOf(req));
  });

  app.post('/reminders/:id/done', { preHandler: guard('leads:write') }, async (req) => {
    const p = id.parse(req.params);
    return c.funnel.completeReminder(p.id, actorOf(req));
  });

  app.get('/reminders', { preHandler: guard('leads:read') }, async (req) => {
    const q = z.object({ mine: z.enum(['true', 'false']).default('true') }).parse(req.query);
    const until = new Date(Date.now() + 7 * 86_400_000);
    return c.repos.reminders.listPending(until, q.mine === 'true' ? req.user!.sub : undefined);
  });

  app.get('/procedures', { preHandler: guard('leads:read') }, async () => c.repos.procedures.list());

  app.post('/procedures', { preHandler: guard('procedures:manage') }, async (req) => {
    const b = z.object({ name: z.string().min(2), defaultPriceCents: z.number().int().positive().nullish() }).parse(req.body);
    const p = await c.repos.procedures.create({ name: b.name, defaultPriceCents: b.defaultPriceCents ?? null, active: true });
    await c.audit.record({ userId: req.user!.sub, action: 'procedure.create', entityType: 'Procedure', entityId: p.id, after: p, ip: req.ip });
    return p;
  });

  app.get('/ads', { preHandler: guard('leads:read') }, async () => {
    const [ads, campaigns] = await Promise.all([c.repos.ads.listAds(), c.repos.ads.listCampaigns()]);
    const cn = new Map(campaigns.map((x) => [x.metaId, x.name]));
    return ads.map((a) => ({ ...a, campaignName: cn.get(a.campaignMetaId) ?? null }));
  });

  app.get('/audit', { preHandler: guard('audit:read') }, async (req) => {
    const q = z.object({ entityType: z.string().optional(), entityId: z.string().optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return c.repos.audit.list(q);
  });
}
