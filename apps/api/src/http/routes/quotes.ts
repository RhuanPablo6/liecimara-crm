// Orçamentos (internos) + página pública do orçamento (link assinado, sem login).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { effectivePermissions } from '../../modules/auth/screens.js';
import { quoteToken, readQuoteToken } from '../../modules/quotes/QuoteService.js';
import { DEFAULT_TEMPLATES, TEMPLATES_KEY, type TemplatesSettings } from '../../modules/recalls/RecallService.js';
import { dayRange, dayToDate, isDay } from '../../shared/days.js';
import type { Guard } from '../server.js';

const day = z.string().refine(isDay, 'Data no formato AAAA-MM-DD');
const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });
const item = z.object({
  procedureId: z.string().min(1),
  description: z.string().max(200).default(''),
  quantity: z.number().int().min(1).max(999).default(1),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
  discountCents: z.number().int().min(0).max(100_000_000).default(0),
});
const body = z.object({
  items: z.array(item).min(1).max(40),
  discountCents: z.number().int().min(0).default(0),
  validUntil: day,
  paymentTerms: z.string().max(1000).nullish(),
  notes: z.string().max(2000).nullish(),
});
const idParam = z.object({ id: z.string().min(1) });

export function registerQuoteRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  const clinic = async () => {
    const s = (await c.repos.settings.get<TemplatesSettings>(TEMPLATES_KEY)) ?? DEFAULT_TEMPLATES;
    return { name: s.clinicName, whatsapp: s.clinicWhatsapp ?? DEFAULT_TEMPLATES.clinicWhatsapp ?? null };
  };
  const load = async (id: string) => {
    const q = await c.repos.quotes.findById(id);
    if (!q) throw new DomainError('NOT_FOUND', 'Orçamento não encontrado', 404);
    return q;
  };
  const full = async (id: string) => ({ ...(await c.quotes.view(await load(id))), clinic: await clinic(), token: quoteToken(id, c.env.JWT_SECRET) });

  app.get('/quotes', { preHandler: guard('leads:read') }, async (req) => {
    const q = z
      .object({
        contactId: z.string().min(1).optional(),
        from: day.optional(),
        to: day.optional(),
        status: z.enum(['OPEN', 'APPROVED', 'REJECTED', 'EXPIRED']).optional(),
      })
      .parse(req.query);
    const range = q.from || q.to ? dayRange(q.from ?? '2000-01-01', q.to ?? '2999-12-31') : null;
    return { items: await c.quotes.list({ contactId: q.contactId, status: q.status, from: range?.from, to: range?.to }) };
  });

  app.post('/quotes', { preHandler: guard('leads:write') }, async (req, reply) => {
    const b = body
      .extend({
        contactId: z.string().min(1).nullish(),
        newPatient: z.object({ waId: z.string().regex(/^\+?\d[\d\s()-]{9,19}$/, 'Telefone inválido'), name: z.string().min(1).max(120) }).nullish(),
      })
      .parse(req.body);
    const q = await c.quotes.create({ ...b, validUntil: dayToDate(b.validUntil) }, actorOf(req));
    reply.code(201);
    return full(q.id);
  });

  app.get('/quotes/:id', { preHandler: guard('leads:read') }, async (req) => full(idParam.parse(req.params).id));

  app.patch('/quotes/:id', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = body.parse(req.body);
    await c.quotes.update(id, { ...b, validUntil: dayToDate(b.validUntil) }, actorOf(req));
    return full(id);
  });

  app.post('/quotes/:id/status', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['OPEN', 'REJECTED', 'APPROVED']) }).parse(req.body);
    await c.quotes.setStatus(id, status, actorOf(req));
    return full(id);
  });

  app.post('/quotes/:id/convert', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const user = await c.repos.users.findById(req.user!.sub);
    if (!user || !effectivePermissions(user).includes('sales:write')) {
      throw new DomainError('FORBIDDEN', 'Seu usuário não pode lançar vendas', 403);
    }
    const r = await c.quotes.convertToSales(id, actorOf(req));
    return { ...(await full(id)), leadId: r.leadId, saleIds: r.saleIds };
  });

  app.post('/quotes/:id/purge', { preHandler: guard('records:delete') }, async (req) => {
    const { id } = idParam.parse(req.params);
    z.object({ confirm: z.literal('APAGAR') }).parse(req.body);
    return c.quotes.purge(id, actorOf(req));
  });

  // Página pública: só o primeiro nome da paciente, itens e valores.
  app.get('/public/quotes/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(120) }).parse(req.params);
    const id = readQuoteToken(token, c.env.JWT_SECRET);
    if (!id) throw new DomainError('NOT_FOUND', 'Link inválido', 404);
    const v = await c.quotes.view(await load(id));
    return {
      number: v.number,
      firstName: (v.patient?.name ?? '').trim().split(/\s+/)[0] || null,
      items: v.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, discountCents: i.discountCents, totalCents: i.totalCents })),
      subtotalCents: v.subtotalCents,
      discountCents: v.discountCents,
      totalCents: v.totalCents,
      validUntil: v.validUntil,
      paymentTerms: v.paymentTerms,
      notes: v.notes,
      status: v.effectiveStatus,
      createdAt: v.createdAt,
      clinic: await clinic(),
    };
  });
}
