// Precificação: parâmetros, insumos e fichas técnicas ficam em Configurações (JSON) — volume pequeno,
// uma clínica. O custo fixo vem das Despesas (média dos últimos 3 meses fechados) ou é informado à mão.
import { randomUUID } from 'node:crypto';
import { DomainError, NotFoundError } from '../../domain/errors.js';
import type { Repos } from '../../ports/repositories.js';
import { dayStart, spDay } from '../../shared/days.js';
import type { Clock } from '../../shared/ids.js';
import { DEFAULT_PRICING, type PricingSettings, type PricingSheet, type Supply, computePrice, costPerMinute, unitCost } from './pricing.js';

export const PRICING_SETTINGS_KEY = 'pricing.settings';
export const PRICING_SUPPLIES_KEY = 'pricing.supplies';
export const PRICING_SHEETS_KEY = 'pricing.sheets';

type Actor = { id: string; ip?: string };
const MONTHS = 3;

export class PricingService {
  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
  ) {}

  async settings(): Promise<PricingSettings> {
    return { ...DEFAULT_PRICING, ...((await this.repos.settings.get<Partial<PricingSettings>>(PRICING_SETTINGS_KEY)) ?? {}) };
  }
  async supplies(): Promise<Supply[]> {
    return (await this.repos.settings.get<Supply[]>(PRICING_SUPPLIES_KEY)) ?? [];
  }
  async sheets(): Promise<Record<string, PricingSheet>> {
    return (await this.repos.settings.get<Record<string, PricingSheet>>(PRICING_SHEETS_KEY)) ?? {};
  }

  /** Despesas dos últimos 3 meses fechados, por categoria (média mensal). */
  async fixedCosts(s: PricingSettings) {
    const today = spDay(this.clock.now());
    const [y, m] = today.split('-').map(Number) as [number, number];
    const monthKey = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}`;
    const months: string[] = [];
    for (let i = MONTHS; i >= 1; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      months.push(monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1));
    }
    const from = dayStart(`${months[0]}-01`);
    const to = dayStart(`${monthKey(y, m)}-01`);
    const expenses = await this.repos.expenses.list({ from, to });
    const excluded = new Set(s.excludedCategories.map((c) => c.toLowerCase()));
    const byCat = new Map<string, number>();
    const byMonth = new Map<string, number>(months.map((k) => [k, 0]));
    for (const e of expenses) {
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountCents);
      if (!excluded.has(e.category.toLowerCase())) {
        const k = spDay(e.date).slice(0, 7);
        byMonth.set(k, (byMonth.get(k) ?? 0) + e.amountCents);
      }
    }
    const categories = [...byCat.entries()]
      .map(([category, total]) => ({ category, monthlyCents: Math.round(total / MONTHS), excluded: excluded.has(category.toLowerCase()) }))
      .sort((a, b) => b.monthlyCents - a.monthlyCents);
    const autoMonthlyCents = Math.round(categories.filter((c) => !c.excluded).reduce((s2, c) => s2 + c.monthlyCents, 0));
    return {
      months: [...byMonth.entries()].map(([month, cents]) => ({ month, cents })),
      categories,
      autoMonthlyCents,
      usedMonthlyCents: s.fixedCostMonthlyCents ?? autoMonthlyCents,
      source: s.fixedCostMonthlyCents != null ? ('manual' as const) : ('expenses' as const),
    };
  }

  async overview() {
    const [s, supplies, sheets, procedures] = await Promise.all([this.settings(), this.supplies(), this.sheets(), this.repos.procedures.list()]);
    const fixed = await this.fixedCosts(s);
    const perMinute = costPerMinute(fixed.usedMonthlyCents, s);
    const supMap = new Map(supplies.map((x) => [x.id, x]));
    const used = new Map<string, number>();
    for (const sh of Object.values(sheets)) for (const i of sh.items) used.set(i.supplyId, (used.get(i.supplyId) ?? 0) + 1);
    const rows = procedures
      .filter((p) => p.active || sheets[p.id])
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((p) => {
        const sheet = sheets[p.id] ?? null;
        if (!sheet) return { procedureId: p.id, name: p.name, active: p.active, currentPriceCents: p.defaultPriceCents, sheet: null, result: null };
        const r = computePrice(sheet, supMap, s, perMinute);
        const price = p.defaultPriceCents;
        return {
          procedureId: p.id,
          name: p.name,
          active: p.active,
          currentPriceCents: price,
          sheet,
          result: {
            suppliesCents: r.suppliesCents,
            directCents: r.directCents,
            fixedShareCents: r.fixedShareCents,
            totalCostCents: r.totalCostCents,
            minimumCents: r.minimumCents,
            suggestedCents: r.suggestedCents,
            marginPct: r.pct.margin,
            currentMarginPct: price ? Math.round(r.marginAt(price) * 10) / 10 : null,
            error: r.error,
          },
        };
      });
    return {
      settings: s,
      fixed,
      costPerMinuteCents: perMinute,
      costPerHourCents: Math.round(perMinute * 60),
      supplies: supplies
        .map((x) => ({ ...x, unitCostCents: Math.round(unitCost(x) * 100) / 100, usedIn: used.get(x.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      rows,
    };
  }

  async saveSettings(input: PricingSettings, actor: Actor) {
    if (input.hoursPerMonth <= 0) throw new DomainError('VALIDATION', 'Informe as horas de atendimento por mês');
    if (input.occupancyPct <= 0 || input.occupancyPct > 100) throw new DomainError('VALIDATION', 'A ocupação deve ficar entre 1% e 100%');
    const before = await this.settings();
    await this.repos.settings.set(PRICING_SETTINGS_KEY, input);
    await this.repos.audit.log({ userId: actor.id, action: 'pricing.settings', entityType: 'Setting', entityId: PRICING_SETTINGS_KEY, before, after: input, ip: actor.ip });
    return input;
  }

  async saveSupply(input: Omit<Supply, 'id' | 'updatedAt'> & { id?: string | null }, actor: Actor) {
    const list = await this.supplies();
    const name = input.name.trim();
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== input.id)) {
      throw new DomainError('VALIDATION', `Já existe o insumo "${name}"`);
    }
    if (input.packageQty <= 0) throw new DomainError('VALIDATION', 'Informe quantas unidades vêm na embalagem');
    const now = this.clock.now().toISOString();
    let saved: Supply;
    if (input.id) {
      const i = list.findIndex((x) => x.id === input.id);
      if (i < 0) throw new NotFoundError('Insumo', input.id);
      saved = { ...list[i]!, ...input, id: input.id, name, updatedAt: now };
      list[i] = saved;
    } else {
      saved = { ...input, id: randomUUID(), name, updatedAt: now };
      list.push(saved);
    }
    await this.repos.settings.set(PRICING_SUPPLIES_KEY, list);
    await this.repos.audit.log({ userId: actor.id, action: 'pricing.supply.save', entityType: 'Supply', entityId: saved.id, after: saved, ip: actor.ip });
    return saved;
  }

  async deleteSupply(id: string, actor: Actor) {
    const list = await this.supplies();
    const s = list.find((x) => x.id === id);
    if (!s) throw new NotFoundError('Insumo', id);
    const sheets = await this.sheets();
    const procs = new Map((await this.repos.procedures.list()).map((p) => [p.id, p.name]));
    const usedBy = Object.values(sheets).filter((sh) => sh.items.some((i) => i.supplyId === id));
    if (usedBy.length) {
      throw new DomainError('SUPPLY_IN_USE', `Insumo usado em: ${usedBy.map((u) => procs.get(u.procedureId) ?? '?').join(', ')}. Tire das fichas antes de excluir.`);
    }
    await this.repos.settings.set(PRICING_SUPPLIES_KEY, list.filter((x) => x.id !== id));
    await this.repos.audit.log({ userId: actor.id, action: 'pricing.supply.delete', entityType: 'Supply', entityId: id, before: s, ip: actor.ip });
  }

  async saveSheet(input: Omit<PricingSheet, 'updatedAt'>, actor: Actor) {
    if (!(await this.repos.procedures.findById(input.procedureId))) throw new NotFoundError('Procedimento', input.procedureId);
    const supplies = new Set((await this.supplies()).map((s) => s.id));
    const missing = input.items.find((i) => !supplies.has(i.supplyId));
    if (missing) throw new DomainError('VALIDATION', 'Um dos insumos da ficha não existe mais');
    const sheets = await this.sheets();
    const sheet: PricingSheet = { ...input, updatedAt: this.clock.now().toISOString() };
    sheets[input.procedureId] = sheet;
    await this.repos.settings.set(PRICING_SHEETS_KEY, sheets);
    await this.repos.audit.log({ userId: actor.id, action: 'pricing.sheet.save', entityType: 'Procedure', entityId: input.procedureId, after: sheet, ip: actor.ip });
    return sheet;
  }

  /** Usa o preço como preço padrão do procedimento (orçamentos e vendas passam a sugerir esse valor). */
  async applyPrice(procedureId: string, priceCents: number, actor: Actor) {
    const p = await this.repos.procedures.findById(procedureId);
    if (!p) throw new NotFoundError('Procedimento', procedureId);
    if (!Number.isInteger(priceCents) || priceCents <= 0) throw new DomainError('VALIDATION', 'Preço inválido');
    const updated = await this.repos.procedures.update(procedureId, { defaultPriceCents: priceCents });
    await this.repos.audit.log({
      userId: actor.id,
      action: 'pricing.apply',
      entityType: 'Procedure',
      entityId: procedureId,
      before: { defaultPriceCents: p.defaultPriceCents },
      after: { defaultPriceCents: priceCents },
      ip: actor.ip,
    });
    return updated;
  }
}
