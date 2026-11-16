// YCloud: assinatura do webhook, eventos, conexão de um clique e confirmação com botões.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { YCloudAdapter } from '../src/modules/whatsapp/adapters/YCloudAdapter.js';
import { ConfirmationService, buttonPayload } from '../src/modules/whatsapp/ConfirmationService.js';
import { WebhookIngestionService } from '../src/modules/whatsapp/WebhookIngestionService.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

const SECRET = 'whsec_test';
const NOW = Date.parse('2026-11-17T13:00:00Z'); // 10h em São Paulo

function sign(body: string, t = Math.floor(NOW / 1000)) {
  return `t=${t},s=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
}

const adapter = (http: any) =>
  new YCloudAdapter({ apiKey: 'key', webhookSecret: SECRET, phoneNumber: '+5511959699628', wabaId: 'waba1' }, http, () => NOW);

describe('YCloud', () => {
  it('confere a assinatura YCloud-Signature', () => {
    const a = adapter(null);
    const body = '{"id":"evt1"}';
    assert.equal(a.verifySignature(Buffer.from(body), { 'ycloud-signature': sign(body) }), true);
    assert.equal(a.verifySignature(Buffer.from(body + ' '), { 'ycloud-signature': sign(body) }), false);
    assert.equal(a.verifySignature(Buffer.from(body), { 'ycloud-signature': sign(body, Math.floor(NOW / 1000) - 900) }), false);
    assert.equal(a.verifySignature(Buffer.from(body), {}), false);
  });

  it('converte mensagem de anúncio, botão, eco do app e status', () => {
    const a = adapter(null);
    const [ad] = a.normalize({
      id: 'e1',
      type: 'whatsapp.inbound_message.received',
      createTime: '2026-11-17T13:00:00Z',
      whatsappInboundMessage: {
        id: 'yc1', wamid: 'wamid.A', wabaId: 'waba1', from: '+5511988887777', to: '+5511959699628',
        customerProfile: { name: 'Ana' }, type: 'text', text: { body: 'Oi (A16)' },
        referral: { source_type: 'ad', source_id: '120200', source_url: 'https://fb.me/x', ctwa_clid: 'clid' },
      },
    }) as any[];
    assert.equal(ad.kind, 'MESSAGE_INBOUND');
    assert.equal(ad.fromWaId, '5511988887777');
    assert.equal(ad.referral.sourceId, '120200');
    assert.equal(ad.text, 'Oi (A16)');

    const [btn] = a.normalize({
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: { wamid: 'wamid.B', from: '+5511988887777', type: 'button', button: { text: 'Confirmar', payload: 'APPT:x:CONFIRM' } },
    }) as any[];
    assert.equal(btn.buttonPayload, 'APPT:x:CONFIRM');
    assert.equal(btn.text, 'Confirmar');

    const [echo] = a.normalize({
      type: 'whatsapp.smb.message.echoes',
      whatsappMessage: { wamid: 'wamid.C', from: '+5511959699628', to: '+5511988887777', type: 'text', text: { body: 'Olá!' } },
    }) as any[];
    assert.equal(echo.kind, 'MESSAGE_ECHO');
    assert.equal(echo.toWaId, '5511988887777');

    const [st] = a.normalize({ type: 'whatsapp.message.updated', whatsappMessage: { wamid: 'wamid.D', status: 'read', to: '+5511988887777' } }) as any[];
    assert.equal(st.kind, 'MESSAGE_STATUS');
    assert.equal(st.status, 'read');
  });

  it('conecta com a API key: acha o número e cria o webhook', async () => {
    const w = buildWorld('2026-11-17T13:00:00Z');
    w.http.handler = (url) => {
      if (url.includes('/whatsapp/phoneNumbers')) return { status: 200, json: { items: [{ phoneNumber: '+5511959699628', displayPhoneNumber: '+55 11 95969-9628', wabaId: 'waba1', status: 'CONNECTED' }] } };
      if (url.endsWith('/webhookEndpoints?limit=100')) return { status: 200, json: { items: [] } };
      if (url.endsWith('/webhookEndpoints')) return { status: 200, json: { id: 'wh1', secret: SECRET, status: 'active' } };
      return { status: 404, json: {} };
    };
    const conn = await w.integrations.configureYCloud({ apiKey: 'key-123456' }, { id: 'adm', role: 'ADMIN' });
    assert.equal(conn.phoneNumberId, '+5511959699628');
    const created = w.http.requests.find((r) => r.url.endsWith('/webhookEndpoints') && r.init?.method === 'POST')!;
    assert.equal((created.init!.body as any).url, 'https://api.test/webhooks/whatsapp/partner');
    assert.ok(await w.integrations.getYCloud());
  });

  it('envia a confirmação e o toque em "Confirmar" atualiza a agenda', async () => {
    const w = buildWorld('2026-11-17T13:00:00Z');
    w.http.handler = (url) => {
      if (url.includes('/whatsapp/phoneNumbers')) return { status: 200, json: { items: [{ phoneNumber: '+5511959699628', wabaId: 'waba1', status: 'CONNECTED' }] } };
      if (url.endsWith('/webhookEndpoints?limit=100')) return { status: 200, json: { items: [] } };
      if (url.endsWith('/webhookEndpoints')) return { status: 200, json: { id: 'wh1', secret: SECRET } };
      if (url.endsWith('/sendDirectly')) return { status: 200, json: { id: 'm1', wamid: `wamid.out${w.http.calls.length}`, status: 'accepted' } };
      return { status: 404, json: {} };
    };
    await w.integrations.configureYCloud({ apiKey: 'key-123456' }, { id: 'adm', role: 'ADMIN' });
    const conf = new ConfirmationService(w.repos, w.integrations, w.funnel, w.clock);
    w.processor.buttonHandler = (evt) => conf.handleButton(evt);
    await conf.saveSettings({ enabled: true, sendHour: 9 });

    const botox = await seedProcedure(w, 'Botox');
    const lead = await w.funnel.createLeadManually({ waId: '5511988887777', name: 'Mariana Souza' }, actor);
    const appt = await w.funnel.scheduleAppointment(lead.id, { scheduledFor: new Date('2026-11-18T17:00:00Z'), procedureId: botox.id }, actor);

    const r1 = await conf.runDue();
    assert.equal(r1.sent, 1);
    const r2 = await conf.runDue();
    assert.equal(r2.sent, 0, 'não manda duas vezes');
    const sendReq = w.http.requests.find((r) => r.url.endsWith('/sendDirectly'))!;
    const tpl = (sendReq.init!.body as any).template;
    assert.deepEqual(tpl.components[0].parameters.map((p: any) => p.text), ['Mariana', 'Clínica Dra. Liecimara Esteves', 'Botox', '18/11', '14:00']);
    assert.equal(tpl.components[1].parameters[0].payload, buttonPayload(appt.id, 'CONFIRM'));

    // A paciente toca em "Confirmar": chega pelo webhook assinado.
    const payload = JSON.stringify({
      id: 'evtB', type: 'whatsapp.inbound_message.received', createTime: '2026-11-17T13:05:00Z',
      whatsappInboundMessage: { wamid: 'wamid.btn', from: '+5511988887777', type: 'button', button: { text: 'Confirmar', payload: buttonPayload(appt.id, 'CONFIRM') }, sendTime: '2026-11-17T13:05:00Z' },
    });
    const provider = (await w.integrations.getYCloud())!;
    (provider as any).now = () => NOW;
    const ingestion = new WebhookIngestionService(w.repos, w.queue, w.clock, 'HOMOLOG');
    const res = await ingestion.ingest(provider, Buffer.from(payload), { 'ycloud-signature': sign(payload) });
    assert.equal(res.httpStatus, 200);
    await w.worker.drain();
    const after = (await w.repos.appointments.findById(appt.id))!;
    assert.equal(after.status, 'CONFIRMED');
    assert.equal(after.patientResponse, 'CONFIRMED');
    const reply = w.http.requests.filter((r) => r.url.endsWith('/sendDirectly')).at(-1)!;
    assert.equal((reply.init!.body as any).type, 'text');
  });

  it('fora do horário ou desligado não envia', async () => {
    const w = buildWorld('2026-11-17T09:00:00Z'); // 6h em SP
    const conf = new ConfirmationService(w.repos, w.integrations, w.funnel, w.clock);
    assert.equal((await conf.runDue()).skipped, 'desligado');
  });
});
