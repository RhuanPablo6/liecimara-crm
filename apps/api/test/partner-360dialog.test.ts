// Conexão de um clique com a 360dialog (parceiro de coexistência).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWorld, inboundMessage } from './helpers.js';

const admin = { id: 'u', role: 'ADMIN' as const };

describe('WhatsApp via 360dialog', () => {
  it('registra o webhook na 360dialog e só aceita mensagens com o segredo gerado', async () => {
    const w = buildWorld();
    w.http.handler = () => ({ status: 201, json: { url: 'ok' } });
    await w.integrations.configure360dialog({ apiKey: '  chave-360-teste  ' }, admin);

    // Chamada à 360dialog: endpoint, chave e corpo
    const call = w.http.requests.find((r) => r.url.endsWith('/v1/configs/webhook'))!;
    assert.equal(call.init?.method, 'POST');
    assert.equal(call.init?.headers?.['D360-API-KEY'], 'chave-360-teste');
    const body = call.init?.body as { url: string; headers: { Authorization: string } };
    assert.equal(body.url, 'https://api.test/webhooks/whatsapp/partner');
    assert.match(body.headers.Authorization, /^Bearer [0-9a-f]{64}$/);

    const provider = (await w.integrations.getProvider('partner'))!;
    const payload = inboundMessage({ id: 'wamid.360a', from: '5511988880000', at: '2026-11-02T13:00:00Z', adId: 'AD-100' });
    const raw = Buffer.from(JSON.stringify(payload));

    // Segredo errado ou ausente: recusado
    assert.equal(provider.verifySignature(raw, { authorization: 'Bearer outro' }), false);
    assert.equal(provider.verifySignature(raw, {}), false);
    const bad = await w.ingestion.ingest(provider, raw, { authorization: 'Bearer outro' });
    assert.notEqual(bad.httpStatus, 200);

    // Segredo certo: aceito, vira lead com o anúncio e o número é aprendido
    const ok = await w.ingestion.ingest(provider, raw, { authorization: body.headers.Authorization });
    assert.equal(ok.httpStatus, 200);
    assert.equal(ok.accepted, 1);
    await w.worker.drain();
    const [lead] = [...w.repos.s.leads.values()];
    assert.equal(lead!.adMetaId, 'AD-100');
    const conn = await w.repos.connections.find('WHATSAPP_COEXISTENCE_PARTNER', 'HOMOLOG');
    assert.ok(conn!.phoneNumberId, 'número aprendido do webhook');
    assert.equal(conn!.coexistence, true);
  });

  it('API key recusada pela 360dialog: mensagem clara e nada salvo', async () => {
    const w = buildWorld();
    w.http.handler = () => ({ status: 401, json: { meta: { developer_message: 'Invalid api key' } } });
    await assert.rejects(() => w.integrations.configure360dialog({ apiKey: 'chave-errada' }, admin), /recusou a API key/);
    assert.equal(await w.repos.connections.find('WHATSAPP_COEXISTENCE_PARTNER', 'HOMOLOG'), null);
  });
});
