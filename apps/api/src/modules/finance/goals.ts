// Metas, comparativos e ponto de equilíbrio.
//
// Ponto de equilíbrio (quanto faturar no mês para cobrir tudo):
//   custos fixos do mês ÷ (1 − % de custos variáveis)
//   - custos fixos  = despesas do mês (aluguel, salários...). Sem despesas lançadas ainda,
//                     usa a média dos 3 meses anteriores (estimado).
//   - % variáveis   = (insumos + aluguel de aparelhos + anúncios + taxas) ÷ faturamento,
//                     nos últimos 3 meses (inclui o mês escolhido): estável contra meses atípicos.

import type { Repos } from '../../ports/repositories.js';
import { addDays, daysBetween, spDay } from '../../shared/days.js';
import type { FinanceService } from './FinanceService.js';
import { addMonthsDay } from './accounts.js';

export const GOALS_SETTINGS_KEY = 'finance.goals';

export interface MonthGoal {
  revenueCents: number | null;
  /** Meta de faturamento por procedimento (id → centavos). */
  procedures: Record<string, number>;
}

export interface GoalsSettings {
  default: MonthGoal | null;
  /** A meta padrão vale a partir deste mês (não reescreve o passado). */
  defaultFrom?: string | null;
  months: Record<string, MonthGoal>;
}

export const EMPTY_GOALS: GoalsSettings = { default: null, months: {} };

export const goalFor = (g: GoalsSettings, month: string): (MonthGoal & { source: 'month' | 'default' }) | null =>
  g.months[month]
    ? { ...g.months[month]!, source: 'month' }
    : g.default && (!g.defaultFrom || month >= g.defaultFrom)
      ? { ...g.default, source: 'default' }
      : null;

const monthEnd = (month: string) => addDays(addMonthsDay(`${month}-01`, 1), -1);
const pctChange = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null);

export class GoalsService {
  constructor(
    private readonly repos: Repos,
    private readonly finance: FinanceService,
  ) {}

  async settings(): Promise<GoalsSettings> {
    return (await this.repos.settings.get<GoalsSettings>(GOALS_SETTINGS_KEY)) ?? EMPTY_GOALS;
  }

