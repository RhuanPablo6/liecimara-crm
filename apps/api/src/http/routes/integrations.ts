import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { META_SYNC_JOB } from '../../modules/meta/MetaSyncService.js';
import { actorOf, type Guard } from '../server.js';

const kindParam = z.object({ kind: z.enum(['cloud', 'partner']) });

export function registerIntegrationRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  // ── WhatsApp ──────────────────────────────────────────────
  app.get('/integrations/whatsapp', { preHandler: guard('integrations:read') }, async () => c.integrations.whatsappStatus());

  app.post('/integrations/whatsapp/cloud', { preHandler: guard('integrations:write') }, async (req) => {
    const b = z
      .object({
        wabaId: z.string().regex(/^\d+$/),
        phoneNumberId: z.string().regex(/^\d+$/),
        accessToken: z.string().min(20),
        coexistence: z.boolean().default(true),
        confirmProductionNumber: z.boolean().optional(),
      })
      .parse(req.body);
    const conn = await c.integrations.configureWhatsAppCloud(b, actorOf(req));
    return { id: conn.id, status: conn.status };
  });

  app.post('/integrations/whatsapp/partner', { preHandler: guard('integrations:write') }, async (req) => {
    const b = z
      .object({
        wabaId: z.string().optional(),
        apiKey: z.string().min(8),
        webhookSecret: z.string().optional(),
        confirmProductionNumber: z.boolean().optional(),
        config: z.object({
          partnerName: z.string(),
          baseUrl: z.string().url(),
          authHeaderName: z.string(),
          phoneNumberId: z.string(),
          webhookAuth: z.discriminatedUnion('mode', [
            z.object({ mode: z.literal('hmac-sha256'), header: z.string(), prefix: z.string().optional(), secret: z.string().default('') }),
            z.object({ mode: z.literal('static-header'), header: z.string(), value: z.string().default('') }),
            z.object({ mode: z.literal('none-ip-allowlist') }),
          ]),
          paths: z.object({ phoneInfo: z.string().optional(), appDataSync: z.string().optional() }).optional(),
          envelopeKey: z.string().optional(),
        }),
      })
      .parse(req.body);
    const conn = await c.integrations.configurePartner(b, actorOf(req));
    return { id: conn.id, status: conn.status };
  });

  // Conexão de um clique com a 360dialog: só a API key do número.
  app.post('/integrations/whatsapp/360dialog', { preHandler: guard('integrations:write') }, async (req) => {
    const b = z.object({ apiKey: z.string().trim().min(8), confirmProductionNumber: z.boolean().optional() }).parse(req.body);
    const conn = await c.integrations.configure360dialog(b, actorOf(req));
    return { id: conn.id, status: conn.status };
  });

  // Conexão de um clique com o YCloud: só a API key da conta.
  app.post('/integrations/whatsapp/ycloud', { preHandler: guard('integrations:write') }, async (req) => {
    const b = z.object({ apiKey: z.string().trim().min(8), confirmProductionNumber: z.boolean().optional() }).parse(req.body);
    const conn = await c.integrations.configureYCloud(b, actorOf(req));
    return { id: conn.id, status: conn.status, displayPhoneNumber: conn.displayPhoneNumber };
  });

  // ---------- Confirmação de agendamento pelo WhatsApp ----------

  app.get('/whatsapp/confirmations', { preHandler: guard('leads:read') }, async () => c.confirmations.status());

  app.put('/whatsapp/confirmations/settings', { preHandler: guard('integrations:write') }, async (req) => {
    const b = z.object({ enabled: z.boolean().optional(), sendHour: z.number().int().min(7).max(19).optional() }).parse(req.body);
    const next = await c.confirmations.saveSettings(b);
    await c.audit.record({ userId: req.user!.sub, action: 'whatsapp.confirmations.settings', entityType: 'Setting', entityId: null, after: b, ip: req.ip });
    return next;
  });

  app.post('/whatsapp/confirmations/template', { preHandler: guard('integrations:write') }, async (req) => {
    const r = await c.confirmations.createTemplate();
    await c.audit.record({ userId: req.user!.sub, action: 'whatsapp.template.create', entityType: 'Setting', entityId: null, after: r, ip: req.ip });
    return r;
  });

  app.post('/appointments/:id/whatsapp-confirmation', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = z.object({ force: z.boolean().optional() }).parse(req.body ?? {});
    const a = await c.confirmations.send(id, b);
    await c.audit.record({ userId: req.user!.sub, action: 'appointment.whatsapp_confirmation', entityType: 'Appointment', entityId: id, ip: req.ip });
    return { ok: true, confirmationSentAt: a.confirmationSentAt ?? null };
  });

  app.post('/integrations/whatsapp/:kind/diagnose', { preHandler: guard('integrations:read') }, async (req) => {
    const { kind } = kindParam.parse(req.params);
    return c.integrations.runDiagnostics(kind, req.user!.sub);
  });

  app.post('/integrations/whatsapp/resubscribe', { preHandler: guard('integrations:write') }, async (req) => {
    await c.integrations.resubscribeWebhooks(req.user!.sub);
    return { ok: true };
  });

  app.post('/integrations/whatsapp/:kind/sync', { preHandler: guard('integrations:write') }, async (req) => {
    const { kind } = kindParam.parse(req.params);
    const b = z.object({ type: z.enum(['smb_app_state_sync', 'history']) }).parse(req.body);
    return c.integrations.requestCoexistenceSync(kind, b.type, req.user!.sub);
  });

  // ── Meta Marketing ───────────────────────────────────────
  app.get('/integrations/meta', { preHandler: guard('integrations:read') }, async () => c.integrations.metaStatus());

  app.post('/integrations/meta', { preHandler: guard('integrations:write') }, async (req) => {
    // adAccountIds: "act_1, act_2" ou vazio (= todas as contas acessíveis). Token opcional se já houver um salvo.
    // adAccountId (singular) continua aceito por compatibilidade.
    const b = z
      .object({
        adAccountIds: z.string().max(2000).optional(),
        adAccountId: z.string().max(2000).optional(),
        accessToken: z.string().min(20).optional().or(z.literal('')),
      })
      .parse(req.body);
    const conn = await c.integrations.configureMeta(
      { adAccountIds: b.adAccountIds ?? b.adAccountId, accessToken: b.accessToken || undefined },
      actorOf(req),
    );
    await c.queue.enqueue(META_SYNC_JOB, { days: 90 }, { dedupKey: 'meta-sync' });
    return { id: conn.id, status: conn.status };
  });

  app.post('/integrations/meta/sync', { preHandler: guard('integrations:read') }, async () => {
    const job = await c.queue.enqueue(META_SYNC_JOB, { days: 30 }, { dedupKey: 'meta-sync' });
    return { queued: !!job };
  });

  app.post('/integrations/meta/diagnose', { preHandler: guard('integrations:read') }, async () => c.metaSync.diagnose());

  // ── Eventos e fila ───────────────────────────────────────
  app.get('/integrations/events', { preHandler: guard('integrations:read') }, async (req) => {
    const q = z
      .object({ status: z.enum(['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD', 'IGNORED']).optional(), limit: z.coerce.number().max(500).default(50) })
      .parse(req.query);
    return c.repos.events.list(q);
  });

  app.post('/integrations/events/:id/reprocess', { preHandler: guard('events:reprocess') }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await c.processor.reprocess(id);
    await c.audit.record({ userId: req.user!.sub, action: 'event.reprocess', entityType: 'InboundEvent', entityId: id, ip: req.ip });
    return { ok: true };
  });

  app.get('/jobs', { preHandler: guard('integrations:read') }, async (req) => {
    const q = z.object({ status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD']).optional() }).parse(req.query);
    return c.queue.list({ status: q.status, limit: 100 });
  });

  app.post('/jobs/:id/requeue', { preHandler: guard('events:reprocess') }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await c.queue.requeue(id);
    await c.audit.record({ userId: req.user!.sub, action: 'job.requeue', entityType: 'Job', entityId: id, ip: req.ip });
    return { ok: true };
  });
}
