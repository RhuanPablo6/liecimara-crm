// Financeiro da clínica: faturamento, insumos, anúncios e despesas, no total e por procedimento.
//
// Regras (regime de caixa simplificado, tudo pelo dia civil de São Paulo):
//  - Faturamento = vendas ativas pela data da venda (valor digitado na venda).
//  - Recebido    = pagamentos registrados pela data do pagamento.
//  - Insumos     = compras de insumos pela data da compra (não pelo consumo).
//  - Aluguel     = aluguel de aparelhos (Ultraformer, Lavieen...) pela data do atendimento.
//  - Anúncios    = gasto diário da Meta; vai para o procedimento ligado ao anúncio.
//  - Despesas    = despesas da clínica (aluguel, energia...) pela data.
//  - Resultado   = faturamento − insumos − aluguel − anúncios − despesas.
//  - Por procedimento: margem de contribuição = faturamento − insumos − aluguel − anúncios do procedimento.

import type { Repos } from '../../ports/repositories.js';
import { addDays, dayRange, daysBetween, mondayOf, spDay } from '../../shared/days.js';

export type Granularity = 'day' | 'week' | 'month';

export const NO_PROCEDURE = '__none__';

export interface ProcedureRow {
  procedureId: string;
  name: string;
  appointments: number;
  attended: number;
  salesCount: number;
  revenueCents: number;
  avgTicketCents: number | null;
  suppliesCents: number;
  rentalCents: number;
  adSpendCents: number;
  contributionCents: number;
  marginPct: number | null;
  roas: number | null;
}

export interface SeriesPoint {
  key: string;
  label: string;
  revenueCents: number;
  suppliesCents: number;
  rentalCents: number;
  adSpendCents: number;
  expensesCents: number;
  profitCents: number;
}