  async overview(month: string, today: string) {
    const start = `${month}-01`;
    const end = monthEnd(month);
    const daysInMonth = daysBetween(start, end) + 1;
    const state: 'past' | 'current' | 'future' = today > end ? 'past' : today < start ? 'future' : 'current';
    const until = state === 'current' ? today : end;
    const elapsed = state === 'future' ? 0 : daysBetween(start, until) + 1;

    const [goals, cur, full] = await Promise.all([
      this.settings(),
      this.finance.report(start, until, 'day'),
      state === 'current' ? this.finance.report(start, end, 'day') : null,
    ]);

    // Comparativos no mesmo número de dias (dia 1 ao dia N), para ser justo com o mês em andamento.
    const sameSpan = async (m: string) => {
      const s = `${m}-01`;
      const e = monthEnd(m);
      const to = addDays(s, Math.min(Math.max(elapsed, 1), daysBetween(s, e) + 1) - 1);
      const [span, whole] = await Promise.all([this.finance.report(s, to, 'month'), this.finance.report(s, e, 'month')]);
      return { month: m, to, totals: span.totals, fullTotals: whole.totals };
    };
    const prevMonth = addMonthsDay(start, -1).slice(0, 7);
    const lastYear = addMonthsDay(start, -12).slice(0, 7);
    const [prev, ly] = await Promise.all([sameSpan(prevMonth), sameSpan(lastYear)]);

    const t = cur.totals;
    const ticket = (x: { revenueCents: number; salesCount: number }) => (x.salesCount ? Math.round(x.revenueCents / x.salesCount) : null);
    const compare = (o: typeof prev) => ({
      month: o.month,
      to: o.to,
      revenueCents: o.totals.revenueCents,
      salesCount: o.totals.salesCount,
      avgTicketCents: ticket(o.totals),
      profitCents: o.totals.profitCents,
      marginPct: o.totals.marginPct,
      fullMonthRevenueCents: o.fullTotals.revenueCents,
      revenueChangePct: pctChange(t.revenueCents, o.totals.revenueCents),
      salesChangePct: pctChange(t.salesCount, o.totals.salesCount),
      profitChangePct: pctChange(t.profitCents, o.totals.profitCents),
    });

    // Projeção linear do mês em andamento.
    const projectedRevenueCents = state === 'current' && elapsed > 0 ? Math.round((t.revenueCents / elapsed) * daysInMonth) : null;

    // Meta do mês.
    const goal = goalFor(goals, month);
    const goalBlock = goal?.revenueCents
      ? {
          revenueCents: goal.revenueCents,
          source: goal.source,
          achievedPct: Math.round((t.revenueCents / goal.revenueCents) * 1000) / 10,
          missingCents: Math.max(0, goal.revenueCents - t.revenueCents),
          projectedPct: projectedRevenueCents != null ? Math.round((projectedRevenueCents / goal.revenueCents) * 1000) / 10 : null,
          perDayNeededCents:
            state === 'current' && daysInMonth - elapsed > 0
              ? Math.ceil(Math.max(0, goal.revenueCents - t.revenueCents) / (daysInMonth - elapsed))
              : null,
          expectedByNowPct: state === 'current' ? Math.round((elapsed / daysInMonth) * 1000) / 10 : state === 'past' ? 100 : 0,
        }
      : null;

    // Ponto de equilíbrio.
    const windowStart = addMonthsDay(start, -2);
    const win = await this.finance.report(windowStart, until < windowStart ? end : until, 'month');
    const w = win.totals;
    const variableCents = w.suppliesCents + w.rentalCents + w.adSpendCents + w.feesCents;
    const variablePct = w.revenueCents > 0 ? variableCents / w.revenueCents : null;
    const monthFixed = (full ?? cur).totals.expensesCents;
    let fixedCents = monthFixed;
    let fixedEstimated = false;
    if (!fixedCents) {
      const prev3 = await this.finance.report(addMonthsDay(start, -3), addDays(start, -1), 'month');
      fixedCents = Math.round(prev3.totals.expensesCents / 3);
      fixedEstimated = fixedCents > 0;
    }
    let breakEven = null;
    if (variablePct != null && variablePct < 1 && fixedCents > 0) {
      const revenueCents = Math.round(fixedCents / (1 - variablePct));
      // Dia em que a margem acumulada do mês cobriu os custos fixos.
      let acc = 0;
      let reachedOn: string | null = null;
      for (const p of cur.series) {
        acc += p.revenueCents * (1 - variablePct);
        if (!reachedOn && acc >= fixedCents) reachedOn = p.key;
      }
      breakEven = {
        revenueCents,
        fixedCents,
        fixedEstimated,
        variablePct: Math.round(variablePct * 1000) / 10,
        contributionPct: Math.round((1 - variablePct) * 1000) / 10,
        achievedPct: Math.round((t.revenueCents / revenueCents) * 1000) / 10,
        missingCents: Math.max(0, revenueCents - t.revenueCents),
        reachedOn,
        salesNeeded: ticket(w) ? Math.ceil(revenueCents / ticket(w)!) : null,
      };
    }

    // Metas por procedimento.
    const procGoals = goal?.procedures ?? {};
    const byProcedure = cur.byProcedure
      .filter((p) => p.procedureId !== '__none__')
      .map((p) => {
        const g = procGoals[p.procedureId] ?? null;
        return {
          procedureId: p.procedureId,
          name: p.name,
          revenueCents: p.revenueCents,
          salesCount: p.salesCount,
          goalCents: g,
          achievedPct: g ? Math.round((p.revenueCents / g) * 1000) / 10 : null,
          projectedCents: state === 'current' && elapsed > 0 ? Math.round((p.revenueCents / elapsed) * daysInMonth) : null,
        };
      })
      .filter((p) => p.goalCents || p.revenueCents)
      .sort((a, b) => (b.goalCents ?? 0) - (a.goalCents ?? 0) || b.revenueCents - a.revenueCents);

    // Histórico de 12 meses (até o mês escolhido).
    const histStart = addMonthsDay(start, -11);
    const hist = await this.finance.report(histStart, end, 'month');
    const history = hist.series.map((s) => ({
      month: s.key,
      label: s.label,
      revenueCents: s.revenueCents,
      costsCents: s.suppliesCents + s.rentalCents + s.adSpendCents + s.feesCents + s.expensesCents,
      profitCents: s.profitCents,
      goalCents: goalFor(goals, s.key)?.revenueCents ?? null,
      partial: s.key === month && state === 'current',
    }));

    return {
      month,
      state,
      until,
      elapsedDays: elapsed,
      daysInMonth,
      totals: { ...t, avgTicketCents: ticket(t) },
      projectedRevenueCents,
      goal: goalBlock,
      breakEven,
      previous: compare(prev),
      lastYear: compare(ly),
      byProcedure,
      history,
    };
  }
}

/** Data de hoje em São Paulo (para quem chama de fora). */
export const todaySP = () => spDay(new Date());
