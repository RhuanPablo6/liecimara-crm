'use client';

import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/access';
import { ConfirmButton } from '@/components/confirm-button';
import { SheetEditor, money, num, pctText, toMoney } from '@/components/pricing/sheet-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, useAction, useApi } from '@/lib/api';
import { brl } from '@/lib/format';
import type { PricingSettings } from '@/lib/pricing';
import { cn } from '@/lib/utils';

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: React.ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-navy-800')}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Health({ r, price }: { r: any; price: number | null }) {
  if (!r) return <span className="text-xs text-muted-foreground">sem ficha</span>;
  if (r.error) return <span className="text-xs text-red-700">revise %</span>;
  if (!price) return <span className="text-xs text-muted-foreground">sem preço</span>;
  if (price < r.minimumCents)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <AlertTriangle className="size-3" /> Prejuízo
      </span>
    );
  if (r.currentMarginPct < r.marginPct - 0.05)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        <AlertTriangle className="size-3" /> Margem baixa
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
      <CheckCircle2 className="size-3" /> Saudável
    </span>
  );
}

// ── Ordenação ────────────────────────────────────────────

type SortKey = 'name' | 'time' | 'cost' | 'minimum' | 'suggested' | 'current' | 'margin' | 'health';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const healthRank = (r: any) => {
  if (!r.result) return null;
  if (r.result.error || !r.currentPriceCents) return 3;
  if (r.currentPriceCents < r.result.minimumCents) return 0; // prejuízo primeiro
  if (r.result.currentMarginPct < r.result.marginPct - 0.05) return 1;
  return 2;
};
const sortValue = (r: any, key: SortKey): string | number | null => {
  switch (key) {
    case 'name':
      return r.name;
    case 'time':
      return r.sheet?.durationMin ?? null;
    case 'cost':
      return r.result?.totalCostCents ?? null;
    case 'minimum':
      return r.result?.minimumCents ?? null;
    case 'suggested':
      return r.result && !r.result.error ? r.result.suggestedCents : null;
    case 'current':
      return r.currentPriceCents ?? null;
    case 'margin':
      return r.result?.currentMarginPct ?? null;
    case 'health':
      return healthRank(r);
  }
};
/** Vazios (sem ficha / sem preço) ficam sempre no fim. */
function sortRows(rows: any[], sort: Sort) {
  const m = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va == null && vb == null) return a.name.localeCompare(b.name, 'pt-BR');
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(vb as string, 'pt-BR') : (va as number) - (vb as number);
    return c === 0 ? a.name.localeCompare(b.name, 'pt-BR') : c * m;
  });
}

function SortTH({ label, k, sort, onSort, right }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; right?: boolean }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TH className={right ? 'text-right' : undefined} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn('inline-flex items-center gap-1 uppercase hover:text-navy-800', right && 'flex-row-reverse', active && 'text-navy-800')}
        title={active ? (sort.dir === 'asc' ? 'Menor → maior (clique para inverter)' : 'Maior → menor (clique para inverter)') : 'Ordenar do menor para o maior'}
      >
        {label}
        <Icon className={cn('size-3 shrink-0', !active && 'opacity-40')} />
      </button>
    </TH>
  );
}

// ── Insumos ──────────────────────────────────────────────

