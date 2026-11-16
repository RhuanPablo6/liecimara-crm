// Retornos, reativação, confirmações e mensagens prontas.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DEFAULT_TEMPLATES, TEMPLATES_KEY, type TemplatesSettings } from '../../modules/recalls/RecallService.js';
import type { Guard } from '../server.js';

export function registerRecallRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.get('/recalls', { preHandler: guard('leads:read') }, async (req) => {
    const q = z.object({ horizonDays: z.coerce.number().int().min(0).max(90).default(14) }).parse(req.query);
    return c.recalls.board(new Date(), { horizonDays: q.horizonDays });
  });

  /** Contatado (some por N dias), adiado (N dias) ou "não quer" (some neste ciclo). */
  app.post('/recalls/actions', { preHandler: guard('leads:write') }, async (req) => {
    const b = z
      .object({
        contactId: z.string().min(1),
        dueKey: z.string().min(1).max(200),
        kind: z.enum(['CONTACTED', 'SNOOZED', 'DISMISSED']),
        days: z.number().int().min(1).max(365).nullish(),
        note: z.string().max(300).nullish(),
      })
      .parse(req.body);
    const a = await c.recalls.act(b, req.user!.sub);
    await c.audit.record({ userId: req.user!.sub, action: `recall.${b.kind.toLowerCase()}`, entityType: 'Contact', entityId: b.contactId, after: a, ip: req.ip });
    return a;
  });

  app.get('/messages/templates', { preHandler: guard('app:use') }, async () => ({
    ...((await c.repos.settings.get<TemplatesSettings>(TEMPLATES_KEY)) ?? DEFAULT_TEMPLATES),
    defaults: DEFAULT_TEMPLATES,
  }));

  app.put('/messages/templates', { preHandler: guard('messages:manage') }, async (req) => {
    const b = z
      .object({
        clinicName: z.string().trim().min(2).max(120),
        clinicWhatsapp: z
          .string()
          .transform((v) => v.replace(/\D/g, ''))
          .refine((v) => !v || (v.length >= 12 && v.length <= 15), 'WhatsApp da clínica inválido (DDI + DDD + número)')
          .nullish(),
        templates: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              name: z.string().trim().min(2).max(80),
              use: z.enum(['RETURN', 'REACTIVATION', 'CONFIRM', 'POSTCARE', 'CHARGE', 'GENERAL']),
              body: z.string().trim().min(5).max(1500),
            }),
          )
          .max(40),
      })
      .parse(req.body);
    await c.repos.settings.set(TEMPLATES_KEY, b);
    await c.audit.record({ userId: req.user!.sub, action: 'messages.templates', entityType: 'Setting', entityId: TEMPLATES_KEY, after: b, ip: req.ip });
    return b;
  });
}
