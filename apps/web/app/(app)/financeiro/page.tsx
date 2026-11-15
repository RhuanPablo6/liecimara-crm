'use client';

import { Download, Table2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { NewSaleDialog, SalesCard } from '@/components/finance-sales';
import { ProceduresDialog } from '@/components/procedures-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useApi } from '@/lib/api';
import { brl, num } from '@/lib/format';
import { cn } from '@/lib/utils';

type Granularity = 'day' | 'week' | 'month';
type Preset = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | '7d' | '30d' | '90d' | 'thisYear' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'thisWeek', label: 'Esta semana' },
  { value: 'lastWeek', label: 'Semana passada' },
  { value: 'thisMonth', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês passado' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'thisYear', label: 'Este ano' },
  { value: 'custom', label: 'Personalizado…' },
];

// Paleta categórica validada (claro): faturamento, custos, resultado.
const C_REVENUE = '#2a78d6';
const C_COSTS = '#eb6834';
const C_PROFIT = '#1baf7a';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const monday = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => addDays(monthStart(addDays(monthStart(d), 32)), -1);

function presetDates(p: Preset): { from: string; to: string } {
  const t = today();
  switch (p) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday':
      return { from: addDays(t, -1), to: addDays(t, -1) };
    case 'thisWeek':
      return { from: monday(t), to: t };
    case 'lastWeek':
      return { from: addDays(monday(t), -7), to: addDays(monday(t), -1) };
    case 'lastMonth': {
      const prev = addDays(monthStart(t), -1);
      return { from: monthStart(prev), to: monthEnd(prev) };
    }
    case '7d':
      return { from: addDays(t, -6), to: t };
    case '30d':
      return { from: addDays(t, -29), to: t };
    case '90d':
      return { from: addDays(t, -89), to: t };
    case 'thisYear':
      return { from: `${t.slice(0, 4)}-01-01`, to: t };
    default:
      return { from: monthStart(t), to: t };
  }
}

const span = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
const autoGranularity = (from: string, to: string): Granularity => (span(from, to) <= 45 ? 'day' : span(from, to) <= 200 ? 'week' : 'month');
const fmtDay = (d: string) => d.split('-').reverse().join('/');
const pctText = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const roasText = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`);
const brlShort = (cents: number) => {
  const v = cents / 100;
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1000) return `${sign}${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${sign}${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-navy-800')}>
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {[
        ['Faturamento', p.revenueCents, C_REVENUE],
        ['Insumos', p.suppliesCents, null],
        ['Anúncios', p.adSpendCents, null],
        ['Despesas', p.expensesCents, null],
        ['Custos totais', p.costsCents, C_COSTS],
        ['Resultado', p.profitCents, C_PROFIT],
      ].map(([name, v, color]) => (
        <div key={name as string} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {color ? <span className="inline-block size-2 rounded-sm" style={{ background: color as string }} /> : <span className="inline-block size-2" />}
            {name}
          </span>
          <span className="tabular-nums text-foreground">{brl(v as number)}</span>
        </div>
      ))}
    </div>
  );
}

