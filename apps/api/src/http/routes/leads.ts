import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appointmentSaleSchema, assertCanAttachSale } from './appointmentSale.js';
import type { Container } from '../../container.js';
import { CONFIDENCE_LABELS_PT, LOST_REASON_LABELS_PT, STAGE_LABELS_PT, type Lead } from '../../domain/types.js';
import { ORGANIC_KEYS, ORIGIN_LABELS, originOf } from '../../domain/origin.js';
import { tagOf } from '../../modules/patients/PatientsService.js';
import { DomainError, ForbiddenError } from '../../domain/errors.js';
import { effectivePermissions } from '../../modules/auth/screens.js';
import { dayToDate, isDay } from '../../shared/days.js';
import { nextFreeCodes, normalizeAdCode, suggestedMessage } from '../../modules/ads/adCodes.js';
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
    // Etiqueta novo/carteira: compras ativas de qualquer atendimento do mesmo contato.
    const [allLeads, allSales] = await Promise.all([
      c.repos.leads.list({ limit: 1_000_000 }),
      c.repos.sales.listSoldIn({ from: new Date('2000-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') }),
    ]);
    const contactOfLead = new Map(allLeads.map((l) => [l.id, l.contactId]));
    const purchasesByContact = new Map<string, number>();
    for (const sale of allSales) {
      if (sale.status !== 'ACTIVE') continue;
      const cid = contactOfLead.get(sale.leadId);
      if (cid) purchasesByContact.set(cid, (purchasesByContact.get(cid) ?? 0) + 1);
    }
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
          origin: originOf(l),
          originLabel: ORIGIN_LABELS[originOf(l)],
          patientTag: contact ? tagOf(contact, purchasesByContact.get(contact.id) ?? 0) : 'NEW',
          patientTagManual: contact?.walletPatient != null,
        };
      }),
    );
  }

  app.get('/meta/labels', { preHandler: guard('app:use') }, async () => ({
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
    const b = z
      .object({
        waId: z.string().min(10),
        name: z.string().optional(),
        procedureInterestId: z.string().nullish(),
        // Origem: código do anúncio (da mensagem pronta) OU o anúncio escolhido na lista.
        adCode: z.string().trim().max(20).optional().or(z.literal('')),
        adMetaId: z.string().trim().optional().or(z.literal('')),
        // Origem que não é anúncio (indicação, Instagram...) e etiqueta "da carteira".
        origin: z.object({ type: z.enum(ORGANIC_KEYS as [string, ...string[]]), note: z.string().max(200).nullish() }).nullish(),
        walletPatient: z.boolean().nullish(),
        // Paciente que já estava na agenda antes do CRM: o horário entra junto, já vinculado.
        appointment: z
          .object({
            scheduledFor: z.coerce.date(),
            durationMin: z.number().int().min(5).max(600).default(60),
            procedureId: z.string().min(1).nullish(),
            notes: z.string().max(500).nullish(),
          })
          .nullish(),
        // Valor do procedimento e se já foi pago (opcional).
        sale: z
          .object({
            amountCents: z.number().int().positive('Informe o valor').max(10_000_000_00),
            soldAt: z.string().refine(isDay, 'Data inválida').nullish(),
            dueAt: z.string().refine(isDay, 'Data inválida').nullish(),
            payment: z
              .object({
                method: z.enum(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'BANK_TRANSFER', 'OTHER']),
                installments: z.number().int().min(1).max(24).default(1),
                amountCents: z.number().int().positive().nullish(),
                paidAt: z.string().refine(isDay, 'Data inválida').nullish(),
              })
              .nullish(),
          })
          .nullish(),
      })
      .parse(req.body);
    if (b.sale) {
      const user = await c.repos.users.findById(req.user!.sub);
      const perms = user ? effectivePermissions(user) : [];
      if (!perms.includes('sales:write') || (b.sale.payment && !perms.includes('payments:write'))) {
        throw new ForbiddenError('Seu usuário não pode lançar valores de venda');
      }
      if (!b.appointment?.procedureId && !b.procedureInterestId) throw new DomainError('VALIDATION', 'Escolha o procedimento para lançar o valor');
      if (b.sale.payment?.amountCents && b.sale.payment.amountCents > b.sale.amountCents) {
        throw new DomainError('VALIDATION', 'O valor pago passa do valor do procedimento');
      }
    }
    let attribution: { adMetaId: string; note: string } | null = null;
    if (b.adCode) {
      let code: string;
      try {
        code = normalizeAdCode(b.adCode);
      } catch (e) {
        throw new DomainError('VALIDATION', (e as Error).message);
      }
      const ad = await c.repos.ads.findAdByCode(code);
      if (!ad) throw new DomainError('AD_CODE_NOT_FOUND', `Nenhum anúncio com o código ${code}. Confira em Anúncios.`, 404);
      attribution = { adMetaId: ad.metaId, note: `Código do anúncio na mensagem do paciente: ${code}` };
    } else if (b.adMetaId) {
      attribution = { adMetaId: b.adMetaId, note: 'Anúncio informado pela recepção no cadastro do lead' };
    }
    const actor = actorOf(req);
    const procedureInterestId = b.procedureInterestId ?? b.appointment?.procedureId ?? null;
    let lead;
    let existing = false;
    try {
      lead = await c.funnel.createLeadManually(
        { waId: b.waId, name: b.name, procedureInterestId, attribution, origin: (b.origin as any) ?? null },
        actor,
      );
    } catch (e) {
      // Já tem atendimento em aberto: com horário informado, só acrescenta o agendamento nele.
      if (!(e instanceof DomainError && e.code === 'LEAD_ALREADY_OPEN' && b.appointment)) throw e;
      const contact = await c.repos.contacts.findByWaId(b.waId.replace(/\D/g, ''));
      lead = (await c.repos.leads.findOpenByContact(contact!.id))!;
      existing = true;
    }
    if (b.walletPatient != null) await c.repos.contacts.update(lead.contactId, { walletPatient: b.walletPatient });
    let appointment = null;
    if (b.appointment) {
      appointment = await c.funnel.scheduleAppointment(
        lead.id,
        {
          scheduledFor: b.appointment.scheduledFor,
          durationMin: b.appointment.durationMin,
          procedureId: b.appointment.procedureId ?? null,
          notes: b.appointment.notes ?? null,
        },
        actor,
      );
      lead = (await c.repos.leads.findById(lead.id))!;
    }
    let sale = null;
    let payment = null;
    if (b.sale) {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const soldAt = b.sale.soldAt ?? today;
      sale = await c.funnel.registerSale(
        lead.id,
        { procedureId: (b.appointment?.procedureId ?? b.procedureInterestId)!, amountCents: b.sale.amountCents, soldAt: dayToDate(soldAt) },
        actor,
      );
      const paid = b.sale.payment ? (b.sale.payment.amountCents ?? b.sale.amountCents) : 0;
      if (b.sale.dueAt && paid < b.sale.amountCents) sale = await c.repos.sales.update(sale.id, { dueAt: dayToDate(b.sale.dueAt) });
      if (b.sale.payment) {
        payment = await c.funnel.registerPayment(
          sale.id,
          { amountCents: paid, method: b.sale.payment.method, installments: b.sale.payment.installments, paidAt: dayToDate(b.sale.payment.paidAt ?? today) },
          actor,
        );
      }
      lead = (await c.repos.leads.findById(lead.id))!;
    }
    return { ...lead, appointment, sale, payment, existing };
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
    const b = z.object({ scheduledFor: isoDate, procedureId: z.string().nullish(), durationMin: z.number().int().min(15).max(600).nullish(), sale: appointmentSaleSchema.nullish() }).parse(req.body);
    if (b.sale) await assertCanAttachSale(c, req.user!.sub, b.sale);
    const appt = await c.funnel.scheduleAppointment(leadId, { scheduledFor: b.scheduledFor, procedureId: b.procedureId, durationMin: b.durationMin }, actorOf(req));
    if (b.sale) await c.appointmentSales.attach(appt.id, b.sale, actorOf(req));
    return (await c.repos.appointments.findById(appt.id)) ?? appt;
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

  // ---------- Correções de cliques errados ----------

  app.delete('/procedures-performed/:id', { preHandler: guard('leads:write') }, async (req) => {
    const p = id.parse(req.params);
    return c.funnel.undoProcedurePerformed(p.id, null, actorOf(req));
  });

  app.delete('/payments/:id', { preHandler: guard('payments:write') }, async (req) => {
    const p = id.parse(req.params);
    return c.funnel.deletePayment(p.id, null, actorOf(req));
  });

  app.post('/sales/:id/reactivate', { preHandler: guard('sales:write') }, async (req) => {
    const p = id.parse(req.params);
    return c.funnel.reactivateSale(p.id, actorOf(req));
  });

  app.post('/appointments/:id/reopen', { preHandler: guard('leads:write') }, async (req) => {
    const p = id.parse(req.params);
    return c.funnel.reopenAppointment(p.id, actorOf(req));
  });

  // ---------- Exclusão definitiva (só administrador) ----------

  const confirmBody = z.object({ confirm: z.literal('APAGAR', { errorMap: () => ({ message: 'Digite APAGAR para confirmar' }) }) });

  /** Lead de teste ou cadastrado por engano: some de tudo (agenda, financeiro, relatórios). */
  app.post('/leads/:id/purge', { preHandler: guard('records:delete') }, async (req) => {
    const p = id.parse(req.params);
    confirmBody.parse(req.body);
    return c.repos.tx(async (r) => {
      const lead = await r.leads.findById(p.id);
      if (!lead) throw new DomainError('NOT_FOUND', 'Lead não encontrado', 404);
      const contact = await r.contacts.findById(lead.contactId);
      const res = await r.purge.lead(p.id);
      await r.audit.log({
        userId: req.user!.sub,
        action: 'lead.purge',
        entityType: 'Lead',
        entityId: p.id,
        before: { name: contact?.name ?? null, waId: contact?.waId ?? null, stage: lead.stage },
        after: res,
        ip: req.ip,
      });
      return res;
    });
  });

  app.post('/appointments/:id/purge', { preHandler: guard('records:delete') }, async (req) => {
    const p = id.parse(req.params);
    confirmBody.parse(req.body);
    const appt = await c.repos.appointments.findById(p.id);
    if (!appt) throw new DomainError('NOT_FOUND', 'Agendamento não encontrado', 404);
    // Cancela antes (acerta a etapa do lead) e depois apaga.
    if (appt.status === 'SCHEDULED' || appt.status === 'CONFIRMED') await c.funnel.cancelAppointment(p.id, 'apagado', actorOf(req));
    await c.repos.purge.appointment(p.id);
    await c.audit.record({ userId: req.user!.sub, action: 'appointment.purge', entityType: 'Appointment', entityId: p.id, before: appt, ip: req.ip });
    return { ok: true };
  });

  app.post('/sales/:id/purge', { preHandler: guard('records:delete') }, async (req) => {
    const p = id.parse(req.params);
    confirmBody.parse(req.body);
    const sale = await c.repos.sales.findById(p.id);
    if (!sale) throw new DomainError('NOT_FOUND', 'Venda não encontrada', 404);
    if (sale.status === 'ACTIVE') await c.funnel.cancelSale(p.id, 'apagada', actorOf(req));
    const payments = await c.repos.payments.listBySale(p.id);
    await c.repos.purge.sale(p.id);
    await c.audit.record({ userId: req.user!.sub, action: 'sale.purge', entityType: 'Sale', entityId: p.id, before: { ...sale, payments }, ip: req.ip });
    return { ok: true };
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

  app.get('/procedures', { preHandler: guard('app:use') }, async () => c.repos.procedures.list());

  app.post('/procedures', { preHandler: guard('procedures:manage') }, async (req) => {
    const b = z.object({ name: z.string().min(2), defaultPriceCents: z.number().int().positive().nullish() }).parse(req.body);
    const p = await c.repos.procedures.create({ name: b.name, defaultPriceCents: b.defaultPriceCents ?? null, active: true });
    await c.audit.record({ userId: req.user!.sub, action: 'procedure.create', entityType: 'Procedure', entityId: p.id, after: p, ip: req.ip });
    return p;
  });

  // ── Códigos de anúncio ─────────────────────────────────────
  app.patch('/ads/:metaId/code', { preHandler: guard('procedures:manage') }, async (req) => {
    const { metaId } = z.object({ metaId: z.string().min(1) }).parse(req.params);
    const b = z.object({ code: z.string().nullable() }).parse(req.body);
    let code: string | null = null;
    if (b.code && b.code.trim()) {
      try {
        code = normalizeAdCode(b.code);
      } catch (e) {
        throw new DomainError('VALIDATION', (e as Error).message);
      }
    }
    const before = await c.repos.ads.findAd(metaId);
    const ad = await c.repos.ads.setAdCode(metaId, code);
    await c.audit.record({ userId: req.user!.sub, action: 'ad.code', entityType: 'Ad', entityId: metaId, before: { code: before?.code ?? null }, after: { code }, ip: req.ip });
    return { ...ad, suggestedMessage: ad.code ? suggestedMessage(ad.code) : null };
  });

  /** Gera códigos (A1, A2, ...) para os anúncios sem código. Por padrão só os ativos. */
  app.post('/ads/codes/generate', { preHandler: guard('procedures:manage') }, async (req) => {
    const b = z.object({ includeInactive: z.boolean().optional() }).parse(req.body ?? {});
    const [ads, campaigns] = await Promise.all([c.repos.ads.listAds(), c.repos.ads.listCampaigns()]);
    const cn = new Map(campaigns.map((x) => [x.metaId, x.name]));
    const used = ads.map((a) => a.code).filter((x): x is string => !!x);
    const pending = ads
      .filter((a) => !a.code && (b.includeInactive || a.status === 'ACTIVE'))
      .sort((x, y) => `${cn.get(x.campaignMetaId) ?? ''}|${x.name}`.localeCompare(`${cn.get(y.campaignMetaId) ?? ''}|${y.name}`, 'pt-BR'));
    const codes = nextFreeCodes(used, pending.length);
    for (const [i, ad] of pending.entries()) await c.repos.ads.setAdCode(ad.metaId, codes[i]!);
    await c.audit.record({ userId: req.user!.sub, action: 'ad.codes.generate', entityType: 'Ad', entityId: null, after: { count: pending.length }, ip: req.ip });
    return { generated: pending.length };
  });

  app.get('/ads', { preHandler: guard('app:use') }, async () => {
    const [ads, campaigns] = await Promise.all([c.repos.ads.listAds(), c.repos.ads.listCampaigns()]);
    const cn = new Map(campaigns.map((x) => [x.metaId, x.name]));
    return ads.map((a) => ({
      ...a,
      campaignName: cn.get(a.campaignMetaId) ?? null,
      suggestedMessage: a.code ? suggestedMessage(a.code) : null,
    }));
  });

  app.get('/audit', { preHandler: guard('audit:read') }, async (req) => {
    const q = z.object({ entityType: z.string().optional(), entityId: z.string().optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return c.repos.audit.list(q);
  });
}
