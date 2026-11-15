// Histórico e ranking de pacientes: tudo o que a clínica sabe de cada pessoa, somando todos os
// atendimentos (leads) dela: origem, agendamentos e comparecimento, compras, pagamentos e saldo.

import { ORIGIN_LABELS, originOf, type OriginType } from '../../domain/origin.js';
import type { Appointment, Contact, Lead, Payment, Sale } from '../../domain/types.js';
import type { DateRange, Repos } from '../../ports/repositories.js';
import { spDay } from '../../shared/days.js';

export type PatientTag = 'NEW' | 'WALLET';
export const TAG_LABELS: Record<PatientTag, string> = { NEW: 'Paciente novo', WALLET: 'Da carteira' };

export type PatientSort = 'spent' | 'purchases' | 'attended' | 'noShow' | 'attendance' | 'ticket' | 'balance' | 'recent';

export interface PatientRow {
  contactId: string;
  name: string | null;
  waId: string | null;
  tag: PatientTag;
  tagManual: boolean;
  origin: OriginType;
  originLabel: string;
  originNote: string | null;
  originAd: string | null;
  firstSeenAt: Date;
  lastActivityAt: Date | null;
  leadId: string | null; // atendimento mais recente
  leadsCount: number;
  appointments: number;
  attended: number;
  noShow: number;
  canceled: number;
  upcoming: number;
  attendancePct: number | null;
  purchases: number;
  spentCents: number;
  paidCents: number;
  balanceCents: number;
  avgTicketCents: number | null;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  lastVisitAt: Date | null;
  procedures: { procedureId: string; name: string; count: number; spentCents: number }[];
}

/** Etiqueta: marcada à mão, ou automática (já comprou → da carteira). */
export function tagOf(contact: Pick<Contact, 'walletPatient'>, purchasesBefore: number): PatientTag {
  if (contact.walletPatient === true) return 'WALLET';
  if (contact.walletPatient === false) return 'NEW';
  return purchasesBefore > 0 ? 'WALLET' : 'NEW';
}

const WIDE: DateRange = { from: new Date('2000-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') };
const inRange = (d: Date, r?: DateRange) => !r || (d >= r.from && d < r.to);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
const earlier = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);

export class PatientsService {
  constructor(private readonly repos: Repos) {}

  private async load() {
    const [contacts, leads, appointments, sales, payments, procedures, ads] = await Promise.all([
      this.repos.contacts.list(),
      this.repos.leads.list({ limit: 1_000_000 }),
      this.repos.appointments.listScheduledBetween(WIDE),
      this.repos.sales.listSoldIn(WIDE),
      this.repos.payments.listPaidIn(WIDE),
      this.repos.procedures.list(),
      this.repos.ads.listAds(),
    ]);
    return { contacts, leads, appointments, sales, payments, procedures, ads };
  }

