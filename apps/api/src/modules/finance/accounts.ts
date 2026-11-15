// Contas a pagar / a receber e fluxo de caixa projetado.
//
// A receber:
//  - Pagamentos de pacientes: cada pagamento vira um ou mais recebimentos, conforme a taxa e o prazo
//    da forma de pagamento (ex.: crédito 3x → 3 repasses a cada 30 dias, já descontada a taxa).
//    Repasse com data até hoje = recebido (a maquininha repassa sozinha).
//  - Saldo em aberto das vendas (o paciente ainda deve): vence na previsão informada ou na data da venda.
// A pagar:
//  - Despesas (pagas ou a pagar).
//  - Parcelas de compras de insumos e de aluguel de aparelhos (pagas em ordem).

import type { Expense, Payment, PaymentMethod, Sale, SupplyPurchase } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import { addDays, daysBetween, spDay } from '../../shared/days.js';
import { bucketKeys, bucketOf } from './FinanceService.js';

// ── Taxas e prazos ─────────────────────────────────────────────

export interface FeeRule {
  method: PaymentMethod;
  minInstallments: number;
  maxInstallments: number;
  /** Taxa em % sobre o valor bruto (ex.: 3.49). */
  feePct: number;
  /** Dias até o (primeiro) repasse. */
  receiveDays: number;
  /** Antecipação: recebe tudo de uma vez no prazo, em vez de parcela a parcela. */
  anticipated: boolean;
}

export const FEE_SETTINGS_KEY = 'finance.feeRules';
export const CASH_SETTINGS_KEY = 'finance.cashBalance';

/** Padrão sem taxa (a clínica preenche as taxas da sua maquininha); prazos usuais de mercado. */
export const DEFAULT_FEE_RULES: FeeRule[] = [
  { method: 'PIX', minInstallments: 1, maxInstallments: 1, feePct: 0, receiveDays: 0, anticipated: false },
  { method: 'DEBIT_CARD', minInstallments: 1, maxInstallments: 1, feePct: 0, receiveDays: 1, anticipated: false },
  { method: 'CREDIT_CARD', minInstallments: 1, maxInstallments: 1, feePct: 0, receiveDays: 30, anticipated: false },
  { method: 'CREDIT_CARD', minInstallments: 2, maxInstallments: 6, feePct: 0, receiveDays: 30, anticipated: false },
  { method: 'CREDIT_CARD', minInstallments: 7, maxInstallments: 12, feePct: 0, receiveDays: 30, anticipated: false },
  { method: 'CASH', minInstallments: 1, maxInstallments: 1, feePct: 0, receiveDays: 0, anticipated: false },
  { method: 'BANK_TRANSFER', minInstallments: 1, maxInstallments: 1, feePct: 0, receiveDays: 0, anticipated: false },
  { method: 'OTHER', minInstallments: 1, maxInstallments: 1, feePct: 0, receiveDays: 0, anticipated: false },
];

export function ruleFor(rules: FeeRule[], method: PaymentMethod, installments: number): FeeRule {
  const n = method === 'CREDIT_CARD' ? Math.max(1, installments) : 1;
  return (
    rules.find((r) => r.method === method && n >= r.minInstallments && n <= r.maxInstallments) ??
    rules.find((r) => r.method === method) ?? { method, minInstallments: 1, maxInstallments: 99, feePct: 0, receiveDays: 0, anticipated: false }
  );
}

/** Divide `total` em `n` partes inteiras (a sobra vai para a primeira). */
export function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? total - base * n : 0));
}

