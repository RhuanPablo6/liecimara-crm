'use client';

// Ficha técnica do procedimento: tempo, insumos e custos por sessão, com o preço calculado ao vivo.
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { api, useAction } from '@/lib/api';
import { brl } from '@/lib/format';
import { computePrice, type PricingSettings } from '@/lib/pricing';
import { cn } from '@/lib/utils';

/** "1.234,56" ou "1234.56" → número. */
export const num = (v: string) => {
  const clean = v.replace(/[^\d,.-]/g, '');
  const n = Number.parseFloat(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean);
  return Number.isFinite(n) ? n : 0;
};
const numDot = (v: string) => {
  // quantidades aceitam "0,5" e "0.5"
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
export const money = (v: string) => Math.round(num(v) * 100);
export const toMoney = (c: number) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
export const pctText = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Composição do preço: 4 grupos, cores fixas por grupo (categóricas validadas). */
const GROUPS = [
  { key: 'direct', label: 'Custos diretos', color: '#2a78d6', parts: ['supplies', 'other', 'equipment'] },
  { key: 'fixed', label: 'Custo fixo da clínica', color: '#eb6834', parts: ['fixed'] },
  { key: 'variable', label: 'Impostos, taxas, comissão e marketing', color: '#eda100', parts: ['tax', 'card', 'commission', 'marketing'] },
  { key: 'profit', label: 'Lucro', color: '#1baf7a', parts: ['profit'] },
];

export function PriceComposition({ breakdown, price }: { breakdown: { key: string; label: string; cents: number }[]; price: number }) {
  const groups = GROUPS.map((g) => ({ ...g, cents: breakdown.filter((b) => g.parts.includes(b.key)).reduce((s, b) => s + b.cents, 0) }));
  const loss = groups[3]!.cents < 0;
  const base = Math.max(price, groups.slice(0, 3).reduce((s, g) => s + g.cents, 0));
  return (
    <div className="space-y-2">
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px] bg-slate-100" role="img" aria-label="Composição do preço">
        {groups.map((g) =>
          g.cents > 0 ? (
            <div
              key={g.key}
              className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
              style={{ width: `${(g.cents / base) * 100}%`, background: g.color }}
              title={`${g.label}: ${brl(Math.round(g.cents))}`}
            />
          ) : null,
        )}
      </div>
      <ul className="space-y-1 text-xs">
        {groups.map((g) => (
          <li key={g.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: g.key === 'profit' && loss ? '#e34948' : g.color }} />
              {g.key === 'profit' && loss ? 'Prejuízo' : g.label}
            </span>
            <span className={cn('tabular-nums', g.key === 'profit' && loss && 'font-medium text-red-700')}>
              {brl(Math.round(g.cents))} {price > 0 && <span className="text-muted-foreground">· {pctText((g.cents / price) * 100)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SheetEditor({
  open,
  onOpenChange,
  row,
  supplies,
  settings,
  costPerMinuteCents,
  canApply,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: any | null;
  supplies: any[];
  settings: PricingSettings;
  costPerMinuteCents: number;
  canApply: boolean;
  onSaved: () => void;
}) {
  const [duration, setDuration] = useState('30');
  const [items, setItems] = useState<{ supplyId: string; quantity: string }[]>([]);
  const [other, setOther] = useState('');
  const [equipment, setEquipment] = useState('');
  const [commission, setCommission] = useState('');
  const [margin, setMargin] = useState('');
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState('');
  const { busy, error, run, setError } = useAction();

  useEffect(() => {
    if (!open || !row) return;
    setError(null);
    const s = row.sheet;
    setDuration(String(s?.durationMin ?? 30));
    setItems(s?.items.map((i: any) => ({ supplyId: i.supplyId, quantity: String(i.quantity).replace('.', ',') })) ?? []);
    setOther(toMoney(s?.otherCostCents ?? 0));
    setEquipment(toMoney(s?.equipmentCostCents ?? 0));
    setCommission(s?.commissionPct != null ? String(s.commissionPct).replace('.', ',') : '');
    setMargin(s?.marginPct != null ? String(s.marginPct).replace('.', ',') : '');
    setNotes(s?.notes ?? '');
    setPrice('');
  }, [open, row, setError]);

  const supMap = useMemo(() => new Map(supplies.map((s) => [s.id, s])), [supplies]);
  const sheet = {
    durationMin: Math.max(0, Math.round(numDot(duration))),
    items: items.filter((i) => i.supplyId).map((i) => ({ supplyId: i.supplyId, quantity: numDot(i.quantity) })),
    otherCostCents: money(other),
    equipmentCostCents: money(equipment),
    commissionPct: commission.trim() ? numDot(commission) : null,
    marginPct: margin.trim() ? numDot(margin) : null,
  };
  const r = computePrice(sheet, supMap, settings, costPerMinuteCents);
  const current = row?.currentPriceCents ?? null;
  const target = price.trim() ? money(price) : r.suggestedCents;
  const targetMargin = r.marginAt(target);

  if (!row) return null;

  const save = async (applyCents?: number) => {
    const ok = await run(async () => {
      await api(`/pricing/sheets/${row.procedureId}`, { method: 'PUT', body: { ...sheet, notes: notes.trim() || null } });
      if (applyCents) await api(`/pricing/sheets/${row.procedureId}/apply`, { method: 'POST', body: { priceCents: applyCents } });
      return true;
    });
    if (ok) {
      onOpenChange(false);
      onSaved();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ficha técnica · {row.name}</DialogTitle>
          <DialogDescription>Informe o que é gasto em uma sessão. O preço é recalculado enquanto você digita.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* Entradas */}
          <div className="space-y-5">
            <section className="space-y-2">
              <p className="text-sm font-medium">Insumos por sessão</p>
              {supplies.length === 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Cadastre os insumos na aba “Insumos” primeiro.</p>}
              {items.map((it, i) => {
                const sup = supMap.get(it.supplyId);
                const unit = sup ? sup.packageCostCents / sup.packageQty : 0;
                return (
                  <div key={i} className="grid grid-cols-[1fr_90px_100px_auto] items-end gap-2">
                    <Field label={i === 0 ? 'Insumo' : ''}>
                      <NativeSelect value={it.supplyId} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, supplyId: e.target.value } : x)))}>
                        <option value="">Escolha…</option>
                        {supplies.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label={i === 0 ? `Qtd${sup ? ` (${sup.unit})` : ''}` : ''}>
                      <Input value={it.quantity} inputMode="decimal" onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                    </Field>
                    <div className="pb-2 text-right text-sm tabular-nums">
                      {sup ? brl(Math.round(unit * numDot(it.quantity))) : '—'}
                      {sup && <p className="text-[11px] text-muted-foreground">{brl(Math.round(unit))}/{sup.unit}</p>}
                    </div>
                    <Button variant="ghost" size="icon" title="Remover" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
              <Button variant="outline" size="sm" disabled={!supplies.length} onClick={() => setItems((xs) => [...xs, { supplyId: '', quantity: '1' }])}>
                <Plus /> Adicionar insumo
              </Button>
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              <Field label="Tempo de cadeira (min)">
                <Input value={duration} inputMode="numeric" onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="Descartáveis e outros (R$)">
                <Input value={other} inputMode="decimal" placeholder="0,00" onChange={(e) => setOther(e.target.value)} />
              </Field>
              <Field label="Aparelho por sessão (R$)">
                <Input value={equipment} inputMode="decimal" placeholder="0,00" onChange={(e) => setEquipment(e.target.value)} />
              </Field>
            </section>
            <p className="-mt-2 text-xs text-muted-foreground">
              Tempo de cadeira inclui preparo e limpeza da sala. Aparelho por sessão: aluguel/diária dividido pelos atendimentos, ou desgaste da ponteira.
            </p>

            <section className="grid gap-3 sm:grid-cols-2">
              <Field label={`Margem de lucro (%) · padrão ${pctText(settings.marginPct)}`}>
                <Input value={margin} inputMode="decimal" placeholder={String(settings.marginPct).replace('.', ',')} onChange={(e) => setMargin(e.target.value)} />
              </Field>
              <Field label={`Comissão (%) · padrão ${pctText(settings.commissionPct)}`}>
                <Input value={commission} inputMode="decimal" placeholder={String(settings.commissionPct).replace('.', ',')} onChange={(e) => setCommission(e.target.value)} />
              </Field>
            </section>
            <Field label="Anotações">
              <Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: 50 U no terço superior; retoque em 15 dias incluso" />
            </Field>
          </div>

          {/* Resultado */}
          <div className="space-y-4 rounded-xl border bg-secondary/30 p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Custo da sessão</p>
                <p className="text-xl font-semibold tabular-nums">{brl(r.totalCostCents)}</p>
                <p className="text-xs text-muted-foreground">
                  diretos {brl(r.directCents)} · fixo {brl(r.fixedShareCents)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Preço mínimo</p>
                <p className="text-xl font-semibold tabular-nums">{brl(r.minimumCents)}</p>
                <p className="text-xs text-muted-foreground">abaixo disso, prejuízo</p>
              </div>
            </div>
            {r.error ? (
              <ErrorText>{r.error}</ErrorText>
            ) : (
              <div className="rounded-lg bg-navy-800 px-4 py-3 text-navy-100">
                <p className="text-xs uppercase tracking-wider">Preço sugerido · margem {pctText(r.pct.margin)}</p>
                <p className="font-serif text-3xl text-white tabular-nums">{brl(r.suggestedCents)}</p>
                {r.suggestedCents !== r.suggestedRawCents && <p className="text-xs">exato {brl(r.suggestedRawCents)}, arredondado para cima</p>}
              </div>
            )}

            <div className="space-y-2">
              <Field label="Simular preço (R$)">
                <Input value={price} inputMode="decimal" placeholder={toMoney(r.suggestedCents) || '0,00'} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              {current != null && (
                <p className="text-xs text-muted-foreground">
                  Preço atual {brl(current)} → margem{' '}
                  <b className={cn(r.marginAt(current) < 0 ? 'text-red-700' : r.marginAt(current) < r.pct.margin - 0.05 ? 'text-amber-700' : 'text-emerald-700')}>
                    {pctText(r.marginAt(current))}
                  </b>
                  {!price.trim() && (
                    <button type="button" className="ml-2 text-navy-600 underline" onClick={() => setPrice(toMoney(current))}>
                      simular este
                    </button>
                  )}
                </p>
              )}
              {target > 0 && (
                <>
                  <p className="text-sm">
                    A {brl(target)}, sobram{' '}
                    <b className={targetMargin < 0 ? 'text-red-700' : 'text-emerald-700'}>{brl(Math.round((target * targetMargin) / 100))}</b> de lucro por sessão ({pctText(targetMargin)}).
                  </p>
                  <PriceComposition breakdown={r.breakdownAt(target)} price={target} />
                </>
              )}
            </div>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Como o preço é calculado</summary>
              <div className="mt-2 space-y-1">
                <p>Custo fixo da sessão = {sheet.durationMin} min × {brl(costPerMinuteCents)}/min (custo do minuto clínico).</p>
                <p>
                  Percentuais sobre o preço: impostos {pctText(r.pct.tax)} + cartão {pctText(r.pct.card)} + comissão {pctText(r.pct.commission)} + marketing{' '}
                  {pctText(r.pct.marketing)} = {pctText(r.pct.variable)}.
                </p>
                <p>
                  Preço = custo ÷ (1 − {pctText(r.pct.variable)} − margem {pctText(r.pct.margin)}). Mínimo = custo ÷ (1 − {pctText(r.pct.variable)}).
                </p>
              </div>
            </details>
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => save()}>
            Salvar ficha
          </Button>
          {canApply && target > 0 && !r.error && (
            <Button disabled={busy || target === current} onClick={() => save(target)} title="O preço passa a ser sugerido em orçamentos e vendas">
              Salvar e usar {brl(target)} como preço
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
