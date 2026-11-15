import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { verifySubscription } from '../../modules/whatsapp/webhookSignature.js';

export function registerWebhookRoutes(app: FastifyInstance, c: Container) {
  // Handshake de verificação exigido pela Meta ao cadastrar a URL de callback.
  app.get<{ Params: { kind: string }; Querystring: Record<string, string> }>('/webhooks/whatsapp/:kind', async (req, reply) => {
    const res = verifySubscription(req.query, c.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
    if (!res.ok) return reply.status(403).send('forbidden');
    return reply.type('text/plain').send(res.challenge);
  });

  app.post<{ Params: { kind: string } }>('/webhooks/whatsapp/:kind', async (req, reply) => {
    const kind = req.params.kind === 'partner' ? 'partner' : req.params.kind === 'cloud' ? 'cloud' : null;
    if (!kind) return reply.status(404).send();
    const provider = await c.integrations.getProvider(kind);
    if (!provider) return reply.status(503).send({ error: 'NOT_CONFIGURED' });
    const result = await c.ingestion.ingest(provider, req.rawBody ?? Buffer.alloc(0), req.headers);
    req.log.info({ kind, ...result }, 'webhook recebido');
    return reply.status(result.httpStatus).send(result.httpStatus === 200 ? 'EVENT_RECEIVED' : 'rejected');
  });
}