export interface Settlement {
  dueDay: string;
  installment: number;
  installments: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

/** Quando e quanto cai na conta por um pagamento de paciente. */
export function settlementsOf(p: Pick<Payment, 'amountCents' | 'method' | 'installments' | 'paidAt'>, rules: FeeRule[]): Settlement[] {
  const rule = ruleFor(rules, p.method, p.installments);
  const n = p.method === 'CREDIT_CARD' ? Math.max(1, p.installments) : 1;
  const fee = Math.round((p.amountCents * rule.feePct) / 100);
  const day = spDay(p.paidAt);
  if (n === 1 || rule.anticipated) {
    return [{ dueDay: addDays(day, rule.receiveDays), installment: 1, installments: 1, grossCents: p.amountCents, feeCents: fee, netCents: p.amountCents - fee }];
  }
  const gross = split(p.amountCents, n);
  const fees = split(fee, n);
  return gross.map((g, i) => ({
    dueDay: addDays(day, rule.receiveDays + 30 * i),
    installment: i + 1,
    installments: n,
    grossCents: g,
    feeCents: fees[i]!,
    netCents: g - fees[i]!,
  }));
}

export const feeOf = (p: Pick<Payment, 'amountCents' | 'method' | 'installments' | 'paidAt'>, rules: FeeRule[]) =>
  settlementsOf(p, rules).reduce((t, s) => t + s.feeCents, 0);

// ── Parcelas de compras ────────────────────────────────────────

/** Mesmo dia N meses depois (ajusta para o último dia do mês quando preciso). */
export function addMonthsDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function firstDueDay(p: Pick<SupplyPurchase, 'purchasedAt' | 'installments' | 'firstDueAt'>) {
  if (p.firstDueAt) return spDay(p.firstDueAt);
  const day = spDay(p.purchasedAt);
  return p.installments > 1 ? addMonthsDay(day, 1) : day;
}

export function purchaseParcels(p: Pick<SupplyPurchase, 'purchasedAt' | 'installments' | 'firstDueAt' | 'totalCents' | 'paidInstallments'>) {
  const n = Math.max(1, p.installments);
  const first = firstDueDay(p);
  return split(p.totalCents, n).map((amountCents, i) => ({
    installment: i + 1,
    installments: n,
    dueDay: addMonthsDay(first, i),
    amountCents,
    paid: i + 1 <= (p.paidInstallments ?? 0),
  }));
}

// ── Lista de contas ────────────────────────────────────────────

export type AccountStatus = 'PAID' | 'PENDING' | 'OVERDUE';

export interface AccountItem {
  key: string;
  type: 'EXPENSE' | 'PURCHASE' | 'RENTAL' | 'CARD' | 'SALE_BALANCE';
  refId: string;
  description: string;
  detail: string | null;
  dueDay: string;
  amountCents: number;
  grossCents?: number;
  feeCents?: number;
  status: AccountStatus;
  installment?: number;
  installments?: number;
  method?: string | null;
  leadId?: string;
  /** Para a mensagem de cobrança (saldo do paciente). */
  waId?: string | null;
  procedureName?: string | null;
}

const statusOf = (done: boolean, dueDay: string, today: string): AccountStatus => (done ? 'PAID' : dueDay < today ? 'OVERDUE' : 'PENDING');

const METHOD_LABEL: Record<string, string> = {
  PIX: 'Pix',
  CREDIT_CARD: 'Crédito',
  DEBIT_CARD: 'Débito',
  CASH: 'Dinheiro',
  BANK_TRANSFER: 'Transferência',
  OTHER: 'Outro',
  BOLETO: 'Boleto',
};

export class AccountsService {
  constructor(private readonly repos: Repos) {}

  async feeRules(): Promise<FeeRule[]> {
    return (await this.repos.settings.get<FeeRule[]>(FEE_SETTINGS_KEY)) ?? DEFAULT_FEE_RULES;
  }

  /** Todas as contas (sem filtro de data): base para a lista e para o fluxo de caixa. */
  async all(today: string): Promise<{ payables: AccountItem[]; receivables: AccountItem[] }> {
    const wide = { from: new Date('2000-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') };
    const [rules, expenses, purchases, payments, sales, procedures] = await Promise.all([
      this.feeRules(),
      this.repos.expenses.list(),
      this.repos.purchases.list(),
      this.repos.payments.listPaidIn(wide),
      this.repos.sales.listSoldIn(wide),
      this.repos.procedures.list(),
    ]);
    const procName = new Map(procedures.map((p) => [p.id, p.name]));
    const saleById = new Map(sales.map((s) => [s.id, s]));
    const { names: patient, phones } = await this.patientNames(sales);

    const payables: AccountItem[] = [];
    for (const e of expenses as Expense[]) {
      const dueDay = spDay(e.date);
      payables.push({
        key: `exp:${e.id}`,
        type: 'EXPENSE',
        refId: e.id,
        description: e.category,
        detail: e.description,
        dueDay,
        amountCents: e.amountCents,
        status: statusOf(e.paid, dueDay, today),
        method: e.paymentMethod,
      });
    }
    for (const p of purchases) {
      const what = p.items.map((i) => i.name).join(', ');
      for (const parcel of purchaseParcels(p)) {
        payables.push({
          key: `pur:${p.id}:${parcel.installment}`,
          type: p.kind === 'RENTAL' ? 'RENTAL' : 'PURCHASE',
          refId: p.id,
          description: p.supplier ?? (p.kind === 'RENTAL' ? 'Aluguel de aparelho' : 'Compra de insumos'),
          detail: what,
          dueDay: parcel.dueDay,
          amountCents: parcel.amountCents,
          status: statusOf(parcel.paid, parcel.dueDay, today),
          installment: parcel.installment,
          installments: parcel.installments,
          method: METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod,
        });
      }
    }

    const receivables: AccountItem[] = [];
    const paidBySale = new Map<string, number>();
    for (const pay of payments) {
      paidBySale.set(pay.saleId, (paidBySale.get(pay.saleId) ?? 0) + pay.amountCents);
      const sale = saleById.get(pay.saleId);
      if (sale?.status === 'CANCELED') continue;
      const who = sale ? (patient.get(sale.leadId) ?? 'Paciente') : 'Paciente';
      for (const s of settlementsOf(pay, rules)) {
        receivables.push({
          key: `pay:${pay.id}:${s.installment}`,
          type: 'CARD',
          refId: pay.saleId,
          description: who,
          detail: sale ? (procName.get(sale.procedureId) ?? null) : null,
          dueDay: s.dueDay,
          amountCents: s.netCents,
          grossCents: s.grossCents,
          feeCents: s.feeCents,
          status: s.dueDay <= today ? 'PAID' : 'PENDING',
          installment: s.installment,
          installments: s.installments,
          method: METHOD_LABEL[pay.method] ?? pay.method,
          leadId: sale?.leadId,
        });
      }
    }
    for (const sale of sales as Sale[]) {
      if (sale.status !== 'ACTIVE') continue;
      const open = sale.amountCents - (paidBySale.get(sale.id) ?? 0);
      if (open <= 0) continue;
      const dueDay = spDay(sale.dueAt ?? sale.soldAt);
      receivables.push({
        key: `bal:${sale.id}`,
        type: 'SALE_BALANCE',
        refId: sale.id,
        description: patient.get(sale.leadId) ?? 'Paciente',
        detail: `Saldo de ${procName.get(sale.procedureId) ?? 'venda'} (venda de ${spDay(sale.soldAt).split('-').reverse().join('/')})`,
        dueDay,
        amountCents: open,
        status: statusOf(false, dueDay, today),
        leadId: sale.leadId,
        waId: phones.get(sale.leadId) ?? null,
        procedureName: procName.get(sale.procedureId) ?? null,
      });
    }

    const byDue = (a: AccountItem, b: AccountItem) => a.dueDay.localeCompare(b.dueDay) || a.description.localeCompare(b.description, 'pt-BR');
    return { payables: payables.sort(byDue), receivables: receivables.sort(byDue) };
  }

