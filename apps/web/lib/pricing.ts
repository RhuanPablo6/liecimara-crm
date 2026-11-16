// Cópia de apps/api/src/modules/pricing/pricing.ts (cálculo ao vivo na tela). Mantenha as duas iguais.
// Formação de preço: cálculo puro (o mesmo é usado na tela para o "ao vivo").
//
// Custo direto      = insumos (quantidade × custo por unidade) + descartáveis/outros + aluguel do aparelho por sessão
// Custo fixo rateado = minutos do procedimento × custo do minuto clínico
//   custo do minuto  = custos fixos do mês ÷ (horas de atendimento no mês × 60 × ocupação)
// Custo total       = custo direto + custo fixo rateado
// Percentuais sobre o preço (saem de cada venda): impostos + taxa de cartão + comissão + marketing
// Preço mínimo      = custo total ÷ (1 − percentuais)            → empata, lucro zero
// Preço sugerido    = custo total ÷ (1 − percentuais − margem)   → "markup divisor"

export interface PricingSettings {
  /** Custos fixos do mês informados à mão. Nulo = média das Despesas dos últimos 3 meses. */
  fixedCostMonthlyCents: number | null;
  /** Categorias de Despesas que não entram no custo fixo (ex.: impostos já cobertos pelo %). */
  excludedCategories: string[];
  /** Horas que a clínica atende por mês (ex.: 8h × 22 dias = 176). */
  hoursPerMonth: number;
  /** % dessas horas com paciente na cadeira. */
  occupancyPct: number;
  taxPct: number;
  cardFeePct: number;
  commissionPct: number;
  marketingPct: number;
  /** Lucro desejado (% do preço) quando a ficha não define outro. */
  marginPct: number;
  /** Arredondar o preço sugerido para múltiplos de (centavos). 0 = sem arredondar. */
  roundToCents: number;
}

export const DEFAULT_PRICING: PricingSettings = {
  fixedCostMonthlyCents: null,
  excludedCategories: ['Impostos', 'Marketing', 'Anúncios'],
  hoursPerMonth: 160,
  occupancyPct: 60,
  taxPct: 6,
  cardFeePct: 3.5,
  commissionPct: 0,
  marketingPct: 10,
  marginPct: 25,
  roundToCents: 1000,
};

export interface Supply {
  id: string;
  name: string;
  /** Unidade de uso: U, ml, seringa, fio, ponteira, unidade... */
  unit: string;
  /** Quanto custa a embalagem (frasco, caixa). */
  packageCostCents: number;
  /** Quantas unidades de uso vêm na embalagem (ex.: frasco de 100 U → 100). */
  packageQty: number;
  notes: string | null;
  updatedAt: string;
}

export interface PricingSheet {
  procedureId: string;
  durationMin: number;
  items: { supplyId: string; quantity: number }[];
  /** Descartáveis, esterilização, anestésico tópico... por sessão. */
  otherCostCents: number;
  /** Aluguel do aparelho / ponteira por sessão (Ultraformer, Lavieen...). */
  equipmentCostCents: number;
  /** Sobrescrevem os parâmetros gerais quando preenchidos. */
  commissionPct: number | null;
  marginPct: number | null;
  notes: string | null;
  updatedAt: string;
}

export const unitCost = (s: Pick<Supply, 'packageCostCents' | 'packageQty'>) => (s.packageQty > 0 ? s.packageCostCents / s.packageQty : 0);

export interface PricingResult {
  suppliesCents: number;
  otherCents: number;
  equipmentCents: number;
  directCents: number;
  fixedShareCents: number;
  totalCostCents: number;
  /** % sobre o preço. */
  pct: { tax: number; card: number; commission: number; marketing: number; margin: number; variable: number };
  minimumCents: number;
  suggestedRawCents: number;
  suggestedCents: number;
  /** Margem real (lucro ÷ preço) praticando o preço informado. */
  marginAt: (priceCents: number) => number;
  /** Para onde vai cada real do preço informado. */
  breakdownAt: (priceCents: number) => { key: string; label: string; cents: number }[];
  error: string | null;
}

