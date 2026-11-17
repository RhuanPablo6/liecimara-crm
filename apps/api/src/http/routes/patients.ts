// Pacientes: histórico, ranking, etiqueta novo/carteira e origem (anúncio, indicação...).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { ORGANIC_KEYS, ORIGIN_LABELS, type OriginType } from '../../domain/origin.js';
import { dayRange, isDay } from '../../shared/days.js';
import type { Guard } from '../server.js';

const day = z.string().refine(isDay, 'Data no formato AAAA-MM-DD');
const organic = z.enum(ORGANIC_KEYS as [string, ...string[]]);
const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });

export function registerPatientRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.get('/patients/options', { preHandler: guard('leads:read') }, async () => ({
    origins: Object.entries(ORIGIN_LABELS).map(([value, label]) => ({ value, label })),
  }));

  app.get('/patients', { preHandler: guard('leads:read') }, async (req) => {
    const q = z
      .object({
        sort: z.enum(['spent', 'purchases', 'attended', 'noShow', 'attendance', 'ticket', 'balance', 'recent']).default('spent'),
        from: day.optional(),
        to: day.optional(),
        origin: z.enum(Object.keys(ORIGIN_LABELS) as [OriginType, ...OriginType[]]).optional(),
        tag: z.enum(['NEW', 'WALLET']).optional(),
        procedureId: z.string().min(1).optional(),
        q: z.string().max(80).optional(),
        onlyClients: z.enum(['true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(2000).default(200),
      })
      .parse(req.query);
    if (q.from && q.to && q.to < q.from) throw new DomainError('VALIDATION', 'A data final é anterior à inicial');
    return c.patients.list({
      range: q.from || q.to ? dayRange(q.from ?? '2000-01-01', q.to ?? '2999-12-31') : undefined,
      sort: q.sort,
      origin: q.origin,
      tag: q.tag,
      procedureId: q.procedureId,
      q: q.q,
      onlyClients: q.onlyClients === 'true',
      limit: q.limit,
    });
  });

  /** Corrigir o nome (ex.: veio do WhatsApp como emoji ou apelido). Vale para lead, agenda, financeiro e relatórios. */
  app.patch('/contacts/:contactId', { preHandler: guard('leads:write') }, async (req) => {
    const { contactId } = z.object({ contactId: z.string().min(1) }).parse(req.params);
    const { name } = z.object({ name: z.string().trim().min(2, 'Informe o nome').max(120) }).parse(req.body);
    const before = await c.repos.contacts.findById(contactId);
    if (!before) throw new DomainError('NOT_FOUND', 'Paciente não encontrada', 404);
    const updated = await c.repos.contacts.update(contactId, { name });
    await c.audit.record({ userId: req.user!.sub, action: 'contact.rename', entityType: 'Contact', entityId: contactId, before: { name: before.name, profileName: before.profileName }, after: { name }, ip: req.ip });
    return updated;
  });

  app.get('/patients/:contactId', { preHandler: guard('leads:read') }, async (req) => {
    const { contactId } = z.object({ contactId: z.string().min(1) }).parse(req.params);
    const d = await c.patients.detail(contactId);
    if (!d) throw new DomainError('NOT_FOUND', 'Paciente não encontrado', 404);
    return d;
  });

  /** Etiqueta "Da carteira" / "Paciente novo" à mão (null volta para automático). */
  app.patch('/patients/:contactId/tag', { preHandler: guard('leads:write') }, async (req) => {
    const { contactId } = z.object({ contactId: z.string().min(1) }).parse(req.params);
    const b = z.object({ walletPatient: z.boolean().nullable() }).parse(req.body);
    const before = await c.repos.contacts.findById(contactId);
    if (!before) throw new DomainError('NOT_FOUND', 'Paciente não encontrado', 404);
    const updated = await c.repos.contacts.update(contactId, { walletPatient: b.walletPatient });
    await c.audit.record({
      userId: req.user!.sub,
      action: 'patient.tag',
      entityType: 'Contact',
      entityId: contactId,
      before: { walletPatient: before.walletPatient ?? null },
      after: { walletPatient: updated.walletPatient ?? null },
      ip: req.ip,
    });
    return { walletPatient: updated.walletPatient ?? null };
  });

  /** Origem que não é anúncio (indicação, Instagram...). Para anúncio, use POST /leads/:id/attribution. */
  app.put('/leads/:id/origin', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = z.object({ type: organic.nullable(), note: z.string().max(200).nullish() }).parse(req.body);
    return c.funnel.setOrganicOrigin(id, b.type as any, b.note ?? null, actorOf(req));
  });
}
