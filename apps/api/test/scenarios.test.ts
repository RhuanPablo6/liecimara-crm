// Os 12 cenários obrigatórios da diretriz de arquitetura.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  actor,
  buildWorld,
  businessEcho,
  inboundMessage,
  range,
  seedAd,
  seedProcedure,
  statusUpdate,
} from './helpers.js';

const LEAD_PHONE = '5511988887777';

describe('Cenários obrigatórios', () => {
  it('1. novo contato chega por anúncio com referência oficial', async () => {
    const w = buildWorld();
    await seedAd(w);
    const res = await w.deliver(inboundMessage({ id: 'wamid.1', from: LEAD_PHONE, at: '2026-11-02T11:59:00Z', adId: 'AD-100', name: 'Maria' }));
    assert.equal(res.httpStatus, 200);
    assert.equal(res.accepted, 1);
    await w.worker.drain();

    const leads = await w.repos.leads.list({});
    assert.equal(leads.length, 1);
    const lead = leads[0]!;
    assert.equal(lead.attributionConfidence, 'OFFICIAL_REFERRAL');
    assert.equal(lead.adMetaId, 'AD-100');
    assert.equal(lead.adSetMetaId, 'SET-1');
    assert.equal(lead.campaignMetaId, 'CMP-1');
    assert.equal(lead.stage, 'NEW');

    const evidence = await w.repos.evidence.listByLead(lead.id);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]!.kind, 'OFFICIAL_REFERRAL');
    assert.equal(evidence[0]!.sourceId, 'AD-100');
    assert.equal(evidence[0]!.ctwaClid, 'clid-wamid.1');

    const contact = await w.repos.contacts.findByWaId(LEAD_PHONE);
    assert.equal(contact?.profileName, 'Maria');

    const summary = await w.metrics.summary(range('2026-11-01', '2026-11-03'));
    assert.equal(summary.leads.officialReferral, 1);
    assert.equal(summary.leads.attributed, 1);
  });

  it('1b. referência a anúncio ainda não sincronizado é resolvida após sincronizar a Meta', async () => {
    const w = buildWorld();
    await w.deliver(inboundMessage({ id: 'wamid.1b', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z', adId: 'AD-NEW' }));
    await w.worker.drain();
    let [lead] = await w.repos.leads.list({});
    assert.equal(lead!.attributionConfidence, 'OFFICIAL_REFERRAL');
    assert.equal(lead!.adMetaId, 'AD-NEW');
    assert.equal(lead!.campaignMetaId, null);

    await seedAd(w, 'AD-NEW', 'Novo anúncio');
    assert.equal(await w.engine.resolvePendingHierarchy(), 1);
    [lead] = await w.repos.leads.list({});
    assert.equal(lead!.campaignMetaId, 'CMP-1');
  });

  it('2. contato chega sem referência de anúncio → origem desconhecida, sem atribuição presumida', async () => {
    const w = buildWorld();
    await seedAd(w); // existe anúncio ativo, mas NÃO deve ser presumido
    await w.deliver(inboundMessage({ id: 'wamid.2', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z' }));
    await w.worker.drain();
    const [lead] = await w.repos.leads.list({});
    assert.ok(lead);
    assert.equal(lead.attributionConfidence, 'UNKNOWN');
    assert.equal(lead.adMetaId, null);
    assert.equal((await w.repos.evidence.listByLead(lead.id)).length, 0);
  });

  it('2b. referral de publicação (post) é registrado, mas não vira atribuição a anúncio', async () => {
    const w = buildWorld();
    await w.deliver(inboundMessage({ id: 'wamid.2b', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z', postId: 'POST-9' }));
    await w.worker.drain();
    const [lead] = await w.repos.leads.list({});
    assert.equal(lead!.attributionConfidence, 'UNKNOWN');
    const ev = await w.repos.evidence.listByLead(lead!.id);
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.sourceType, 'post');
    assert.equal(ev[0]!.adMetaId, null);
  });

  it('3. paciente existente envia nova mensagem → não duplica contato nem lead', async () => {
    const w = buildWorld();
    await seedAd(w);
    await w.deliver(inboundMessage({ id: 'wamid.3a', from: LEAD_PHONE, at: '2026-11-02T10:00:00Z', adId: 'AD-100' }));
    await w.worker.drain();
    await w.deliver(inboundMessage({ id: 'wamid.3b', from: LEAD_PHONE, at: '2026-11-02T10:05:00Z', text: 'Qual o valor?' }));
    await w.deliver(inboundMessage({ id: 'wamid.3c', from: LEAD_PHONE, at: '2026-11-04T09:00:00Z', text: 'Voltei!' }));
    await w.worker.drain();

    assert.equal(w.repos.s.contacts.size, 1);
    const leads = await w.repos.leads.list({});
    assert.equal(leads.length, 1, 'mensagens seguintes ficam no mesmo lead aberto');
    assert.equal(leads[0]!.attributionConfidence, 'OFFICIAL_REFERRAL', 'mensagem sem referral não apaga a atribuição');
    assert.equal(w.repos.s.messages.size, 3);
    assert.equal(w.repos.s.conversations.size, 2, '48h de intervalo abre nova conversa');

    // Paciente antigo (importado do app), sem lead e sem referral → não vira "lead novo"
    await w.processor.dispatch('WHATSAPP_CLOUD_API', {
      kind: 'CONTACT_SYNC',
      dedupKey: 'c1',
      occurredAt: '2026-10-01T00:00:00Z',
      phoneNumberId: null,
      wabaId: null,
      phone: '5511977776666',
      bsuid: null,
      fullName: 'Ana Paciente',
      firstName: 'Ana',
      action: 'add',
    });
    await w.deliver(inboundMessage({ id: 'wamid.3d', from: '5511977776666', at: '2026-11-04T10:00:00Z', text: 'Oi, tudo bem?' }));
    await w.worker.drain();
    assert.equal((await w.repos.leads.list({})).length, 1);
    const ana = await w.repos.contacts.findByWaId('5511977776666');
    assert.equal(ana?.name, 'Ana Paciente');
    assert.equal(ana?.preExisting, true);
  });

  it('4. o mesmo webhook recebido duas vezes é processado uma única vez', async () => {
    const w = buildWorld();
    await seedAd(w);
    const payload = inboundMessage({ id: 'wamid.4', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z', adId: 'AD-100' });
    const first = await w.deliver(payload);
    const second = await w.deliver(payload);
    assert.deepEqual([first.accepted, first.duplicates], [1, 0]);
    assert.deepEqual([second.accepted, second.duplicates], [0, 1]);
    await w.worker.drain();
    assert.equal(w.repos.s.leads.size, 1);
    assert.equal(w.repos.s.messages.size, 1);
    assert.equal(w.repos.s.evidence.size, 1);

    // Mesmo se o evento for reprocessado manualmente, nada duplica.
    const [evt] = await w.repos.events.list({});
    await w.processor.reprocess(evt!.id);
    await w.worker.drain();
    assert.equal(w.repos.s.messages.size, 1);
    assert.equal(w.repos.s.evidence.size, 1);
  });

  it('5. lead agenda e depois cancela → volta para "em atendimento"', async () => {
    const w = buildWorld();
    await w.deliver(inboundMessage({ id: 'wamid.5', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z' }));
    await w.worker.drain();
    const [lead] = await w.repos.leads.list({});
    const appt = await w.funnel.scheduleAppointment(lead!.id, { scheduledFor: new Date('2026-11-10T14:00:00Z') }, actor);
    assert.equal((await w.repos.leads.findById(lead!.id))!.stage, 'SCHEDULED');

    await w.funnel.cancelAppointment(appt.id, 'Paciente viajou', actor);
    const after = await w.repos.leads.findById(lead!.id);
    assert.equal(after!.stage, 'CONTACTED');
    assert.equal((await w.repos.appointments.findById(appt.id))!.status, 'CANCELED');

    const hist = (await w.repos.stageHistory.listByLead(lead!.id)).map((h) => h.toStage);
    assert.deepEqual(hist, ['NEW', 'SCHEDULED', 'CONTACTED']);

    const s = await w.metrics.summary(range('2026-11-01', '2026-11-03'));
    assert.equal(s.appointments.created, 1);
    assert.equal(s.appointments.canceled, 1);
    assert.ok(w.repos.s.audit.some((a) => a.action === 'appointment.cancel'));
  });

  it('6. lead realiza mais de uma compra', async () => {
    const w = buildWorld();
    await seedAd(w);
    const botox = await seedProcedure(w, 'Toxina botulínica', 120000);
    const preenchimento = await seedProcedure(w, 'Preenchimento labial', 180000);
    await w.deliver(inboundMessage({ id: 'wamid.6', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z', adId: 'AD-100' }));
    await w.worker.drain();
    const [lead] = await w.repos.leads.list({});

    const s1 = await w.funnel.registerSale(lead!.id, { procedureId: botox.id, amountCents: 120000 }, actor);
    w.clock.advance(3_600_000);
    const s2 = await w.funnel.registerSale(lead!.id, { procedureId: preenchimento.id, amountCents: 180000 }, actor);
    await w.funnel.registerPayment(s1.id, { amountCents: 120000, method: 'PIX' }, actor);
    await w.funnel.registerPayment(s2.id, { amountCents: 90000, method: 'CREDIT_CARD', installments: 3 }, actor);
    await assert.rejects(() => w.funnel.registerPayment(s2.id, { amountCents: 100000, method: 'PIX' }, actor), /excede/);
    await w.funnel.markProcedurePerformed(lead!.id, { procedureId: botox.id, saleId: s1.id }, actor);

    const updated = await w.repos.leads.findById(lead!.id);
    assert.equal(updated!.stage, 'WON');
    const sales = await w.repos.sales.listByLead(lead!.id);
    assert.equal(sales.length, 2);
    assert.ok(sales.every((s) => s.attributionConfidence === 'OFFICIAL_REFERRAL' && s.adMetaId === 'AD-100'));

    const sum = await w.metrics.summary(range('2026-11-01', '2026-11-03'));
    assert.equal(sum.sales.count, 2);
    assert.equal(sum.sales.revenueCents, 300000);
    assert.equal(sum.sales.attributedRevenueCents, 300000);
    assert.equal(sum.leads.total, 1, 'duas compras continuam sendo um lead');
    assert.equal(sum.proceduresPerformed, 1);
    assert.equal(sum.paymentsReceivedCents, 210000);
  });

  it('7. lead marcado como perdido (motivo obrigatório)', async () => {
    const w = buildWorld();
    await w.deliver(inboundMessage({ id: 'wamid.7', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z' }));
    await w.worker.drain();
    const [lead] = await w.repos.leads.list({});
    await w.funnel.scheduleAppointment(lead!.id, { scheduledFor: new Date('2026-11-20T10:00:00Z') }, actor);

    await assert.rejects(() => w.funnel.moveStage(lead!.id, 'LOST', actor), /motivo/);
    await assert.rejects(() => w.funnel.markLost(lead!.id, 'OTHER', '', actor), /Descreva/);
    await w.funnel.markLost(lead!.id, 'PRICE', 'Achou caro', actor);

    const l = await w.repos.leads.findById(lead!.id);
    assert.equal(l!.stage, 'LOST');
    assert.equal(l!.lostReason, 'PRICE');
    assert.ok(l!.closedAt);
    const [appt] = await w.repos.appointments.listByLead(lead!.id);
    assert.equal(appt!.status, 'CANCELED', 'agendamento futuro é cancelado');

    const f = await w.metrics.funnel(range('2026-11-01', '2026-11-03'));
    assert.equal(f.lostReasons.PRICE, 1);

    // Nova mensagem sem anúncio logo depois não recria lead; com anúncio, sim (nova oportunidade).
    await w.deliver(inboundMessage({ id: 'wamid.7b', from: LEAD_PHONE, at: '2026-11-03T11:00:00Z' }));
    await w.worker.drain();
    assert.equal(w.repos.s.leads.size, 1);
    await seedAd(w);
    await w.deliver(inboundMessage({ id: 'wamid.7c', from: LEAD_PHONE, at: '2026-11-05T11:00:00Z', adId: 'AD-100' }));
    await w.worker.drain();
    assert.equal(w.repos.s.leads.size, 2);
  });

  it('8. conexão com a Meta indisponível → dados preservados, erro registrado, nova tentativa', async () => {
    const w = buildWorld();
    await w.repos.connections.upsert('META_MARKETING', 'HOMOLOG', {
      adAccountId: '123',
      encryptedCredentials: w.vault.encrypt({ accessToken: 'tok' }),
    });
    // Primeira sincronização OK
    w.http.handler = (url) => {
      if (url.includes('/insights')) {
        return {
          status: 200,
          json: {
            data: [
              {
                ad_id: 'AD-100',
                date_start: '2026-11-01',
                spend: '150.50',
                impressions: '1000',
                clicks: '40',
                actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' }],
              },
            ],
          },
        };
      }
      if (url.includes('/ads?')) return { status: 200, json: { data: [{ id: 'AD-100', name: 'Botox', adset_id: 'SET-1', campaign_id: 'CMP-1' }] } };
      if (url.includes('/adsets')) return { status: 200, json: { data: [{ id: 'SET-1', name: 'Conjunto', campaign_id: 'CMP-1' }] } };
      return { status: 200, json: { data: [{ id: 'CMP-1', name: 'Campanha' }] } };
    };
    const ok = await w.metaSync.sync();
    assert.equal(ok.insightRows, 1);

    // Meta fora do ar
    w.http.handler = () => ({ status: 503, json: { error: { message: 'Service temporarily unavailable', code: 2 } } });
    await w.queue.enqueue('meta.sync', {});
    await w.worker.drain();

    const [job] = await w.queue.list({ status: 'PENDING' });
    assert.ok(job, 'job reagendado');
    assert.equal(job.attempts, 1);
    assert.ok(job.runAt > w.clock.now(), 'com backoff');
    const conn = await w.repos.connections.find('META_MARKETING', 'HOMOLOG');
    assert.equal(conn!.status, 'DEGRADED');
    const errors = await w.repos.connections.recentErrors('META_MARKETING', 5);
    assert.match(errors[0]!.message, /Falha ao consultar a Meta/);

    // Dados anteriores continuam disponíveis
    const s = await w.metrics.summary(range('2026-11-01', '2026-11-03'));
    assert.equal(s.investment.spendCents, 15050);
    assert.equal(s.metaVsCrm[0]!.meta.value, 12);

    // Meta volta: após o backoff a tentativa conclui
    w.http.handler = () => ({ status: 200, json: { data: [] } });
    w.clock.advance(60_000);
    await w.worker.drain();
    assert.equal((await w.repos.connections.find('META_MARKETING', 'HOMOLOG'))!.status, 'CONNECTED');

    // Token expirado é erro definitivo (não fica tentando)
    w.http.handler = () => ({ status: 401, json: { error: { message: 'Error validating access token', code: 190 } } });
    await w.queue.enqueue('meta.sync', {});
    await w.worker.drain();
    assert.equal((await w.queue.list({ status: 'DEAD' })).length, 1);
    assert.equal((await w.repos.connections.find('META_MARKETING', 'HOMOLOG'))!.status, 'ERROR');
  });

  it('9. webhook com falha temporária é reprocessado sem duplicar', async () => {
    const w = buildWorld();
    await seedAd(w);
    let failures = 2;
    w.repos.faultInjector = () => {
      if (failures-- > 0) throw new Error('connection terminated unexpectedly');
    };
    await w.deliver(inboundMessage({ id: 'wamid.9', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z', adId: 'AD-100' }));

    await w.worker.drain();
    let [evt] = await w.repos.events.list({});
    assert.equal(evt!.status, 'FAILED');
    assert.equal(w.repos.s.leads.size, 0, 'transação desfeita, nada parcial');

    w.clock.advance(5_000);
    await w.worker.drain();
    w.clock.advance(10_000);
    await w.worker.drain();

    [evt] = await w.repos.events.list({});
    assert.equal(evt!.status, 'PROCESSED');
    assert.equal(evt!.attempts, 3);
    assert.equal(w.repos.s.leads.size, 1);
    assert.equal(w.repos.s.messages.size, 1);

    // Falha que persiste vira DEAD e pode ser reprocessada manualmente
    const w2 = buildWorld();
    w2.repos.faultInjector = () => {
      throw new Error('db down');
    };
    await w2.deliver(inboundMessage({ id: 'wamid.9b', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z' }));
    for (let i = 0; i < 10; i++) {
      await w2.worker.drain();
      w2.clock.advance(3_600_000);
    }
    const [dead] = await w2.repos.events.list({});
    assert.equal(dead!.status, 'DEAD');
    w2.repos.faultInjector = null;
    await w2.processor.reprocess(dead!.id);
    await w2.worker.drain();
    assert.equal((await w2.repos.events.findById(dead!.id))!.status, 'PROCESSED');
  });

  it('9b. webhook sem assinatura válida é rejeitado e registrado', async () => {
    const w = buildWorld();
    const res = await w.deliver(inboundMessage({ id: 'wamid.x', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z' }), { sign: false });
    assert.equal(res.httpStatus, 401);
    assert.equal(w.repos.s.events.size, 0);
    const conn = await w.repos.connections.find('WHATSAPP_CLOUD_API', 'HOMOLOG');
    assert.equal(conn!.webhookStatus, 'SIGNATURE_FAILURES');
  });

  it('10. venda atribuída manualmente', async () => {
    const w = buildWorld();
    await seedAd(w);
    const proc = await seedProcedure(w);
    await w.deliver(inboundMessage({ id: 'wamid.10', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z' }));
    await w.worker.drain();
    const [lead] = await w.repos.leads.list({});
    assert.equal(lead!.attributionConfidence, 'UNKNOWN');

    await assert.rejects(
      () => w.funnel.registerSale(lead!.id, { procedureId: proc.id, amountCents: 120000, manualAttribution: { adMetaId: 'AD-100', note: ' ' } }, actor),
      /Informe como a origem/,
    );
    const sale = await w.funnel.registerSale(
      lead!.id,
      { procedureId: proc.id, amountCents: 120000, manualAttribution: { adMetaId: 'AD-100', note: 'Paciente mostrou print do anúncio' } },
      actor,
    );
    assert.equal(sale.attributionConfidence, 'MANUAL');
    assert.equal(sale.adMetaId, 'AD-100');
    assert.equal(sale.campaignMetaId, 'CMP-1');
    const l = await w.repos.leads.findById(lead!.id);
    assert.equal(l!.attributionConfidence, 'MANUAL');
    const [ev] = await w.repos.evidence.listByLead(lead!.id);
    assert.equal(ev!.kind, 'MANUAL');
    assert.equal(ev!.recordedById, actor.id);
    assert.ok(w.repos.s.audit.some((a) => a.action === 'attribution.manual' && a.userId === actor.id));

    const s = await w.metrics.summary(range('2026-11-01', '2026-11-03'));
    assert.equal(s.sales.revenueManualCents, 120000);
    assert.equal(s.sales.revenueOfficialCents, 0);

    // Atribuição oficial não pode ser sobrescrita manualmente
    await w.deliver(inboundMessage({ id: 'wamid.10b', from: '5511911112222', at: '2026-11-02T12:00:00Z', adId: 'AD-100' }));
    await w.worker.drain();
    const official = (await w.repos.leads.list({ confidence: 'OFFICIAL_REFERRAL' }))[0]!;
    await assert.rejects(() => w.funnel.attributeManually(official.id, 'AD-100', 'teste', actor), /referência oficial/);
  });

  it('11. mensagem enviada pelo app WhatsApp Business chega pela API (echo)', async () => {
    const w = buildWorld();
    await w.deliver(inboundMessage({ id: 'wamid.11', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z' }));
    await w.worker.drain();
    await w.deliver(businessEcho({ id: 'wamid.echo.11', to: LEAD_PHONE, at: '2026-11-02T11:07:00Z' }));
    await w.worker.drain();

    const msgs = await w.repos.messages.listByContact((await w.repos.contacts.findByWaId(LEAD_PHONE))!.id);
    assert.equal(msgs.length, 2);
    const echo = msgs.find((m) => m.waMessageId === 'wamid.echo.11')!;
    assert.equal(echo.direction, 'OUTBOUND');
    assert.equal(echo.source, 'BUSINESS_APP');
    assert.equal(echo.conversationId, msgs[0]!.conversationId, 'mesma conversa');

    const [lead] = await w.repos.leads.list({});
    assert.equal(lead!.stage, 'CONTACTED');
    assert.equal(lead!.firstResponseAt!.toISOString(), '2026-11-02T11:07:00.000Z');
    const f = await w.metrics.funnel(range('2026-11-01', '2026-11-03'));
    assert.equal(f.medianFirstResponseMinutes, 7);

    const s = await w.metrics.summary(range('2026-11-01', '2026-11-03'));
    assert.deepEqual(s.messages, { inbound: 1, outbound: 1, total: 2 });
    assert.equal(s.conversations, 1);
  });

  it('12. eventos fora de ordem cronológica', async () => {
    const w = buildWorld();
    await seedAd(w);
    // Chegam: (a) mensagem comum 11:05, (b) echo 11:06, (c) status "delivered" antes de "read" invertidos,
    // e por último (d) a mensagem com referral que ocorreu às 11:00.
    await w.deliver(inboundMessage({ id: 'wamid.12b', from: LEAD_PHONE, at: '2026-11-02T11:05:00Z', text: 'Quanto custa?' }));
    await w.deliver(businessEcho({ id: 'wamid.echo.12', to: LEAD_PHONE, at: '2026-11-02T11:06:00Z' }));
    await w.worker.drain();
    let [lead] = await w.repos.leads.list({});
    assert.equal(lead!.attributionConfidence, 'UNKNOWN');

    await w.deliver(inboundMessage({ id: 'wamid.12a', from: LEAD_PHONE, at: '2026-11-02T11:00:00Z', adId: 'AD-100' }));
    await w.worker.drain();
    [lead] = await w.repos.leads.list({});
    assert.equal(w.repos.s.leads.size, 1);
    assert.equal(lead!.attributionConfidence, 'OFFICIAL_REFERRAL', 'evidência atrasada é aplicada');
    assert.equal(lead!.openedAt.toISOString(), '2026-11-02T11:00:00.000Z', 'abertura usa horário real da 1ª mensagem');
    assert.equal(lead!.stage, 'CONTACTED');

    const conv = [...w.repos.s.conversations.values()];
    assert.equal(conv.length, 1);
    assert.equal(conv[0]!.startedAt.toISOString(), '2026-11-02T11:00:00.000Z');
    assert.equal(conv[0]!.openedByAdMetaId, 'AD-100');

    // Duas referências oficiais fora de ordem: vale a de ocorrência mais antiga (primeiro toque)
    await seedAd(w, 'AD-200', 'Preenchimento');
    await w.deliver(inboundMessage({ id: 'wamid.12z', from: '5511933334444', at: '2026-11-02T15:00:00Z', adId: 'AD-200' }));
    await w.deliver(inboundMessage({ id: 'wamid.12y', from: '5511933334444', at: '2026-11-02T14:00:00Z', adId: 'AD-100' }));
    await w.worker.drain();
    const other = (await w.repos.leads.list({})).find((l) => l.id !== lead!.id)!;
    assert.equal(other.adMetaId, 'AD-100');
    assert.equal((await w.repos.evidence.listByLead(other.id)).length, 2, 'as duas evidências ficam registradas');

    // Status: "read" chega antes de "delivered" → não regride
    await w.deliver(statusUpdate({ id: 'wamid.echo.12', status: 'read', at: '2026-11-02T11:10:00Z', recipient: LEAD_PHONE }));
    await w.deliver(statusUpdate({ id: 'wamid.echo.12', status: 'delivered', at: '2026-11-02T11:06:30Z', recipient: LEAD_PHONE }));
    await w.worker.drain();
    assert.equal((await w.repos.messages.findByWaMessageId('wamid.echo.12'))!.status, 'read');

    // Status de mensagem que ainda não existe: tenta de novo e, se nunca chegar, é ignorado
    await w.deliver(statusUpdate({ id: 'wamid.unknown', status: 'delivered', at: '2026-11-02T11:00:00Z', recipient: LEAD_PHONE }));
    for (let i = 0; i < 6; i++) {
      await w.worker.drain();
      w.clock.advance(60_000);
    }
    const ign = (await w.repos.events.list({ status: 'IGNORED' })).find((e) => e.dedupKey.startsWith('status:wamid.unknown'));
    assert.ok(ign, 'status órfão termina como IGNORED');
  });
});

describe('Integração — coexistência', () => {
  it('histórico importado não gera leads e conta como contato pré-existente', async () => {
    const { buildWorld: bw, historyChunk } = await import('./helpers.js');
    const w = bw();
    await w.deliver(
      historyChunk({
        contact: '5511955554444',
        messages: [
          { id: 'h1', at: '2026-08-01T10:00:00Z', text: 'Oi' },
          { id: 'h2', at: '2026-08-01T10:02:00Z', text: 'Olá!', fromBusiness: true },
        ],
      }),
    );
    await w.worker.drain();
    assert.equal(w.repos.s.leads.size, 0);
    assert.equal(w.repos.s.messages.size, 2);
    const c = await w.repos.contacts.findByWaId('5511955554444');
    assert.equal(c!.preExisting, true);
    const conn = await w.repos.connections.find('WHATSAPP_CLOUD_API', 'HOMOLOG');
    assert.equal((conn!.permissionsDiagnostic as any).historySync.status, 'COMPLETE');
    const s = await w.metrics.summary(range('2026-08-01', '2026-08-02'));
    assert.equal(s.messages.total, 0, 'histórico não infla métricas de mensagens');
  });

  it('desconexão (PARTNER_REMOVED) atualiza estado e registra erro', async () => {
    const { accountUpdate } = await import('./helpers.js');
    const w = buildWorld();
    await w.deliver(accountUpdate('PARTNER_REMOVED', 'PRIMARY_INACTIVITY'));
    await w.worker.drain();
    const conn = await w.repos.connections.find('WHATSAPP_CLOUD_API', 'HOMOLOG');
    assert.equal(conn!.status, 'DISCONNECTED');
    const [err] = await w.repos.connections.recentErrors('WHATSAPP_CLOUD_API', 1);
    assert.match(err!.message, /PRIMARY_INACTIVITY/);
    await w.deliver(accountUpdate('ACCOUNT_RECONNECTED'));
    await w.worker.drain();
    assert.equal((await w.repos.connections.find('WHATSAPP_CLOUD_API', 'HOMOLOG'))!.status, 'CONNECTED');
  });
});

describe('Segurança', () => {
  it('credenciais são cifradas e não aparecem no texto armazenado', async () => {
    const { CredentialVault } = await import('../src/infra/crypto/CredentialVault.js');
    const v = new CredentialVault(randomBytes(32).toString('base64'));
    const enc = v.encrypt({ accessToken: 'EAAG-super-secreto' });
    assert.ok(!enc.includes('super-secreto'));
    assert.equal(v.decrypt(enc).accessToken, 'EAAG-super-secreto');
    const other = new CredentialVault(randomBytes(32).toString('base64'));
    assert.throws(() => other.decrypt(enc));
    assert.equal(CredentialVault.mask('EAAG-super-secreto'), '****reto');
  });

  it('JWT, senha e RBAC', async () => {
    const { hashPassword, verifyPassword, signToken, verifyToken } = await import('../src/modules/auth/auth.js');
    const { can } = await import('../src/modules/auth/rbac.js');
    const h = await hashPassword('s3nh@-forte');
    assert.ok(await verifyPassword('s3nh@-forte', h));
    assert.ok(!(await verifyPassword('errada', h)));
    const secret = 'x'.repeat(40);
    const t = signToken({ sub: 'u1', role: 'RECEPTIONIST', name: 'R' }, secret, 60);
    assert.equal(verifyToken(t, secret).sub, 'u1');
    assert.throws(() => verifyToken(t + 'a', secret));
    assert.throws(() => verifyToken(t, secret, Date.now() + 120_000), /expirada/);
    assert.equal(can('RECEPTIONIST', 'integrations:write'), false);
    assert.equal(can('ADMIN', 'integrations:write'), true);
    assert.equal(can('VIEWER', 'leads:write'), false);
  });

  it('auditoria remove campos sensíveis', async () => {
    const { redact } = await import('../src/modules/audit/AuditLogger.js');
    assert.deepEqual(redact({ accessToken: 'abc', nested: { password: 'x', ok: 1 } }), {
      accessToken: '[REDACTED]',
      nested: { password: '[REDACTED]', ok: 1 },
    });
  });

  it('produção exige administrador e confirmação explícita', async () => {
    const { IntegrationService } = await import('../src/modules/integrations/IntegrationService.js');
    const w = buildWorld();
    const svc = new IntegrationService(w.repos, w.vault, w.http, w.clock, 'PRODUCTION', {
      graphVersion: 'v23.0',
      appSecret: 's',
      verifyToken: 'v',
      publicUrl: 'https://crm',
    });
    const input = { wabaId: '1', phoneNumberId: '2', accessToken: 't', coexistence: true };
    await assert.rejects(() => svc.configureWhatsAppCloud(input, { id: 'u', role: 'MANAGER' }), /administrador/);
    await assert.rejects(() => svc.configureWhatsAppCloud(input, { id: 'u', role: 'ADMIN' }), /Confirme/);
    const c = await svc.configureWhatsAppCloud({ ...input, confirmProductionNumber: true }, { id: 'u', role: 'ADMIN' });
    assert.equal(c.environment, 'PRODUCTION');
  });
});