  /** Contas com vencimento no período + as vencidas de antes (ainda em aberto). */
  async list(from: string, to: string, today: string) {
    const { payables, receivables } = await this.all(today);
    const pick = (items: AccountItem[]) => items.filter((i) => (i.dueDay >= from && i.dueDay <= to) || (i.status === 'OVERDUE' && i.dueDay < from));
    const week = addDays(today, 7);
    const summary = (items: AccountItem[]) => ({
      overdueCents: items.filter((i) => i.status === 'OVERDUE').reduce((t, i) => t + i.amountCents, 0),
      overdueCount: items.filter((i) => i.status === 'OVERDUE').length,
      next7Cents: items.filter((i) => i.status === 'PENDING' && i.dueDay >= today && i.dueDay <= week).reduce((t, i) => t + i.amountCents, 0),
      periodPendingCents: items.filter((i) => i.status !== 'PAID' && i.dueDay >= from && i.dueDay <= to).reduce((t, i) => t + i.amountCents, 0),
      periodDoneCents: items.filter((i) => i.status === 'PAID' && i.dueDay >= from && i.dueDay <= to).reduce((t, i) => t + i.amountCents, 0),
    });
    return {
      today,
      payables: pick(payables),
      receivables: pick(receivables),
      summary: { payables: summary(payables), receivables: summary(receivables) },
    };
  }

  /** Saldo projetado: saldo informado + o que entra − o que sai, do dia de hoje até `to`. */
  async cashflow(today: string, to: string, granularity: 'day' | 'week' | 'month') {
    const { payables, receivables } = await this.all(today);
    const cash = await this.repos.settings.get<{ amountCents: number; asOf: string }>(CASH_SETTINGS_KEY);
    const keys = bucketKeys(today, to, granularity);
    const rows = new Map(keys.map((k) => [k, { key: k, inCents: 0, outCents: 0, netCents: 0, balanceCents: 0 }]));
    // Vencidas ainda em aberto entram hoje: é o que precisa ser resolvido primeiro.
    const when = (i: AccountItem) => (i.dueDay < today ? today : i.dueDay);
    for (const r of receivables) if (r.status !== 'PAID' && when(r) <= to) rows.get(bucketOf(when(r), granularity))!.inCents += r.amountCents;
    for (const p of payables) if (p.status !== 'PAID' && when(p) <= to) rows.get(bucketOf(when(p), granularity))!.outCents += p.amountCents;
    let balance = cash?.amountCents ?? 0;
    let lowest = { balanceCents: balance, key: today };
    for (const r of rows.values()) {
      r.netCents = r.inCents - r.outCents;
      balance += r.netCents;
      r.balanceCents = balance;
      if (balance < lowest.balanceCents) lowest = { balanceCents: balance, key: r.key };
    }
    const list = [...rows.values()];
    return {
      today,
      to,
      granularity,
      opening: cash ? { amountCents: cash.amountCents, asOf: cash.asOf, staleDays: daysBetween(cash.asOf, today) } : null,
      totals: {
        inCents: list.reduce((t, r) => t + r.inCents, 0),
        outCents: list.reduce((t, r) => t + r.outCents, 0),
        closingCents: balance,
      },
      lowest,
      rows: list,
    };
  }

  private async patientNames(sales: Sale[]) {
    const names = new Map<string, string>();
    const phones = new Map<string, string>();
    for (const leadId of new Set(sales.map((s) => s.leadId))) {
      const lead = await this.repos.leads.findById(leadId);
      const contact = lead ? await this.repos.contacts.findById(lead.contactId) : null;
      const name = contact?.name ?? contact?.profileName ?? (contact?.waId ? `+${contact.waId}` : null);
      if (name) names.set(leadId, name);
      if (contact?.waId) phones.set(leadId, contact.waId);
    }
    return { names, phones };
  }
}
