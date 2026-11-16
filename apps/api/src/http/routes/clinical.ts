// Prontuário estético (anamnese, termos, sessões e fotos) + link público de assinatura.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { effectivePermissions } from '../../modules/auth/screens.js';
import { alertsOf, formToken } from '../../modules/clinical/ClinicalService.js';
import { ANAMNESIS_TEMPLATE } from '../../modules/clinical/templates.js';
import type { Guard } from '../server.js';

const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });
const contactParam = z.object({ contactId: z.string().min(1) });
const idParam = z.object({ id: z.string().min(1) });
const answers = z.record(z.string().max(40), z.object({ a: z.string().max(2000), detail: z.string().max(2000).nullish() }));
const stage = z.enum(['BEFORE', 'AFTER', 'FOLLOWUP']);
const isoDate = z.coerce.date();

export function registerClinicalRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  const read = { preHandler: guard('clinical:read') };
  const write = { preHandler: guard('clinical:write') };

  app.get('/clinical/anamnesis-template', read, async () => ANAMNESIS_TEMPLATE);

  app.get('/clinical/templates', read, async () => c.clinical.consentTemplates());
  app.put('/clinical/templates', write, async (req) => {
    const b = z
      .array(z.object({ key: z.string().regex(/^[\w-]{2,40}$/), title: z.string().trim().min(3).max(150), text: z.string().trim().min(20).max(20000) }))
      .min(1)
      .max(40)
      .parse(req.body);
    return c.clinical.saveConsentTemplates(b, actorOf(req));
  });

  /** Painel do prontuário: documentos recentes de todas as pacientes e espaço usado pelas fotos. */
  app.get('/clinical/overview', read, async () => {
    const forms = await c.repos.clinical.listRecentForms(200);
    const contacts = new Map<string, { name: string | null; waId: string | null }>();
    for (const id of new Set(forms.map((f) => f.contactId))) {
      const ct = await c.repos.contacts.findById(id);
      contacts.set(id, { name: ct?.name ?? ct?.profileName ?? null, waId: ct?.waId ?? null });
    }
    return {
      forms: forms.map((f) => ({
        id: f.id,
        contactId: f.contactId,
        patientName: contacts.get(f.contactId)?.name ?? null,
        waId: contacts.get(f.contactId)?.waId ?? null,
        kind: f.kind,
        title: f.title,
        status: f.status,
        signedAt: f.signedAt,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        token: formToken(f.id, c.env.JWT_SECRET),
      })),
      storage: await c.clinical.storage(),
    };
  });

  app.get('/patients/:contactId/clinical', read, async (req) => c.clinical.record(contactParam.parse(req.params).contactId, actorOf(req)));

  // Documentos
  app.post('/patients/:contactId/clinical/forms', write, async (req, reply) => {
    const { contactId } = contactParam.parse(req.params);
    const b = z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('ANAMNESIS') }),
        z.object({ kind: z.literal('CONSENT'), templateKey: z.string().max(40).nullish(), procedureId: z.string().min(1).nullish() }),
      ])
      .parse(req.body);
    reply.code(201);
    return c.clinical.createForm(contactId, b, actorOf(req));
  });

  app.get('/clinical/forms/:id', read, async (req) => {
    const f = await c.clinical.getForm(idParam.parse(req.params).id);
    const contact = await c.repos.contacts.findById(f.contactId);
    const proc = f.procedureId ? await c.repos.procedures.findById(f.procedureId) : null;
    await c.audit.record({ userId: req.user!.sub, action: 'clinical.form.view', entityType: 'ClinicalForm', entityId: f.id, ip: req.ip });
    return {
      ...f,
      alerts: f.kind === 'ANAMNESIS' ? alertsOf(f) : [],
      patient: contact ? { id: contact.id, name: contact.name ?? contact.profileName ?? null, waId: contact.waId } : null,
      procedureName: proc?.name ?? null,
      token: formToken(f.id, c.env.JWT_SECRET),
      clinicName: (await c.clinical.publicView(formToken(f.id, c.env.JWT_SECRET))).clinic.name,
    };
  });

  app.put('/clinical/forms/:id/answers', write, async (req) => {
    const { id } = idParam.parse(req.params);
    return c.clinical.fillAnamnesis(id, answers.parse(req.body), actorOf(req));
  });

  app.delete('/clinical/forms/:id', write, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ confirm: z.string().optional() }).parse(req.body ?? {});
    const user = await c.repos.users.findById(req.user!.sub);
    const isAdmin = !!user && effectivePermissions(user).includes('records:delete');
    await c.clinical.deleteForm(id, actorOf(req), { allowSigned: isAdmin && b.confirm === 'APAGAR' });
    return { ok: true };
  });

  /** Apagar documento assinado: só administrador, digitando APAGAR (mesmo padrão das outras exclusões definitivas). */
  app.post('/clinical/forms/:id/purge', { preHandler: guard('records:delete') }, async (req) => {
    const { id } = idParam.parse(req.params);
    z.object({ confirm: z.literal('APAGAR') }).parse(req.body);
    await c.clinical.deleteForm(id, actorOf(req), { allowSigned: true });
    return { ok: true };
  });

  // Sessões
  const session = z.object({
    procedureId: z.string().min(1).nullish(),
    performedAt: isoDate,
    products: z
      .array(z.object({ name: z.string().max(150), lot: z.string().max(80).nullish(), quantity: z.number().min(0).max(100000).nullish(), unit: z.string().max(20).nullish() }))
      .max(30)
      .default([]),
    areas: z.string().max(500).nullish(),
    notes: z.string().max(5000).nullish(),
  });
  app.post('/patients/:contactId/clinical/sessions', write, async (req, reply) => {
    const { contactId } = contactParam.parse(req.params);
    const b = session.parse(req.body);
    reply.code(201);
    return c.clinical.saveSession(contactId, { ...b, products: b.products.map((p) => ({ name: p.name, lot: p.lot ?? null, quantity: p.quantity ?? null, unit: p.unit ?? null })) }, actorOf(req));
  });
  app.put('/patients/:contactId/clinical/sessions/:id', write, async (req) => {
    const { contactId, id } = z.object({ contactId: z.string().min(1), id: z.string().min(1) }).parse(req.params);
    const b = session.parse(req.body);
    return c.clinical.saveSession(contactId, { ...b, id, products: b.products.map((p) => ({ name: p.name, lot: p.lot ?? null, quantity: p.quantity ?? null, unit: p.unit ?? null })) }, actorOf(req));
  });
  app.delete('/clinical/sessions/:id', write, async (req) => {
    await c.clinical.deleteSession(idParam.parse(req.params).id, actorOf(req));
    return { ok: true };
  });

  // Fotos (base64 já comprimido no navegador)
  app.post('/patients/:contactId/clinical/photos', { ...write, bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const { contactId } = contactParam.parse(req.params);
    const b = z
      .object({
        data: z.string().min(100),
        thumb: z.string().min(100),
        mime: z.string().max(30),
        width: z.number().int().min(1).max(10000),
        height: z.number().int().min(1).max(10000),
        stage,
        angle: z.string().max(40).nullish(),
        caption: z.string().max(300).nullish(),
        sessionId: z.string().min(1).nullish(),
        takenAt: isoDate.nullish(),
      })
      .parse(req.body);
    reply.code(201);
    return c.clinical.addPhoto(contactId, b, actorOf(req));
  });
  app.patch('/clinical/photos/:id', write, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({ sessionId: z.string().min(1).nullable().optional(), stage: stage.optional(), angle: z.string().max(40).nullable().optional(), caption: z.string().max(300).nullable().optional(), takenAt: isoDate.optional() })
      .parse(req.body);
    return c.clinical.updatePhoto(id, b, actorOf(req));
  });
  app.delete('/clinical/photos/:id', write, async (req) => {
    await c.clinical.deletePhoto(idParam.parse(req.params).id, actorOf(req));
    return { ok: true };
  });
  app.get('/clinical/photos/:id', read, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { v } = z.object({ v: z.enum(['full', 'thumb']).default('thumb') }).parse(req.query);
    const b = await c.clinical.photoBytes(id, v);
    reply.header('content-type', b.mime);
    reply.header('cache-control', 'private, max-age=86400');
    return reply.send(b.bytes);
  });

  // ── Público: a paciente responde/assina no celular ──
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get('/public/forms/:token', limit, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(120) }).parse(req.params);
    return c.clinical.publicView(token);
  });
  app.post('/public/forms/:token', { ...limit, bodyLimit: 1024 * 1024 }, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(120) }).parse(req.params);
    const b = z
      .object({
        signerName: z.string().trim().min(3).max(150),
        signerDocument: z.string().max(30).nullish(),
        signature: z.string().max(500_000),
        imageUse: z.enum(['NONE', 'INTERNAL', 'MARKETING']).nullish(),
        answers: answers.nullish(),
        accept: z.boolean(),
      })
      .parse(req.body);
    const ua = req.headers['user-agent'];
    await c.clinical.publicSign(token, b, { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null });
    return c.clinical.publicView(token);
  });
}