export function computePrice(
  sheet: Pick<PricingSheet, 'durationMin' | 'items' | 'otherCostCents' | 'equipmentCostCents' | 'commissionPct' | 'marginPct'>,
  supplies: Map<string, Pick<Supply, 'packageCostCents' | 'packageQty'>>,
  settings: PricingSettings,
  costPerMinuteCents: number,
): PricingResult {
  const suppliesCents = sheet.items.reduce((s, i) => {
    const sup = supplies.get(i.supplyId);
    return s + (sup ? unitCost(sup) * (i.quantity || 0) : 0);
  }, 0);
  const otherCents = Math.max(0, sheet.otherCostCents || 0);
  const equipmentCents = Math.max(0, sheet.equipmentCostCents || 0);
  const directCents = suppliesCents + otherCents + equipmentCents;
  const fixedShareCents = Math.max(0, sheet.durationMin || 0) * costPerMinuteCents;
  const totalCostCents = directCents + fixedShareCents;
  const commission = sheet.commissionPct ?? settings.commissionPct;
  const margin = sheet.marginPct ?? settings.marginPct;
  const variable = settings.taxPct + settings.cardFeePct + commission + settings.marketingPct;
  const pct = { tax: settings.taxPct, card: settings.cardFeePct, commission, marketing: settings.marketingPct, margin, variable };
  let error: string | null = null;
  if (variable >= 100) error = 'Os percentuais (impostos, cartão, comissão e marketing) somam 100% ou mais.';
  else if (variable + margin >= 100) error = 'Percentuais + margem somam 100% ou mais: não existe preço que feche a conta.';
  const minimumCents = variable < 100 ? totalCostCents / (1 - variable / 100) : 0;
  const suggestedRawCents = !error ? totalCostCents / (1 - (variable + margin) / 100) : 0;
  const step = settings.roundToCents > 0 ? settings.roundToCents : 1;
  const suggestedCents = suggestedRawCents > 0 ? Math.ceil(suggestedRawCents / step) * step : 0;

  const marginAt = (price: number) => (price > 0 ? ((price * (1 - variable / 100) - totalCostCents) / price) * 100 : 0);
  const breakdownAt = (price: number) => {
    const p = (x: number) => (price * x) / 100;
    const profit = price - totalCostCents - p(variable);
    return [
      { key: 'supplies', label: 'Insumos', cents: suppliesCents },
      { key: 'other', label: 'Descartáveis e outros', cents: otherCents },
      { key: 'equipment', label: 'Aparelho (sessão)', cents: equipmentCents },
      { key: 'fixed', label: 'Custo fixo da clínica', cents: fixedShareCents },
      { key: 'tax', label: 'Impostos', cents: p(settings.taxPct) },
      { key: 'card', label: 'Taxa de cartão', cents: p(settings.cardFeePct) },
      { key: 'commission', label: 'Comissão', cents: p(commission) },
      { key: 'marketing', label: 'Marketing', cents: p(settings.marketingPct) },
      { key: 'profit', label: profit >= 0 ? 'Lucro' : 'Prejuízo', cents: profit },
    ];
  };
  const r = Math.round;
  return {
    suppliesCents: r(suppliesCents),
    otherCents: r(otherCents),
    equipmentCents: r(equipmentCents),
    directCents: r(directCents),
    fixedShareCents: r(fixedShareCents),
    totalCostCents: r(totalCostCents),
    pct,
    minimumCents: r(minimumCents),
    suggestedRawCents: r(suggestedRawCents),
    suggestedCents: r(suggestedCents),
    marginAt,
    breakdownAt,
    error,
  };
}

export const costPerMinute = (fixedMonthlyCents: number, s: Pick<PricingSettings, 'hoursPerMonth' | 'occupancyPct'>) => {
  const minutes = s.hoursPerMonth * 60 * (s.occupancyPct / 100);
  return minutes > 0 ? fixedMonthlyCents / minutes : 0;
};
