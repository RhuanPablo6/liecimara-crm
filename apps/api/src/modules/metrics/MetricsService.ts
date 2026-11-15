import type { AttributionConfidence, Lead, LeadStage, LostReason, Sale } from '../../domain/types.js';
import type { DateRange, Repos } from '../../ports/repositories.js';

const ALL = 1_000_000;

export interface MetricDefinition {
  key: string;
  label: string;
  criteria: string;
  source: 'META' | 'CRM';
}

/**
 * Definições explícitas de cada contagem. O dashboard mostra o critério ao lado
 * de cada número para que métricas de critérios diferentes não sejam lidas
 * como equivalentes.
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: 'messages', label: 'Mensagens', criteria: 'Mensagens individuais recebidas e enviadas no período (exclui histórico importado).', source: 'CRM' },
  { key: 'conversations', label: 'Conversas', criteria: 'Sequências de mensagens com um contato; 24h sem mensagens inicia nova conversa. Contadas pela data de início.', source: 'CRM' },
  { key: 'uniqueLeads', label: 'Leads únicos', criteria: 'Contatos distintos com lead aberto no período (primeira mensagem do lead dentro do período).', source: 'CRM' },
  { key: 'attributedLeads', label: 'Leads atribuídos a anúncios', criteria: 'Leads com evidência: referência oficial do WhatsApp (referral source_type=ad) ou atribuição manual registrada por usuário.', source: 'CRM' },
  { key: 'appointments', label: 'Agendamentos', criteria: 'Agendamentos criados no período (cancelados mostrados à parte).', source: 'CRM' },
  { key: 'sales', label: 'Vendas', criteria: 'Vendas ativas com data de venda no período. Um lead pode ter várias vendas.', source: 'CRM' },
  { key: 'proceduresPerformed', label: 'Procedimentos realizados', criteria: 'Procedimentos marcados como realizados no período.', source: 'CRM' },
  { key: 'attributedRevenue', label: 'Receita atribuída', criteria: 'Soma das vendas ativas no período cuja atribuição (no momento da venda ou ajustada depois) é oficial ou manual.', source: 'CRM' },
  { key: 'metaConversationsStarted', label: 'Conversas iniciadas (Meta)', criteria: 'Métrica da Meta "messaging_conversation_started_7d": conversas atribuídas pela Meta em janela de 7 dias após o clique, por modelo próprio da Meta.', source: 'META' },
  { key: 'spend', label: 'Investimento (Meta)', criteria: 'Valor gasto informado pela Meta Marketing API (insights diários).', source: 'META' },
];

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10000) / 100 : null);
const ratio = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) / 100 : null);
const div = (num: number, den: number) => (den > 0 ? Math.round(num / den) : null);

function sumBy<T>(rows: T[], f: (t: T) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

function confidenceSplit<T>(rows: T[], get: (t: T) => AttributionConfidence) {
  const out: Record<AttributionConfidence, T[]> = { OFFICIAL_REFERRAL: [], MANUAL: [], UNKNOWN: [] };
  for (const r of rows) out[get(r)].push(r);
  return out;
}

export class MetricsService {
  constructor(private readonly repos: Repos) {}

  async summary(range: DateRange) {
    const r = this.repos;
    const [msgs, conversations, leads, appts, salesAll, performed, payments, insights] = await Promise.all([
      r.messages.countIn(range),
      r.conversations.countStartedIn(range),
      r.leads.list({ openedIn: range, limit: ALL }),
      r.appointments.listCreatedIn(range),
      r.sales.listSoldIn(range),
      r.performed.listPerformedIn(range),
      r.payments.listPaidIn(range),
      r.ads.listInsights(range),
    ]);
    const sales = salesAll.filter((s) => s.status === 'ACTIVE');
    const leadsBy = confidenceSplit(leads, (l) => l.attributionConfidence);
    const salesBy = confidenceSplit(sales, (s) => s.attributionConfidence);

    const spendCents = sumBy(insights, (i) => i.spendCents);
    const metaConversationsStarted = sumBy(insights, (i) => i.metaMessagingConversationsStarted);
    const revenueCents = sumBy(sales, (s) => s.amountCents);
    const revenueOfficialCents = sumBy(salesBy.OFFICIAL_REFERRAL, (s) => s.amountCents);
    const revenueManualCents = sumBy(salesBy.MANUAL, (s) => s.amountCents);
    const attributedRevenueCents = revenueOfficialCents + revenueManualCents;
    const attributedLeads = leadsBy.OFFICIAL_REFERRAL.length + leadsBy.MANUAL.length;
    const crmConversationsFromAds = [...(await r.conversations.countStartedByAdIn(range)).values()].reduce((a, b) => a + b, 0);

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      messages: { inbound: msgs.inbound, outbound: msgs.outbound, total: msgs.inbound + msgs.outbound },
      conversations,
      leads: {
        total: leads.length,
        uniqueContacts: new Set(leads.map((l) => l.contactId)).size,
        officialReferral: leadsBy.OFFICIAL_REFERRAL.length,
        manual: leadsBy.MANUAL.length,
        unknown: leadsBy.UNKNOWN.length,
        attributed: attributedLeads,
      },
      appointments: {
        created: appts.length,
        canceled: appts.filter((a) => a.status === 'CANCELED').length,
        attended: appts.filter((a) => a.status === 'ATTENDED').length,
        noShow: appts.filter((a) => a.status === 'NO_SHOW').length,
      },
      sales: {
        count: sales.length,
        canceled: salesAll.length - sales.length,
        revenueCents,
        revenueOfficialCents,
        revenueManualCents,
        revenueUnknownCents: revenueCents - attributedRevenueCents,
        attributedRevenueCents,
        averageTicketCents: div(revenueCents, sales.length),
      },
      proceduresPerformed: performed.length,
      paymentsReceivedCents: sumBy(payments, (p) => p.amountCents),
      investment: {
        spendCents,
        // Custo por lead considera apenas leads com evidência (oficial ou manual).
        costPerAttributedLeadCents: div(spendCents, attributedLeads),
        costPerOfficialLeadCents: div(spendCents, leadsBy.OFFICIAL_REFERRAL.length),
        roas: ratio(attributedRevenueCents, spendCents),
        roasOfficialOnly: ratio(revenueOfficialCents, spendCents),
        roiPercent: spendCents > 0 ? pct(attributedRevenueCents - spendCents, spendCents) : null,
      },
      metaVsCrm: this.compare({
        metaConversationsStarted,
        crmConversationsFromAds,
        crmOfficialLeads: leadsBy.OFFICIAL_REFERRAL.length,
      }),
      definitions: METRIC_DEFINITIONS,
    };
  }

  /**
   * Compara a métrica agregada da Meta com o que o CRM identificou.
   * Os valores são exibidos lado a lado, sempre com `comparable: false`,
   * porque os critérios de contagem são diferentes.
   */
  private compare(v: { metaConversationsStarted: number; crmConversationsFromAds: number; crmOfficialLeads: number }) {
    return [
      {
        label: 'Conversas vindas de anúncios',
        meta: { value: v.metaConversationsStarted, criteria: 'messaging_conversation_started_7d (modelo de atribuição da Meta, janela de 7 dias)' },
        crm: { value: v.crmConversationsFromAds, criteria: 'Conversas cuja primeira mensagem trouxe referral oficial de anúncio' },
        comparable: false,
        difference: v.metaConversationsStarted - v.crmConversationsFromAds,
        note: 'Diferenças são esperadas: a Meta conta por modelo próprio e janela de 7 dias; o CRM só conta referências recebidas no webhook. Use a diferença como indicador de cobertura, não como erro.',
      },
      {
        label: 'Leads de anúncios',
        meta: { value: v.metaConversationsStarted, criteria: 'A Meta não informa leads únicos; o número exibido é de conversas iniciadas.' },
        crm: { value: v.crmOfficialLeads, criteria: 'Leads com referência oficial (um por oportunidade, não por mensagem)' },
        comparable: false,
        difference: v.metaConversationsStarted - v.crmOfficialLeads,
        note: 'Um mesmo contato pode iniciar várias conversas; o CRM o conta como um lead enquanto a oportunidade estiver aberta.',
      },
    ];
  }

  async byAd(range: DateRange) {
    const r = this.repos;
    const [ads, campaigns, adSets, insights, leads, salesAll, convByAd] = await Promise.all([
      r.ads.listAds(),
      r.ads.listCampaigns(),
      r.ads.listAdSets(),
      r.ads.listInsights(range),
      r.leads.list({ openedIn: range, limit: ALL }),
      r.sales.listSoldIn(range),
      r.conversations.countStartedByAdIn(range),
    ]);
    const sales = salesAll.filter((s) => s.status === 'ACTIVE');
    const campaignName = new Map(campaigns.map((c) => [c.metaId, c.name]));
    const adSetName = new Map(adSets.map((a) => [a.metaId, a.name]));
    const apptsByLead = new Map<string, number>();
    for (const a of await r.appointments.listCreatedIn(range)) {
      if (a.status !== 'CANCELED') apptsByLead.set(a.leadId, (apptsByLead.get(a.leadId) ?? 0) + 1);
    }

    const ids = new Set<string>([
      ...ads.map((a) => a.metaId),
      ...insights.map((i) => i.adMetaId),
      ...leads.filter((l) => l.adMetaId).map((l) => l.adMetaId!),
      ...sales.filter((s) => s.adMetaId).map((s) => s.adMetaId!),
    ]);

    const rows = [...ids].map((adMetaId) => {
      const ad = ads.find((a) => a.metaId === adMetaId);
      const ins = insights.filter((i) => i.adMetaId === adMetaId);
      const adLeads = leads.filter((l) => l.adMetaId === adMetaId);
      const adSales = sales.filter((s) => s.adMetaId === adMetaId);
      const spendCents = sumBy(ins, (i) => i.spendCents);
      const revenueCents = sumBy(adSales, (s) => s.amountCents);
      const leadsOfficial = adLeads.filter((l) => l.attributionConfidence === 'OFFICIAL_REFERRAL').length;
      const leadsManual = adLeads.filter((l) => l.attributionConfidence === 'MANUAL').length;
      return {
        adMetaId,
        adName: ad?.name ?? '(anúncio não sincronizado)',
        adSetName: ad ? adSetName.get(ad.adSetMetaId) ?? null : null,
        campaignMetaId: ad?.campaignMetaId ?? null,
        campaignName: ad ? campaignName.get(ad.campaignMetaId) ?? null : null,
        status: ad?.status ?? null,
        spendCents,
        impressions: sumBy(ins, (i) => i.impressions),
        clicks: sumBy(ins, (i) => i.clicks),
        metaConversationsStarted: sumBy(ins, (i) => i.metaMessagingConversationsStarted),
        crmConversationsFromAd: convByAd.get(adMetaId) ?? 0,
        leadsOfficial,
        leadsManual,
        appointments: adLeads.reduce((s, l) => s + (apptsByLead.get(l.id) ?? 0), 0),
        sales: adSales.length,
        revenueCents,
        costPerLeadCents: div(spendCents, leadsOfficial + leadsManual),
        roas: ratio(revenueCents, spendCents),
      };
    });
    return rows.sort((a, b) => b.spendCents - a.spendCents || b.revenueCents - a.revenueCents);
  }

  async byCampaign(range: DateRange) {
    const rows = await this.byAd(range);
    const out = new Map<string, { campaignMetaId: string | null; campaignName: string; spendCents: number; leads: number; sales: number; revenueCents: number; metaConversationsStarted: number }>();
    for (const r of rows) {
      const key = r.campaignMetaId ?? 'sem-campanha';
      const cur = out.get(key) ?? {
        campaignMetaId: r.campaignMetaId,
        campaignName: r.campaignName ?? '(campanha desconhecida)',
        spendCents: 0,
        leads: 0,
        sales: 0,
        revenueCents: 0,
        metaConversationsStarted: 0,
      };
      cur.spendCents += r.spendCents;
      cur.leads += r.leadsOfficial + r.leadsManual;
      cur.sales += r.sales;
      cur.revenueCents += r.revenueCents;
      cur.metaConversationsStarted += r.metaConversationsStarted;
      out.set(key, cur);
    }
    return [...out.values()].map((c) => ({ ...c, roas: ratio(c.revenueCents, c.spendCents), costPerLeadCents: div(c.spendCents, c.leads) }));
  }

  async funnel(range: DateRange) {
    const leads = await this.repos.leads.list({ openedIn: range, limit: ALL });
    const reached = (stages: LeadStage[]) => leads.filter((l) => stages.includes(l.stage)).length;
    // "Alcançou a etapa" considera etapas posteriores (um lead vendido também passou por agendado).
    const history = await Promise.all(leads.map((l) => this.repos.stageHistory.listByLead(l.id)));
    const everReached = (stage: LeadStage) =>
      leads.filter((l, i) => l.stage === stage || history[i]!.some((h) => h.toStage === stage)).length;

    const total = leads.length;
    const lostReasons: Partial<Record<LostReason, number>> = {};
    for (const l of leads) if (l.stage === 'LOST' && l.lostReason) lostReasons[l.lostReason] = (lostReasons[l.lostReason] ?? 0) + 1;

    const stages = (['NEW', 'CONTACTED', 'SCHEDULED', 'ATTENDED', 'WON', 'LOST'] as LeadStage[]).map((s) => ({
      stage: s,
      current: reached([s]),
      everReached: s === 'NEW' ? total : everReached(s),
    }));
    const scheduled = stages.find((s) => s.stage === 'SCHEDULED')!.everReached;
    const won = stages.find((s) => s.stage === 'WON')!.everReached;
    const responseTimes = leads
      .filter((l) => l.firstResponseAt)
      .map((l) => l.firstResponseAt!.getTime() - l.openedAt.getTime())
      .sort((a, b) => a - b);
    return {
      total,
      stages,
      conversion: {
        leadToScheduledPercent: pct(scheduled, total),
        scheduledToWonPercent: pct(won, scheduled),
        leadToWonPercent: pct(won, total),
      },
      medianFirstResponseMinutes: responseTimes.length
        ? Math.round(responseTimes[Math.floor(responseTimes.length / 2)]! / 60000)
        : null,
      lostReasons,
    };
  }

  async timeseries(range: DateRange) {
    const [leads, sales, insights] = await Promise.all([
      this.repos.leads.list({ openedIn: range, limit: ALL }),
      this.repos.sales.listSoldIn(range),
      this.repos.ads.listInsights(range),
    ]);
    const days = new Map<string, { date: string; leadsOfficial: number; leadsManual: number; leadsUnknown: number; spendCents: number; revenueCents: number }>();
    const day = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));
    const get = (k: string) => {
      let v = days.get(k);
      if (!v) days.set(k, (v = { date: k, leadsOfficial: 0, leadsManual: 0, leadsUnknown: 0, spendCents: 0, revenueCents: 0 }));
      return v;
    };
    for (let t = range.from.getTime(); t < range.to.getTime(); t += 86_400_000) get(day(new Date(t)));
    for (const l of leads as Lead[]) {
      const v = get(day(l.openedAt));
      if (l.attributionConfidence === 'OFFICIAL_REFERRAL') v.leadsOfficial++;
      else if (l.attributionConfidence === 'MANUAL') v.leadsManual++;
      else v.leadsUnknown++;
    }
    for (const s of sales as Sale[]) if (s.status === 'ACTIVE') get(day(s.soldAt)).revenueCents += s.amountCents;
    for (const i of insights) get(i.date).spendCents += i.spendCents;
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}