  /**
   * Monta uma linha por paciente. Com `range`, compras e agendamentos contam só no período
   * (útil para "quem mais gastou este ano"); a etiqueta novo/carteira olha compras anteriores ao período.
   */
  async rows(range?: DateRange, now = new Date()): Promise<PatientRow[]> {
    const d = await this.load();
    const procName = new Map(d.procedures.map((p) => [p.id, p.name]));
    const adName = new Map(d.ads.map((a) => [a.metaId, a.name]));
    const leadsBy = group(d.leads, (l) => l.contactId);
    const contactOfLead = new Map(d.leads.map((l) => [l.id, l.contactId]));
    const apptsBy = group(d.appointments, (a) => contactOfLead.get(a.leadId) ?? '');
    const salesBy = group(d.sales, (s) => contactOfLead.get(s.leadId) ?? '');
    const saleById = new Map(d.sales.map((s) => [s.id, s]));
    const paysBy = group(d.payments, (p) => contactOfLead.get(saleById.get(p.saleId)?.leadId ?? '') ?? '');

    const rows: PatientRow[] = [];
    for (const c of d.contacts) {
      const leads = (leadsBy.get(c.id) ?? []).sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
      if (!leads.length) continue; // contato sem atendimento (ex.: só importado da agenda)
      const latest = leads.at(-1)!;
      // Origem: a do primeiro atendimento que tiver origem informada (como a pessoa chegou à clínica).
      const withOrigin = leads.find((l) => originOf(l) !== 'UNKNOWN') ?? latest;
      const origin = originOf(withOrigin);

      const allSales = (salesBy.get(c.id) ?? []).filter((s) => s.status === 'ACTIVE');
      const sales = allSales.filter((s) => inRange(s.soldAt, range));
      const before = allSales.filter((s) => s.soldAt < (range?.from ?? now)).length;
      const appts = (apptsBy.get(c.id) ?? []).filter((a) => inRange(a.scheduledFor, range));
      const pays = (paysBy.get(c.id) ?? []).filter((p) => saleById.get(p.saleId)?.status === 'ACTIVE');
      const paidBySale = sumBy(pays, (p) => p.saleId);

      const spent = sales.reduce((t, s) => t + s.amountCents, 0);
      const paid = sales.reduce((t, s) => t + Math.min(s.amountCents, paidBySale.get(s.id) ?? 0), 0);
      const balance = allSales.reduce((t, s) => t + Math.max(0, s.amountCents - (paidBySale.get(s.id) ?? 0)), 0);
      const attended = appts.filter((a) => a.status === 'ATTENDED');
      const noShow = appts.filter((a) => a.status === 'NO_SHOW').length;
      const done = attended.length + noShow;

      const byProc = new Map<string, { count: number; spentCents: number }>();
      for (const s of sales) {
        const cur = byProc.get(s.procedureId) ?? { count: 0, spentCents: 0 };
        byProc.set(s.procedureId, { count: cur.count + 1, spentCents: cur.spentCents + s.amountCents });
      }

      rows.push({
        contactId: c.id,
        name: c.name ?? c.profileName ?? null,
        waId: c.waId,
        tag: tagOf(c, range ? before : allSales.filter((s) => s.soldAt <= now).length),
        tagManual: c.walletPatient != null,
        origin,
        originLabel: ORIGIN_LABELS[origin],
        originNote: withOrigin.originNote ?? null,
        originAd: withOrigin.adMetaId ? (adName.get(withOrigin.adMetaId) ?? null) : null,
        firstSeenAt: c.firstSeenAt,
        lastActivityAt: leads.reduce<Date | null>((m, l) => later(m, l.lastActivityAt), null),
        leadId: latest.id,
        leadsCount: leads.length,
        appointments: appts.filter((a) => a.status !== 'CANCELED').length,
        attended: attended.length,
        noShow,
        canceled: appts.filter((a) => a.status === 'CANCELED').length,
        upcoming: appts.filter((a) => (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && a.scheduledFor > now).length,
        attendancePct: pct(attended.length, done),
        purchases: sales.length,
        spentCents: spent,
        paidCents: paid,
        balanceCents: balance,
        avgTicketCents: sales.length ? Math.round(spent / sales.length) : null,
        firstPurchaseAt: sales.reduce<Date | null>((m, s) => earlier(m, s.soldAt), null),
        lastPurchaseAt: sales.reduce<Date | null>((m, s) => later(m, s.soldAt), null),
        lastVisitAt: attended.reduce<Date | null>((m, a) => later(m, a.scheduledFor), null),
        procedures: [...byProc]
          .map(([procedureId, v]) => ({ procedureId, name: procName.get(procedureId) ?? 'Procedimento removido', ...v }))
          .sort((a, b) => b.spentCents - a.spentCents),
      });
    }
    return rows;
  }

  async list(opts: {
    range?: DateRange;
    sort: PatientSort;
    origin?: OriginType;
    tag?: PatientTag;
    procedureId?: string;
    q?: string;
    onlyClients?: boolean;
    limit: number;
  }) {
    const all = await this.rows(opts.range);
    const q = opts.q?.trim().toLowerCase();
    const digits = q?.replace(/\D/g, '');
    const filtered = all.filter(
      (r) =>
        (!opts.origin || r.origin === opts.origin) &&
        (!opts.tag || r.tag === opts.tag) &&
        (!opts.procedureId || r.procedures.some((p) => p.procedureId === opts.procedureId)) &&
        (!opts.onlyClients || r.purchases > 0) &&
        (!q || (r.name ?? '').toLowerCase().includes(q) || (!!digits && (r.waId ?? '').includes(digits))),
    );
    const key: Record<PatientSort, (r: PatientRow) => number> = {
      spent: (r) => r.spentCents,
      purchases: (r) => r.purchases,
      attended: (r) => r.attended,
      noShow: (r) => r.noShow,
      attendance: (r) => (r.attended + r.noShow >= 2 ? (r.attendancePct ?? -1) : -1),
      ticket: (r) => r.avgTicketCents ?? -1,
      balance: (r) => r.balanceCents,
      recent: (r) => (r.lastActivityAt ?? r.firstSeenAt).getTime(),
    };
    const k = key[opts.sort];
    filtered.sort((a, b) => k(b) - k(a) || b.spentCents - a.spentCents || (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));

    const clients = all.filter((r) => r.purchases > 0);
    const spent = clients.reduce((t, r) => t + r.spentCents, 0);
    const byOrigin = new Map<OriginType, { patients: number; clients: number; spentCents: number }>();
    for (const r of all) {
      const o = byOrigin.get(r.origin) ?? { patients: 0, clients: 0, spentCents: 0 };
      o.patients++;
      if (r.purchases) o.clients++;
      o.spentCents += r.spentCents;
      byOrigin.set(r.origin, o);
    }
    return {
      total: filtered.length,
      rows: filtered.slice(0, opts.limit).map((r, i) => ({ rank: i + 1, ...r })),
      summary: {
        patients: all.length,
        clients: clients.length,
        newPatients: all.filter((r) => r.tag === 'NEW').length,
        walletPatients: all.filter((r) => r.tag === 'WALLET').length,
        spentCents: spent,
        avgPerClientCents: clients.length ? Math.round(spent / clients.length) : null,
        balanceCents: all.reduce((t, r) => t + r.balanceCents, 0),
        byOrigin: [...byOrigin]
          .map(([type, v]) => ({ type, label: ORIGIN_LABELS[type], ...v }))
          .sort((a, b) => b.spentCents - a.spentCents || b.patients - a.patients),
      },
    };
  }

  /** Ficha completa: resumo + linha do tempo de tudo o que aconteceu com o paciente. */
  async detail(contactId: string, now = new Date()) {
    const contact = await this.repos.contacts.findById(contactId);
    if (!contact) return null;
    const row = (await this.rows(undefined, now)).find((r) => r.contactId === contactId) ?? null;
    const d = await this.load();
    const leads = d.leads.filter((l) => l.contactId === contactId).sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    const leadIds = new Set(leads.map((l) => l.id));
    const procName = new Map(d.procedures.map((p) => [p.id, p.name]));
    const adName = new Map(d.ads.map((a) => [a.metaId, a.name]));
    const sales = d.sales.filter((s) => leadIds.has(s.leadId));
    const saleIds = new Set(sales.map((s) => s.id));
    const payments = d.payments.filter((p) => saleIds.has(p.saleId));
    const appts = d.appointments.filter((a) => leadIds.has(a.leadId));
    const performed = (await Promise.all(leads.map((l) => this.repos.performed.listByLead(l.id)))).flat();

    type Event = { at: Date; kind: string; title: string; detail: string | null; amountCents?: number; leadId: string; status?: string };
    const events: Event[] = [];
    for (const l of leads) {
      const o = originOf(l);
      events.push({
        at: l.openedAt,
        kind: 'LEAD',
        title: 'Primeiro contato',
        detail: `Origem: ${ORIGIN_LABELS[o]}${o === 'AD' && l.adMetaId ? ` (${adName.get(l.adMetaId) ?? 'anúncio'})` : ''}${l.originNote ? ` · ${l.originNote}` : ''}`,
        leadId: l.id,
      });
    }
    for (const a of appts as Appointment[]) {
      events.push({
        at: a.scheduledFor,
        kind: 'APPOINTMENT',
        title: `Agendamento${a.procedureId ? `: ${procName.get(a.procedureId) ?? ''}` : ''}`,
        detail: a.status === 'CANCELED' && a.cancelReason ? `Cancelado: ${a.cancelReason}` : null,
        status: a.status,
        leadId: a.leadId,
      });
    }
    for (const s of sales as Sale[]) {
      events.push({
        at: s.soldAt,
        kind: 'SALE',
        title: `Compra: ${procName.get(s.procedureId) ?? 'procedimento'}`,
        detail: s.status === 'CANCELED' ? 'Venda cancelada' : null,
        amountCents: s.amountCents,
        status: s.status,
        leadId: s.leadId,
      });
    }
    const METHOD: Record<string, string> = { PIX: 'Pix', CREDIT_CARD: 'Crédito', DEBIT_CARD: 'Débito', CASH: 'Dinheiro', BANK_TRANSFER: 'Transferência', OTHER: 'Outro' };
    for (const p of payments as Payment[]) {
      const s = sales.find((x) => x.id === p.saleId)!;
      events.push({
        at: p.paidAt,
        kind: 'PAYMENT',
        title: 'Pagamento recebido',
        detail: `${METHOD[p.method] ?? p.method}${p.installments > 1 ? ` ${p.installments}x` : ''} · ${procName.get(s.procedureId) ?? ''}`,
        amountCents: p.amountCents,
        leadId: s.leadId,
      });
    }
    for (const p of performed) {
      events.push({ at: p.performedAt, kind: 'PERFORMED', title: `Procedimento realizado: ${procName.get(p.procedureId) ?? ''}`, detail: null, leadId: p.leadId });
    }
    events.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      contact: {
        id: contact.id,
        name: contact.name ?? contact.profileName ?? null,
        waId: contact.waId,
        firstSeenAt: contact.firstSeenAt,
        walletPatient: contact.walletPatient ?? null,
      },
      summary: row,
      leads: leads.map((l: Lead) => ({
        id: l.id,
        stage: l.stage,
        openedAt: l.openedAt,
        origin: originOf(l),
        originLabel: ORIGIN_LABELS[originOf(l)],
        originNote: l.originNote ?? null,
        adName: l.adMetaId ? (adName.get(l.adMetaId) ?? null) : null,
        attributionConfidence: l.attributionConfidence,
      })),
      events: events.map((e) => ({ ...e, day: spDay(e.at) })),
    };
  }
}

function group<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function sumBy<T extends { amountCents: number }>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + it.amountCents);
  return m;
}