/** CSV para Excel em português (ponto e vírgula, vírgula decimal, BOM). */
function downloadCsv(report: any, procedures: boolean) {
  const money = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: unknown[][] = [];
  rows.push([`Relatório financeiro ${fmtDay(report.from)} a ${fmtDay(report.to)}`]);
  rows.push([]);
  rows.push(['DRE simplificado', 'R$']);
  rows.push(['Faturamento (vendas)', money(report.totals.revenueCents)]);
  rows.push(['(-) Insumos', money(report.totals.suppliesCents)]);
  rows.push(['(-) Anúncios (Meta)', money(report.totals.adSpendCents)]);
  for (const c of report.expensesByCategory) rows.push([`(-) ${c.category}`, money(c.amountCents)]);
  rows.push(['= Resultado', money(report.totals.profitCents)]);
  rows.push(['Margem %', report.totals.marginPct ?? '']);
  rows.push(['Recebido no período', money(report.totals.receivedCents)]);
  if (procedures) {
    rows.push([]);
    rows.push(['Procedimento', 'Agendamentos', 'Vendas', 'Faturamento', 'Ticket médio', 'Insumos', 'Anúncios', 'Margem de contribuição', 'Margem %', 'ROAS']);
    for (const p of report.byProcedure)
      rows.push([
        p.name,
        p.appointments,
        p.salesCount,
        money(p.revenueCents),
        p.avgTicketCents == null ? '' : money(p.avgTicketCents),
        money(p.suppliesCents),
        money(p.adSpendCents),
        money(p.contributionCents),
        p.marginPct ?? '',
        p.roas ?? '',
      ]);
  }
  rows.push([]);
  rows.push(['Período', 'Faturamento', 'Insumos', 'Anúncios', 'Despesas', 'Resultado']);
  for (const s of report.series)
    rows.push([s.label, money(s.revenueCents), money(s.suppliesCents), money(s.adSpendCents), money(s.expensesCents), money(s.profitCents)]);
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `financeiro_${report.from}_a_${report.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FinancePage() {
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState(() => presetDates('thisMonth'));
  const [granularity, setGranularity] = useState<Granularity | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [procVersion, setProcVersion] = useState(0);
  const bump = () => setProcVersion((v) => v + 1);

  const { from, to } = preset === 'custom' ? custom : presetDates(preset);
  const g = granularity ?? autoGranularity(from, to);
  const valid = !!from && !!to && from <= to;
  const { data: r, error } = useApi<any>(valid ? `/finance/report?from=${from}&to=${to}&granularity=${g}&v=${procVersion}` : null);
  const { data: procedures } = useApi<any[]>(`/procedures?v=${procVersion}`);

  const series = useMemo(
    () => (r?.series ?? []).map((s: any) => ({ ...s, costsCents: s.suppliesCents + s.adSpendCents + s.expensesCents })),
    [r],
  );
  const t = r?.totals;
  const none = r?.byProcedure.find((p: any) => p.procedureId === '__none__');
  const [showEmpty, setShowEmpty] = useState(false);
  const isEmpty = (p: any) => !p.revenueCents && !p.suppliesCents && !p.adSpendCents && !p.appointments;
  const allProcs = (r?.byProcedure ?? []).filter((p: any) => p.procedureId !== '__none__');
  const procs = showEmpty ? allProcs : allProcs.filter((p: any) => !isEmpty(p));
  const hiddenCount = allProcs.length - procs.length;
  const maxCategory = Math.max(1, ...(r?.expensesByCategory ?? []).map((c: any) => c.amountCents));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Financeiro</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Faturamento, insumos, anúncios e despesas da clínica, no total e por procedimento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ProceduresDialog onChanged={bump} />
          <Button variant="outline" disabled={!r} onClick={() => downloadCsv(r, true)}>
            <Download /> Exportar (Excel/CSV)
          </Button>
          <NewSaleDialog onSaved={bump} />
        </div>
      </div>

      {/* Filtros: uma linha, acima de tudo */}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="Período"
          className="w-52"
          value={preset}
          onChange={(e) => {
            const p = e.target.value as Preset;
            if (p === 'custom') setCustom({ from, to });
            setPreset(p);
            setGranularity(null);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
        {preset === 'custom' ? (
          <>
            <Input type="date" aria-label="De" className="w-40" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-sm text-muted-foreground">até</span>
            <Input type="date" aria-label="Até" className="w-40" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            {fmtDay(from)}
            {from !== to && ` a ${fmtDay(to)}`}
          </span>
        )}
        <div className="ml-auto inline-flex rounded-lg bg-secondary p-1" role="group" aria-label="Agrupar por">
          {(
            [
              ['day', 'Dia'],
              ['week', 'Semana'],
              ['month', 'Mês'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setGranularity(v)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                g === v ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground hover:text-navy-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!valid && <ErrorText>A data final precisa ser igual ou depois da inicial.</ErrorText>}
      <ErrorText>{error}</ErrorText>

      {procedures && procedures.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Para ver o financeiro por procedimento, cadastre os procedimentos (toxina, preenchimento, bioestimulador…) no botão <b>Procedimentos</b>{' '}
          acima. Depois ligue cada anúncio a um procedimento em <Link className="underline" href="/anuncios">Anúncios</Link> e escolha o procedimento
          dos materiais em <Link className="underline" href="/compras">Compras</Link>.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Faturamento" value={brl(t?.revenueCents ?? 0)} hint={t ? `${num(t.salesCount)} vendas · ${num(t.appointments)} agendamentos` : undefined} />
        <Kpi label="Recebido" value={brl(t?.receivedCents ?? 0)} hint="Pagamentos lançados nas vendas" />
        <Kpi
          label={t && t.profitCents < 0 ? 'Prejuízo' : 'Resultado'}
          value={brl(t?.profitCents ?? 0)}
          hint={t ? `Margem ${pctText(t.marginPct)}` : undefined}
          tone={t ? (t.profitCents >= 0 ? 'good' : 'bad') : undefined}
        />
        <Kpi label="Insumos" value={brl(t?.suppliesCents ?? 0)} hint={t?.revenueCents ? `${pctText((t.suppliesCents / t.revenueCents) * 100)} do faturamento` : undefined} />
        <Kpi label="Anúncios (Meta)" value={brl(t?.adSpendCents ?? 0)} hint={t ? `ROAS ${roasText(t.roas)}` : undefined} />
        <Kpi
          label="Despesas"
          value={brl(t?.expensesCents ?? 0)}
          hint={t?.expensesPendingCents ? `${brl(t.expensesPendingCents)} a pagar` : t ? 'Tudo pago' : undefined}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Faturamento × custos</CardTitle>
            <CardDescription>
              Custos = insumos + anúncios + despesas. Agrupado por {g === 'day' ? 'dia' : g === 'week' ? 'semana' : 'mês'}.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)}>
            <Table2 /> {showTable ? 'Ver gráfico' : 'Ver tabela'}
          </Button>
        </CardHeader>
        <CardContent>
          {!r && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {r && !showTable && (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="#e7e5df" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d6d3cc' }} tick={{ fontSize: 12, fill: '#52514e' }} minTickGap={12} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#52514e' }} tickFormatter={brlShort} width={64} label={{ value: 'R$', position: 'insideTopLeft', offset: 0, dy: -8, fontSize: 11, fill: '#52514e' }} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }} />
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: '#52514e' }}>{v}</span>} />
                  <Bar name="Faturamento" dataKey="revenueCents" fill={C_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar name="Custos totais" dataKey="costsCents" fill={C_COSTS} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Line name="Resultado" dataKey="profitCents" stroke={C_PROFIT} strokeWidth={2} dot={series.length <= 31 ? { r: 4, strokeWidth: 2, stroke: '#fcfcfb' } : false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {r && showTable && (
            <div className="max-h-96 overflow-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Período</TH>
                    <TH className="text-right">Faturamento</TH>
                    <TH className="text-right">Insumos</TH>
                    <TH className="text-right">Anúncios</TH>
                    <TH className="text-right">Despesas</TH>
                    <TH className="text-right">Resultado</TH>
                  </TR>
                </THead>
                <TBody>
                  {series.map((s: any) => (
                    <TR key={s.key}>
                      <TD>{s.label}</TD>
                      <TD className="text-right tabular-nums">{brl(s.revenueCents)}</TD>
                      <TD className="text-right tabular-nums">{brl(s.suppliesCents)}</TD>
                      <TD className="text-right tabular-nums">{brl(s.adSpendCents)}</TD>
                      <TD className="text-right tabular-nums">{brl(s.expensesCents)}</TD>
                      <TD className={cn('text-right font-medium tabular-nums', s.profitCents < 0 && 'text-red-700')}>{brl(s.profitCents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Por procedimento</CardTitle>
          <CardDescription>
            Margem de contribuição = faturamento − insumos − anúncios do procedimento (antes das despesas fixas). Valores de venda são os digitados em
            cada venda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {r && r.byProcedure.length === 0 && <p className="text-sm text-muted-foreground">Nenhum movimento por procedimento neste período.</p>}
          {r && r.byProcedure.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Procedimento</TH>
                    <TH className="text-right">Agend.</TH>
                    <TH className="text-right">Vendas</TH>
                    <TH className="text-right">Faturamento</TH>
                    <TH className="text-right">Ticket médio</TH>
                    <TH className="text-right">Insumos</TH>
                    <TH className="text-right">Anúncios</TH>
                    <TH className="text-right">Margem contrib.</TH>
                    <TH className="text-right">Margem</TH>
                    <TH className="text-right">ROAS</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...procs, ...(none ? [none] : [])].map((p: any) => (
                    <TR key={p.procedureId} className={p.procedureId === '__none__' ? 'text-muted-foreground' : undefined}>
                      <TD className="font-medium">{p.name}</TD>
                      <TD className="text-right tabular-nums">{num(p.appointments)}</TD>
                      <TD className="text-right tabular-nums">{num(p.salesCount)}</TD>
                      <TD className="text-right tabular-nums">{brl(p.revenueCents)}</TD>
                      <TD className="text-right tabular-nums">{p.avgTicketCents == null ? '—' : brl(p.avgTicketCents)}</TD>
                      <TD className="text-right tabular-nums">{brl(p.suppliesCents)}</TD>
                      <TD className="text-right tabular-nums">{brl(p.adSpendCents)}</TD>
                      <TD className={cn('text-right font-medium tabular-nums', p.contributionCents < 0 && 'text-red-700')}>{brl(p.contributionCents)}</TD>
                      <TD className="text-right tabular-nums">{pctText(p.marginPct)}</TD>
                      <TD className="text-right tabular-nums">{roasText(p.roas)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
          {(hiddenCount > 0 || showEmpty) && (
            <button className="mt-2 text-xs text-navy-600 underline" onClick={() => setShowEmpty((v) => !v)}>
              {showEmpty ? 'Ocultar procedimentos sem movimento' : `Mostrar ${hiddenCount} procedimento(s) sem movimento no período`}
            </button>
          )}
          {none && (none.adSpendCents > 0 || none.suppliesCents > 0) && (
            <p className="mt-3 text-xs text-muted-foreground">
              {none.adSpendCents > 0 && (
                <>
                  {brl(none.adSpendCents)} em anúncios sem procedimento: defina em <Link className="underline" href="/anuncios">Anúncios</Link>.{' '}
                </>
              )}
              {none.suppliesCents > 0 && (
                <>
                  {brl(none.suppliesCents)} em insumos de uso geral ou sem valor por item em <Link className="underline" href="/compras">Compras</Link>.
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {valid && <SalesCard from={from} to={to} version={procVersion} onChanged={bump} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>DRE simplificado</CardTitle>
            <CardDescription>
              {r ? `${fmtDay(r.from)} a ${fmtDay(r.to)}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {t && (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between font-medium">
                  <dt>Faturamento (vendas)</dt>
                  <dd className="tabular-nums">{brl(t.revenueCents)}</dd>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <dt>(−) Insumos</dt>
                  <dd className="tabular-nums">{brl(t.suppliesCents)}</dd>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <dt>(−) Anúncios (Meta)</dt>
                  <dd className="tabular-nums">{brl(t.adSpendCents)}</dd>
                </div>
                <div className="flex justify-between border-t pt-1.5 font-medium">
                  <dt>= Margem de contribuição</dt>
                  <dd className="tabular-nums">{brl(t.revenueCents - t.suppliesCents - t.adSpendCents)}</dd>
                </div>
                {r.expensesByCategory.map((c: any) => (
                  <div key={c.category} className="flex justify-between text-muted-foreground">
                    <dt>(−) {c.category}</dt>
                    <dd className="tabular-nums">{brl(c.amountCents)}</dd>
                  </div>
                ))}
                <div className={cn('flex justify-between border-t pt-1.5 text-base font-semibold', t.profitCents < 0 ? 'text-red-700' : 'text-emerald-700')}>
                  <dt>= {t.profitCents < 0 ? 'Prejuízo' : 'Resultado'}</dt>
                  <dd className="tabular-nums">{brl(t.profitCents)}</dd>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <dt>Margem líquida</dt>
                  <dd>{pctText(t.marginPct)}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Despesas por categoria</CardTitle>
            <CardDescription>
              Lance em <Link className="underline" href="/despesas">Despesas</Link>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {r && r.expensesByCategory.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma despesa no período.</p>}
            {r?.expensesByCategory.map((c: any) => (
              <div key={c.category} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {c.category}
                    {c.pendingCents > 0 && <span className="ml-2 text-xs text-amber-700">{brl(c.pendingCents)} a pagar</span>}
                  </span>
                  <span className="font-medium tabular-nums">{brl(c.amountCents)}</span>
                </div>
                <div className="h-2 rounded-full bg-secondary">
                  <div className="h-2 rounded-full" style={{ width: `${(c.amountCents / maxCategory) * 100}%`, background: C_COSTS }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <details className="rounded-md border bg-background px-4 py-3 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Como os números são calculados</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Faturamento: vendas registradas nos leads, pela data da venda, com o valor digitado (promoções e pacotes incluídos). Vendas canceladas não contam.</li>
          <li>Recebido: pagamentos lançados nas vendas, pela data do pagamento.</li>
          <li>Insumos: compras pela data da compra (não pelo uso). Cada material vai para o procedimento escolhido; com um material só, o total vai para ele.</li>
          <li>Anúncios: gasto diário da Meta, no procedimento ligado a cada anúncio.</li>
          <li>Agendamentos: pela data marcada, sem os cancelados. Sem procedimento no agendamento, vale o procedimento de interesse do lead.</li>
          <li>Despesas: pela data de vencimento/pagamento, pagas ou a pagar.</li>
        </ul>
      </details>
    </div>
  );
}