export interface FinanceReport {
  from: string;
  to: string;
  granularity: Granularity;
  totals: {
    revenueCents: number;
    receivedCents: number;
    salesCount: number;
    appointments: number;
    suppliesCents: number;
    rentalCents: number;
    adSpendCents: number;
    expensesCents: number;
    expensesPendingCents: number;
    costsCents: number;
    profitCents: number;
    marginPct: number | null;
    roas: number | null;
  };
  byProcedure: ProcedureRow[];
  expensesByCategory: { category: string; amountCents: number; pendingCents: number }[];
  series: SeriesPoint[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Grava um valor num mapa somando. */
function add<K>(m: Map<K, number>, k: K, v: number) {
  m.set(k, (m.get(k) ?? 0) + v);
}

export function bucketOf(day: string, g: Granularity) {
  if (g === 'day') return day;
  if (g === 'week') return mondayOf(day);
  return day.slice(0, 7);
}

function bucketLabel(key: string, g: Granularity, from: string) {
  // Semana que começa antes do período: rotula pelo primeiro dia dentro dele.
  const shown = g === 'week' && key < from ? from : key;
  const [y = '', m = '', d = ''] = shown.split('-');
  if (g === 'month') {
    const name = new Date(`${key}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
    return `${name}/${y.slice(2)}`;
  }
  if (g === 'week') return `sem. ${d}/${m}`;
  return `${d}/${m}`;
}

/** Todas as chaves de período entre `from` e `to`, na ordem. */
export function bucketKeys(from: string, to: string, g: Granularity) {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const k = bucketOf(day, g);
    if (!seen.has(k)) seen.add(k), keys.push(k);
  }
  return keys;
}

/** Quanto de uma compra vai para cada procedimento (o que sobra fica "sem procedimento"). */
export function allocatePurchase(p: { totalCents: number; items: { procedureId?: string | null; amountCents?: number | null }[] }) {
  const out = new Map<string, number>();
  const only = p.items.length === 1 ? p.items[0] : undefined;
  if (only && only.amountCents == null) {
    add(out, only.procedureId ?? NO_PROCEDURE, p.totalCents);
    return out;
  }
  let allocated = 0;
  for (const it of p.items) {
    if (it.amountCents == null) continue;
    add(out, it.procedureId ?? NO_PROCEDURE, it.amountCents);
    allocated += it.amountCents;
  }
  if (p.totalCents > allocated) add(out, NO_PROCEDURE, p.totalCents - allocated);
  return out;
}

export class FinanceService {
  constructor(private readonly repos: Repos) {}

  async report(from: string, to: string, granularity: Granularity): Promise<FinanceReport> {
    const range = dayRange(from, to);
    const inPeriod = (day: string) => day >= from && day <= to;
    // Gastos da Meta são por data (sem hora): busca com folga e filtra pelo dia.
    const insightRange = { from: new Date(`${addDays(from, -1)}T00:00:00Z`), to: new Date(`${addDays(to, 2)}T00:00:00Z`) };

    const [procedures, sales, payments, appointments, purchases, expenses, insights, ads] = await Promise.all([
      this.repos.procedures.list(),
      this.repos.sales.listSoldIn(range),
      this.repos.payments.listPaidIn(range),
      this.repos.appointments.listScheduledBetween(range),
      this.repos.purchases.list(range),
      this.repos.expenses.list(range),
      this.repos.ads.listInsights(insightRange),
      this.repos.ads.listAds(),
    ]);

    const keys = bucketKeys(from, to, granularity);
    const series = new Map<string, SeriesPoint>(
      keys.map((k) => [
        k,
        { key: k, label: bucketLabel(k, granularity, from), revenueCents: 0, suppliesCents: 0, rentalCents: 0, adSpendCents: 0, expensesCents: 0, profitCents: 0 },
      ]),
    );
    const point = (day: string) => series.get(bucketOf(day, granularity));

    const revenue = new Map<string, number>();
    const salesCount = new Map<string, number>();
    const supplies = new Map<string, number>();
    const rental = new Map<string, number>();
    const adSpend = new Map<string, number>();
    const appts = new Map<string, number>();
    const attended = new Map<string, number>();

    let revenueCents = 0;
    let nSales = 0;
    for (const s of sales) {
      const day = spDay(s.soldAt);
      if (s.status !== 'ACTIVE' || !inPeriod(day)) continue;
      revenueCents += s.amountCents;
      nSales++;
      add(revenue, s.procedureId, s.amountCents);
      add(salesCount, s.procedureId, 1);
      point(day)!.revenueCents += s.amountCents;
    }

    const receivedCents = payments.filter((p) => inPeriod(spDay(p.paidAt))).reduce((t, p) => t + p.amountCents, 0);

    // Agendamento sem procedimento: usa o procedimento de interesse do lead.
    const leadProcedure = new Map<string, string | null>();
    let nAppointments = 0;
    for (const a of appointments) {
      if (a.status === 'CANCELED' || !inPeriod(spDay(a.scheduledFor))) continue;
      let proc = a.procedureId;
      if (!proc) {
        if (!leadProcedure.has(a.leadId)) leadProcedure.set(a.leadId, (await this.repos.leads.findById(a.leadId))?.procedureInterestId ?? null);
        proc = leadProcedure.get(a.leadId) ?? null;
      }
      const k = proc ?? NO_PROCEDURE;
      nAppointments++;
      add(appts, k, 1);
      if (a.status === 'ATTENDED') add(attended, k, 1);
    }

    let suppliesCents = 0;
    let rentalCents = 0;
    for (const p of purchases) {
      const day = spDay(p.purchasedAt);
      if (!inPeriod(day)) continue;
      const isRental = p.kind === 'RENTAL';
      if (isRental) {
        rentalCents += p.totalCents;
        point(day)!.rentalCents += p.totalCents;
      } else {
        suppliesCents += p.totalCents;
        point(day)!.suppliesCents += p.totalCents;
      }
      for (const [k, v] of allocatePurchase(p)) add(isRental ? rental : supplies, k, v);
    }

    const adProcedure = new Map(ads.map((a) => [a.metaId, a.procedureId ?? null]));
    let adSpendCents = 0;
    for (const i of insights) {
      if (!inPeriod(i.date) || !i.spendCents) continue;
      adSpendCents += i.spendCents;
      point(i.date)!.adSpendCents += i.spendCents;
      add(adSpend, adProcedure.get(i.adMetaId) ?? NO_PROCEDURE, i.spendCents);
    }

    let expensesCents = 0;
    let expensesPendingCents = 0;
    const byCategory = new Map<string, { amountCents: number; pendingCents: number }>();
    for (const e of expenses) {
      const day = spDay(e.date);
      if (!inPeriod(day)) continue;
      expensesCents += e.amountCents;
      if (!e.paid) expensesPendingCents += e.amountCents;
      point(day)!.expensesCents += e.amountCents;
      const c = byCategory.get(e.category) ?? { amountCents: 0, pendingCents: 0 };
      c.amountCents += e.amountCents;
      if (!e.paid) c.pendingCents += e.amountCents;
      byCategory.set(e.category, c);
    }

    for (const p of series.values()) p.profitCents = p.revenueCents - p.suppliesCents - p.rentalCents - p.adSpendCents - p.expensesCents;

    const row = (procedureId: string, name: string): ProcedureRow => {
      const rev = revenue.get(procedureId) ?? 0;
      const sup = supplies.get(procedureId) ?? 0;
      const rent = rental.get(procedureId) ?? 0;
      const ad = adSpend.get(procedureId) ?? 0;
      const n = salesCount.get(procedureId) ?? 0;
      const contribution = rev - sup - rent - ad;
      return {
        procedureId,
        name,
        appointments: appts.get(procedureId) ?? 0,
        attended: attended.get(procedureId) ?? 0,
        salesCount: n,
        revenueCents: rev,
        avgTicketCents: n ? Math.round(rev / n) : null,
        suppliesCents: sup,
        rentalCents: rent,
        adSpendCents: ad,
        contributionCents: contribution,
        marginPct: pct(contribution, rev),
        roas: ad > 0 && procedureId !== NO_PROCEDURE ? Math.round((rev / ad) * 100) / 100 : null,
      };
    };
    const known = new Set(procedures.map((p) => p.id));
    const byProcedure = procedures
      .map((p) => row(p.id, p.name))
      .filter((r, idx) => procedures[idx]?.active || r.revenueCents || r.suppliesCents || r.rentalCents || r.adSpendCents || r.appointments);
    // Procedimentos apagados/desconhecidos entram como "sem procedimento".
    for (const m of [revenue, salesCount, supplies, rental, adSpend, appts, attended]) {
      for (const [k, v] of [...m]) {
        if (k !== NO_PROCEDURE && !known.has(k)) {
          m.delete(k);
          add(m, NO_PROCEDURE, v);
        }
      }
    }
    const none = row(NO_PROCEDURE, 'Sem procedimento definido');
    if (none.revenueCents || none.suppliesCents || none.rentalCents || none.adSpendCents || none.appointments) byProcedure.push(none);
    byProcedure.sort((a, b) =>
      a.procedureId === NO_PROCEDURE ? 1 : b.procedureId === NO_PROCEDURE ? -1 : b.revenueCents - a.revenueCents || a.name.localeCompare(b.name, 'pt-BR'),
    );

    const costsCents = suppliesCents + rentalCents + adSpendCents + expensesCents;
    const profitCents = revenueCents - costsCents;
    return {
      from,
      to,
      granularity,
      totals: {
        revenueCents,
        receivedCents,
        salesCount: nSales,
        appointments: nAppointments,
        suppliesCents,
        rentalCents,
        adSpendCents,
        expensesCents,
        expensesPendingCents,
        costsCents,
        profitCents,
        marginPct: pct(profitCents, revenueCents),
        roas: adSpendCents > 0 ? Math.round((revenueCents / adSpendCents) * 100) / 100 : null,
      },
      byProcedure,
      expensesByCategory: [...byCategory].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amountCents - a.amountCents),
      series: [...series.values()],
    };
  }
}

/** Limite de pontos no gráfico, para não travar a tela. */
export function checkPeriod(from: string, to: string, g: Granularity) {
  const days = daysBetween(from, to);
  if (days < 0) return 'A data final é anterior à inicial';
  if (days > 3 * 366) return 'Escolha um período de até 3 anos';
  if (g === 'day' && days > 366) return 'Para mais de um ano, agrupe por semana ou mês';
  return null;
}