function SupplyDialog({ open, onOpenChange, supply, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; supply: any | null; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('unidade');
  const [cost, setCost] = useState('');
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const { busy, error, run, setError } = useAction();
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(supply?.name ?? '');
    setUnit(supply?.unit ?? 'unidade');
    setCost(toMoney(supply?.packageCostCents ?? 0));
    setQty(supply ? String(supply.packageQty).replace('.', ',') : '1');
    setNotes(supply?.notes ?? '');
  }, [open, supply, setError]);
  const q = num(qty);
  const unitCost = q > 0 ? money(cost) / q : 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{supply ? 'Editar insumo' : 'Novo insumo'}</DialogTitle>
          <DialogDescription>Informe o preço da embalagem e quantas unidades de uso ela rende. O custo por unidade é calculado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Toxina botulínica 100 U" autoFocus />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Preço da embalagem (R$)">
              <Input value={cost} inputMode="decimal" onChange={(e) => setCost(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Rende (qtd)">
              <Input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Unidade de uso">
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} list="supply-units" />
              <datalist id="supply-units">
                {['U', 'ml', 'seringa', 'unidade', 'fio', 'ponteira', 'disparo', 'par', 'g'].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
          </div>
          <p className="rounded-md bg-secondary/60 px-3 py-2 text-sm">
            Custo por {unit || 'unidade'}: <b className="tabular-nums">{brl(Math.round(unitCost))}</b>
            {unitCost > 0 && unitCost < 100 && <span className="text-muted-foreground"> ({(unitCost / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4 })})</span>}
          </p>
          <Field label="Observação">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fornecedor, marca, lote de referência…" maxLength={500} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              disabled={busy || name.trim().length < 2 || !money(cost) || q <= 0 || !unit.trim()}
              onClick={async () => {
                const ok = await run(() =>
                  api('/pricing/supplies', { method: 'POST', body: { id: supply?.id ?? null, name, unit, packageCostCents: money(cost), packageQty: q, notes: notes.trim() || null } }),
                );
                if (ok) {
                  onOpenChange(false);
                  onSaved();
                }
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Parâmetros ───────────────────────────────────────────

function SettingsForm({ data, canEdit, onSaved }: { data: any; canEdit: boolean; onSaved: () => void }) {
  const s: PricingSettings = data.settings;
  const [manual, setManual] = useState(s.fixedCostMonthlyCents != null);
  const [fixed, setFixed] = useState(toMoney(s.fixedCostMonthlyCents ?? data.fixed.autoMonthlyCents));
  const [excluded, setExcluded] = useState<string[]>(s.excludedCategories);
  const [f, setF] = useState(() => ({
    hoursPerMonth: String(s.hoursPerMonth),
    occupancyPct: String(s.occupancyPct),
    taxPct: String(s.taxPct),
    cardFeePct: String(s.cardFeePct),
    commissionPct: String(s.commissionPct),
    marketingPct: String(s.marketingPct),
    marginPct: String(s.marginPct),
    roundToCents: String(s.roundToCents),
  }));
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const p = (v: string) => num(v.replace('.', ','));
  const autoNow = data.fixed.categories.filter((c: any) => !excluded.includes(c.category)).reduce((a: number, c: any) => a + c.monthlyCents, 0);
  const fixedUsed = manual ? money(fixed) : autoNow;
  const minutes = p(f.hoursPerMonth) * 60 * (p(f.occupancyPct) / 100);
  const variable = p(f.taxPct) + p(f.cardFeePct) + p(f.commissionPct) + p(f.marketingPct);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Custo fixo e hora clínica</CardTitle>
          <CardDescription>Quanto a clínica custa por mês, para estar aberta, e quanto disso cabe em cada minuto de atendimento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 text-sm">
            <button className={cn('rounded-full px-3 py-1', !manual ? 'bg-navy-800 text-white' : 'hover:bg-secondary')} onClick={() => setManual(false)} disabled={!canEdit}>
              Pelas Despesas (automático)
            </button>
            <button className={cn('rounded-full px-3 py-1', manual ? 'bg-navy-800 text-white' : 'hover:bg-secondary')} onClick={() => setManual(true)} disabled={!canEdit}>
              Informar valor
            </button>
          </div>
          {manual ? (
            <Field label="Custos fixos por mês (R$)">
              <Input value={fixed} inputMode="decimal" onChange={(e) => setFixed(e.target.value)} disabled={!canEdit} />
            </Field>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Média mensal de {data.fixed.months.map((m: any) => monthLabel(m.month)).join(', ')} na tela{' '}
                <Link href="/despesas" className="underline">
                  Despesas
                </Link>
                . Desmarque o que já está nos percentuais (impostos, anúncios) para não contar duas vezes.
              </p>
              {data.fixed.categories.length === 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Nenhuma despesa lançada nesses meses. Lance em Despesas ou informe o valor à mão.</p>}
              <div className="divide-y rounded-md border">
                {data.fixed.categories.map((c: any) => {
                  const on = !excluded.includes(c.category);
                  return (
                    <label key={c.category} className={cn('flex items-center justify-between gap-2 px-3 py-1.5 text-sm', !on && 'text-muted-foreground line-through')}>
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!canEdit}
                          onChange={() => setExcluded((xs) => (on ? [...xs, c.category] : xs.filter((x) => x !== c.category)))}
                        />
                        {c.category}
                      </span>
                      <span className="tabular-nums">{brl(c.monthlyCents)}/mês</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Horas de atendimento por mês">
              <Input value={f.hoursPerMonth} inputMode="decimal" onChange={set('hoursPerMonth')} disabled={!canEdit} />
            </Field>
            <Field label="Ocupação da agenda (%)">
              <Input value={f.occupancyPct} inputMode="decimal" onChange={set('occupancyPct')} disabled={!canEdit} />
            </Field>
          </div>
          <div className="rounded-lg bg-navy-800 px-4 py-3 text-navy-100">
            <p className="text-sm">
              {brl(fixedUsed)} ÷ {Math.round(minutes).toLocaleString('pt-BR')} min com paciente
            </p>
            <p className="font-serif text-2xl text-white">
              {brl(minutes > 0 ? Math.round((fixedUsed / minutes) * 60) : 0)} <span className="text-base text-navy-100">por hora clínica</span>
            </p>
            <p className="text-xs">{brl(minutes > 0 ? fixedUsed / minutes : 0)} por minuto de cadeira</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Ocupação: dos horários abertos, quantos têm paciente de fato. Com agenda vazia, cada atendimento precisa pagar uma fatia maior do custo fixo.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Percentuais e margem</CardTitle>
          <CardDescription>Saem de cada venda, proporcionais ao preço. Valem para todos os procedimentos, salvo quando a ficha define outro.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Impostos (%)">
              <Input value={f.taxPct} inputMode="decimal" onChange={set('taxPct')} disabled={!canEdit} />
            </Field>
            <Field label="Taxa média do cartão (%)">
              <Input value={f.cardFeePct} inputMode="decimal" onChange={set('cardFeePct')} disabled={!canEdit} />
            </Field>
            <Field label="Comissão (%)">
              <Input value={f.commissionPct} inputMode="decimal" onChange={set('commissionPct')} disabled={!canEdit} />
            </Field>
            <Field label="Marketing (%)">
              <Input value={f.marketingPct} inputMode="decimal" onChange={set('marketingPct')} disabled={!canEdit} />
            </Field>
            <Field label="Margem de lucro desejada (%)">
              <Input value={f.marginPct} inputMode="decimal" onChange={set('marginPct')} disabled={!canEdit} />
            </Field>
            <Field label="Arredondar preço para cima">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={f.roundToCents}
                onChange={set('roundToCents')}
                disabled={!canEdit}
              >
                <option value="0">Não arredondar</option>
                <option value="100">R$ 1</option>
                <option value="500">R$ 5</option>
                <option value="1000">R$ 10</option>
                <option value="5000">R$ 50</option>
                <option value="10000">R$ 100</option>
              </select>
            </Field>
          </div>
          <p className={cn('rounded-md px-3 py-2 text-sm', variable + p(f.marginPct) >= 100 ? 'bg-red-50 text-red-800' : 'bg-secondary/60')}>
            De cada R$ 100 vendidos: R$ {variable.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} vão para impostos, taxas, comissão e marketing; R${' '}
            {p(f.marginPct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} são o lucro; o resto paga os custos.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Impostos: Simples Nacional costuma ficar entre 6% e 16% conforme o anexo e o faturamento. Confirme com a contabilidade.</li>
            <li>Cartão: média ponderada do que você paga (débito, crédito à vista e parcelado). As taxas estão em Contas.</li>
            <li>Marketing: quanto do faturamento vai para anúncios. Use o valor real do relatório, se já tiver.</li>
          </ul>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 lg:col-span-2">
          <ErrorText>{error}</ErrorText>
          {saved && <span className="text-sm text-emerald-700">Parâmetros salvos. Os preços foram recalculados.</span>}
          <Button
            disabled={busy}
            onClick={async () => {
              setSaved(false);
              const ok = await run(() =>
                api('/pricing/settings', {
                  method: 'PUT',
                  body: {
                    fixedCostMonthlyCents: manual ? money(fixed) : null,
                    excludedCategories: excluded,
                    hoursPerMonth: p(f.hoursPerMonth),
                    occupancyPct: p(f.occupancyPct),
                    taxPct: p(f.taxPct),
                    cardFeePct: p(f.cardFeePct),
                    commissionPct: p(f.commissionPct),
                    marketingPct: p(f.marketingPct),
                    marginPct: p(f.marginPct),
                    roundToCents: Number(f.roundToCents),
                  },
                }),
              );
              if (ok) {
                setSaved(true);
                onSaved();
              }
            }}
          >
            Salvar parâmetros
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Página ───────────────────────────────────────────────

export default function PricingPage() {
  const { data, error, reload } = useApi<any>('/pricing');
  const me = useMe();
  const canEdit = !!me?.permissions.includes('finance:write');
  const canApply = !!me?.permissions.includes('procedures:manage');
  const [editing, setEditing] = useState<any | null>(null);
  const [supply, setSupply] = useState<any | null>(null);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const del = useAction();
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const onSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));
  const sortedRows = useMemo(() => (data ? sortRows(data.rows, sort) : []), [data, sort]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const rows: any[] = data.rows;
  const withSheet = rows.filter((r) => r.result);
  const losing = withSheet.filter((r) => r.currentPriceCents && r.currentPriceCents < r.result.minimumCents);
  const low = withSheet.filter((r) => r.currentPriceCents && r.currentPriceCents >= r.result.minimumCents && r.result.currentMarginPct < r.result.marginPct - 0.05);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-navy-800">Precificação</h1>
        <p className="text-sm text-muted-foreground">
          Preço calculado pelo custo real de cada sessão: insumos, tempo de cadeira, custo fixo da clínica, impostos, taxas e a margem que vocês querem ganhar.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Custo fixo mensal" value={brl(data.fixed.usedMonthlyCents)} hint={data.fixed.source === 'manual' ? 'informado à mão' : 'média das Despesas (3 meses)'} />
        <Kpi label="Custo da hora clínica" value={brl(data.costPerHourCents)} hint={`${data.settings.hoursPerMonth} h/mês · ${data.settings.occupancyPct}% de ocupação`} />
        <Kpi label="Fichas preenchidas" value={`${withSheet.length} de ${rows.length}`} hint="procedimentos com custo calculado" />
        <Kpi
          label="Preços a revisar"
          value={String(losing.length + low.length)}
          tone={losing.length ? 'bad' : low.length ? 'warn' : undefined}
          hint={`${losing.length} com prejuízo · ${low.length} com margem abaixo da meta`}
        />
      </div>

      <Tabs defaultValue="procedures">
        <TabsList>
          <TabsTrigger value="procedures">Procedimentos</TabsTrigger>
          <TabsTrigger value="supplies">Insumos ({data.supplies.length})</TabsTrigger>
          <TabsTrigger value="settings">Parâmetros</TabsTrigger>
        </TabsList>

        <TabsContent value="procedures">
          <Card>
            <CardContent className="pt-5">
              {data.supplies.length === 0 && (
                <p className="mb-4 rounded-md bg-gold-50 px-3 py-2 text-sm text-navy-800">
                  Para começar: 1) confira os <b>Parâmetros</b>; 2) cadastre os <b>Insumos</b> com o preço de compra; 3) clique em cada procedimento e monte a ficha técnica.
                </p>
              )}
              <Table>
                <THead>
                  <TR>
                    <SortTH label="Procedimento" k="name" sort={sort} onSort={onSort} />
                    <SortTH label="Tempo" k="time" sort={sort} onSort={onSort} right />
                    <SortTH label="Custo da sessão" k="cost" sort={sort} onSort={onSort} right />
                    <SortTH label="Preço mínimo" k="minimum" sort={sort} onSort={onSort} right />
                    <SortTH label="Preço sugerido" k="suggested" sort={sort} onSort={onSort} right />
                    <SortTH label="Preço atual" k="current" sort={sort} onSort={onSort} right />
                    <SortTH label="Margem atual" k="margin" sort={sort} onSort={onSort} right />
                    <SortTH label="Situação" k="health" sort={sort} onSort={onSort} />
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {sortedRows.map((r) => (
                    <TR key={r.procedureId} className="cursor-pointer hover:bg-secondary/50" onClick={() => setEditing(r)}>
                      <TD className="font-medium">
                        {r.name}
                        {!r.active && <span className="ml-1 text-xs text-muted-foreground">(inativo)</span>}
                      </TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{r.sheet ? `${r.sheet.durationMin} min` : '—'}</TD>
                      <TD className="text-right tabular-nums">{r.result ? brl(r.result.totalCostCents) : '—'}</TD>
                      <TD className="text-right tabular-nums">{r.result ? brl(r.result.minimumCents) : '—'}</TD>
                      <TD className="text-right font-medium tabular-nums">{r.result && !r.result.error ? brl(r.result.suggestedCents) : '—'}</TD>
                      <TD className="text-right tabular-nums">{brl(r.currentPriceCents)}</TD>
                      <TD
                        className={cn(
                          'text-right tabular-nums',
                          r.result?.currentMarginPct != null && r.result.currentMarginPct < 0 && 'text-red-700',
                        )}
                      >
                        {r.result?.currentMarginPct != null ? pctText(r.result.currentMarginPct) : '—'}
                      </TD>
                      <TD>
                        <Health r={r.result} price={r.currentPriceCents} />
                      </TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="sm" disabled={!canEdit}>
                          <Pencil /> {r.sheet ? 'Ficha' : 'Montar ficha'}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                Preço atual = preço padrão do procedimento (o que aparece em orçamentos e vendas). Margem atual = lucro que sobra a esse preço, já descontados custos, impostos e taxas.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="supplies">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle>Insumos</CardTitle>
                <CardDescription>Produtos usados nos procedimentos, com o preço que vocês pagam hoje. Atualize quando o fornecedor mudar o preço.</CardDescription>
              </div>
              {canEdit && (
                <Button
                  variant="gold"
                  onClick={() => {
                    setSupply(null);
                    setSupplyOpen(true);
                  }}
                >
                  <Plus /> Novo insumo
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {data.supplies.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum insumo cadastrado. Ex.: toxina botulínica (frasco 100 U), ácido hialurônico (seringa 1 ml), fios de PDO, agulhas e cânulas.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Insumo</TH>
                      <TH className="text-right">Embalagem</TH>
                      <TH className="text-right">Rende</TH>
                      <TH className="text-right">Custo por unidade</TH>
                      <TH className="text-right">Usado em</TH>
                      <TH>Atualizado</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {data.supplies.map((s: any) => (
                      <TR key={s.id}>
                        <TD>
                          <p className="font-medium">{s.name}</p>
                          {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                        </TD>
                        <TD className="text-right tabular-nums">{brl(s.packageCostCents)}</TD>
                        <TD className="text-right tabular-nums">
                          {String(s.packageQty).replace('.', ',')} {s.unit}
                        </TD>
                        <TD className="text-right font-medium tabular-nums">
                          {brl(Math.round(s.unitCostCents))}/{s.unit}
                        </TD>
                        <TD className="text-right tabular-nums">{s.usedIn ? `${s.usedIn} ficha(s)` : '—'}</TD>
                        <TD className="text-sm">{new Date(s.updatedAt).toLocaleDateString('pt-BR')}</TD>
                        <TD className="whitespace-nowrap text-right">
                          {canEdit && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Editar"
                                onClick={() => {
                                  setSupply(s);
                                  setSupplyOpen(true);
                                }}
                              >
                                <Pencil />
                              </Button>
                              <ConfirmButton
                                variant="ghost"
                                size="sm"
                                confirmLabel="Excluir?"
                                disabled={del.busy}
                                onConfirm={async () => {
                                  if (await del.run(() => api(`/pricing/supplies/${s.id}`, { method: 'DELETE' }))) reload();
                                }}
                              >
                                <Trash2 />
                              </ConfirmButton>
                            </>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              <ErrorText>{del.error}</ErrorText>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <SettingsForm key={JSON.stringify(data.settings)} data={data} canEdit={canEdit} onSaved={reload} />
        </TabsContent>
      </Tabs>

      <SupplyDialog open={supplyOpen} onOpenChange={setSupplyOpen} supply={supply} onSaved={reload} />
      <SheetEditor
        open={!!editing && canEdit}
        onOpenChange={(v) => !v && setEditing(null)}
        row={editing}
        supplies={data.supplies}
        settings={data.settings}
        costPerMinuteCents={data.costPerMinuteCents}
        canApply={canApply}
        onSaved={reload}
      />
    </div>
  );
}
