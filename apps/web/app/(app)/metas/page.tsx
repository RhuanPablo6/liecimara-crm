'use client';

import { ArrowDownRight, ArrowUpRight, CheckCircle2, Minus, Target } from 'lucide-react';
import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { brl, num, parseBRL } from '@/lib/format';
import { cn } from '@/lib/utils';

const C_REVENUE = '#2a78d6';
const C_PROFIT = '#1baf7a';
const C_GOAL = '#52514e';

const todaySP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
const fmtDay = (d: string) => d.split('-').reverse().join('/');
const pctText = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const centsToInput = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brlShort = (cents: number) => {
  const v = cents / 100;
  const a = Math.abs(v);
  return `${v < 0 ? '−' : ''}${a >= 1000 ? `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

/** Barra de progresso com marcador opcional de "onde deveria estar hoje". */
function Progress({ pct, marker, tone }: { pct: number; marker?: number | null; tone: 'good' | 'warn' | 'neutral' }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-3 rounded-full bg-secondary">
      <div
        className={cn('h-3 rounded-full', tone === 'good' ? 'bg-emerald-600' : tone === 'warn' ? 'bg-amber-500' : 'bg-navy-600')}
        style={{ width: `${w}%` }}
      />
      {marker != null && marker > 0 && marker < 100 && (
        <div className="absolute -top-1 h-5 w-0.5 bg-navy-900" style={{ left: `${marker}%` }} title="Onde deveria estar hoje" />
      )}
    </div>
  );
}

function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  if (value === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
        <Minus className="size-3.5" /> 0%
      </span>
    );
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium', good ? 'text-emerald-700' : 'text-red-700')}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {up ? '+' : ''}
      {pctText(value)}
    </span>
  );
}

function GoalsDialog({ month, open, onOpenChange, onSaved }: { month: string; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { data: goals } = useApi<any>(open ? `/finance/goals?m=${month}` : null);
  const { data: procedures } = useApi<any[]>(open ? '/procedures' : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Metas de {monthName(month).toLowerCase()}</DialogTitle>
        </DialogHeader>
        {(!goals || !procedures) && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {goals && procedures && <GoalsForm key={month} month={month} goals={goals} procedures={procedures} onDone={() => (onOpenChange(false), onSaved())} />}
      </DialogContent>
    </Dialog>
  );
}

function GoalsForm({ month, goals, procedures, onDone }: { month: string; goals: any; procedures: any[]; onDone: () => void }) {
  const current = goals.months[month] ?? goals.default ?? null;
  const [revenue, setRevenue] = useState(current?.revenueCents ? centsToInput(current.revenueCents) : '');
  const [procs, setProcs] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(current?.procedures ?? {}).map(([k, v]) => [k, centsToInput(v as number)])),
  );
  const [asDefault, setAsDefault] = useState(!goals.default || JSON.stringify(goals.default) === JSON.stringify(current));
  const { busy, error, run } = useAction();
  const procSum = Object.values(procs).reduce((t, v) => t + (parseBRL(v) ?? 0), 0);

  const save = (clear = false) =>
    run(async () => {
      await api('/finance/goals', {
        method: 'PUT',
        body: {
          month,
          revenueCents: clear ? null : parseBRL(revenue),
          procedures: clear
            ? {}
            : Object.fromEntries(Object.entries(procs).flatMap(([k, v]) => (parseBRL(v) ? [[k, parseBRL(v)]] : []))),
          applyAsDefault: asDefault,
        },
      });
      onDone();
    });

  return (
    <div className="space-y-4">
      <Field label="Meta de faturamento do mês (R$)">
        <Input inputMode="decimal" placeholder="ex.: 80.000,00" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
      </Field>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Metas por procedimento (opcional)</p>
        {procedures
          .filter((p) => p.active)
          .map((p) => (
            <div key={p.id} className="grid grid-cols-[1fr_10rem] items-center gap-2">
              <span className="text-sm">{p.name}</span>
              <Input
                aria-label={`Meta de ${p.name}`}
                inputMode="decimal"
                placeholder="R$"
                value={procs[p.id] ?? ''}
                onChange={(e) => setProcs((cur) => ({ ...cur, [p.id]: e.target.value }))}
              />
            </div>
          ))}
        {procSum > 0 && (
          <p className="text-xs text-muted-foreground">
            Soma dos procedimentos: {brl(procSum)}
            {parseBRL(revenue) ? ` (${pctText(Math.round((procSum / parseBRL(revenue)!) * 1000) / 10)} da meta do mês)` : ''}
            {procSum !== parseBRL(revenue) && (
              <button type="button" className="ml-2 text-navy-600 underline" onClick={() => setRevenue(centsToInput(procSum))}>
                usar como meta do mês
              </button>
            )}
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-navy-700" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />
        Usar também para os meses que ainda não têm meta
      </label>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button disabled={busy || (!parseBRL(revenue) && procSum === 0)} onClick={() => save()}>
          Salvar metas
        </Button>
        {current && (
          <Button variant="ghost" disabled={busy} onClick={() => save(true)}>
            Remover metas deste mês
          </Button>
        )}
      </div>
    </div>
  );
}

function HistoryTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">
        {label}
        {p.partial ? ' (em andamento)' : ''}
      </p>
      {[
        ['Faturamento', p.revenueCents, C_REVENUE],
        ['Meta', p.goalCents, C_GOAL],
        ['Custos', p.costsCents, null],
        ['Resultado', p.profitCents, C_PROFIT],
      ].map(([n, v, c]) => (
        <div key={n as string} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block size-2 rounded-sm" style={{ background: (c as string) ?? 'transparent' }} />
            {n}
          </span>
          <span className="tabular-nums">{v == null ? '—' : brl(v as number)}</span>
        </div>
      ))}
    </div>
  );
}

export default function GoalsPage() {
  const [month, setMonth] = useState(todaySP().slice(0, 7));
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const { data: o, error } = useApi<any>(`/finance/overview?month=${month}&v=${version}`);
  const t = o?.totals;
  const g = o?.goal;
  const be = o?.breakEven;

  const comparisonRows = o
    ? [
        { label: 'Faturamento', cur: brl(t.revenueCents), prev: brl(o.previous.revenueCents), dp: o.previous.revenueChangePct, ly: brl(o.lastYear.revenueCents), dl: o.lastYear.revenueChangePct },
        { label: 'Vendas', cur: num(t.salesCount), prev: num(o.previous.salesCount), dp: o.previous.salesChangePct, ly: num(o.lastYear.salesCount), dl: o.lastYear.salesChangePct },
        {
          label: 'Ticket médio',
          cur: t.avgTicketCents == null ? '—' : brl(t.avgTicketCents),
          prev: o.previous.avgTicketCents == null ? '—' : brl(o.previous.avgTicketCents),
          dp: t.avgTicketCents && o.previous.avgTicketCents ? Math.round(((t.avgTicketCents - o.previous.avgTicketCents) / o.previous.avgTicketCents) * 1000) / 10 : null,
          ly: o.lastYear.avgTicketCents == null ? '—' : brl(o.lastYear.avgTicketCents),
          dl: t.avgTicketCents && o.lastYear.avgTicketCents ? Math.round(((t.avgTicketCents - o.lastYear.avgTicketCents) / o.lastYear.avgTicketCents) * 1000) / 10 : null,
        },
        { label: 'Resultado', cur: brl(t.profitCents), prev: brl(o.previous.profitCents), dp: o.previous.profitChangePct, ly: brl(o.lastYear.profitCents), dl: o.lastYear.profitChangePct },
        { label: 'Margem', cur: pctText(t.marginPct), prev: pctText(o.previous.marginPct), dp: null, ly: pctText(o.lastYear.marginPct), dl: null },
      ]
    : [];
  const spanNote = o && o.state === 'current' ? ` (dia 1 a ${o.elapsedDays})` : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Metas</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Meta do mês, quanto falta para cobrir os custos (ponto de equilíbrio) e como o mês se compara com o anterior e com o ano passado.
          </p>
        </div>
        <Button variant="gold" onClick={() => setEditing(true)}>
          <Target /> Definir metas
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
          ‹
        </Button>
        <span className="w-44 text-center text-sm font-medium">{monthName(month)}</span>
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
          ›
        </Button>
        {o && (
          <span className="text-sm text-muted-foreground">
            {o.state === 'current' ? `Em andamento: dia ${o.elapsedDays} de ${o.daysInMonth}` : o.state === 'past' ? 'Mês encerrado' : 'Mês futuro'}
          </span>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {!o && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {o && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Meta do mês</CardTitle>
              <CardDescription>{g ? (g.source === 'default' ? 'Meta padrão (vale para os meses sem meta própria)' : 'Meta definida para este mês') : 'Sem meta definida'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {g ? (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-3xl font-semibold tabular-nums text-navy-800">{brl(t.revenueCents)}</p>
                    <p className="text-sm text-muted-foreground">de {brl(g.revenueCents)}</p>
                  </div>
                  <Progress
                    pct={g.achievedPct}
                    marker={o.state === 'current' ? g.expectedByNowPct : null}
                    tone={g.achievedPct >= 100 ? 'good' : o.state === 'current' && g.achievedPct < g.expectedByNowPct ? 'warn' : 'neutral'}
                  />
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-medium">{pctText(g.achievedPct)} atingido</span>
                    {o.state === 'current' && <span className="text-muted-foreground">Esperado até hoje: {pctText(g.expectedByNowPct)}</span>}
                  </div>
                  {g.achievedPct >= 100 ? (
                    <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      <CheckCircle2 className="size-4" /> Meta batida{g.achievedPct > 100 ? `: ${pctText(g.achievedPct - 100)} acima` : ''}.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      <li>
                        Faltam <b>{brl(g.missingCents)}</b>
                        {g.perDayNeededCents != null && (
                          <>
                            {' '}
                            · <b>{brl(g.perDayNeededCents)}</b> por dia até o fim do mês
                          </>
                        )}
                      </li>
                      {o.projectedRevenueCents != null && (
                        <li className="text-muted-foreground">
                          No ritmo atual o mês fecha em <b className="text-foreground">{brl(o.projectedRevenueCents)}</b> ({pctText(g.projectedPct)} da meta).
                        </li>
                      )}
                    </ul>
                  )}
                </>
              ) : (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Faturado no mês: <b className="text-foreground">{brl(t.revenueCents)}</b>{o.projectedRevenueCents != null && <> · no ritmo atual, fecha em <b className="text-foreground">{brl(o.projectedRevenueCents)}</b></>}.</p>
                  <p>Defina uma meta para acompanhar o progresso dia a dia.{be ? ` Referência: o ponto de equilíbrio é ${brl(be.revenueCents)}.` : ''}</p>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Target /> Definir meta
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ponto de equilíbrio</CardTitle>
              <CardDescription>Quanto faturar no mês para pagar todos os custos (lucro zero).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {be ? (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-3xl font-semibold tabular-nums text-navy-800">{brl(be.revenueCents)}</p>
                    {be.salesNeeded && <p className="text-sm text-muted-foreground">≈ {num(be.salesNeeded)} vendas no ticket médio</p>}
                  </div>
                  <Progress pct={be.achievedPct} tone={be.achievedPct >= 100 ? 'good' : 'neutral'} />
                  {be.reachedOn ? (
                    <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      <CheckCircle2 className="size-4" /> Custos cobertos em {fmtDay(be.reachedOn)}: daqui em diante, cada venda vira lucro.
                    </p>
                  ) : (
                    <p className="text-sm">
                      Faltam <b>{brl(be.missingCents)}</b> ({pctText(be.achievedPct)} atingido).
                    </p>
                  )}
                  <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Custos fixos{be.fixedEstimated ? ' (estimado)' : ''}</dt>
                      <dd className="font-medium tabular-nums">{brl(be.fixedCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Custos variáveis</dt>
                      <dd className="font-medium tabular-nums">{pctText(be.variablePct)} das vendas</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Sobra de cada R$ 100</dt>
                      <dd className="font-medium tabular-nums">{brl(Math.round(be.contributionPct * 100))}</dd>
                    </div>
                  </dl>
                  {be.fixedEstimated && (
                    <p className="text-xs text-muted-foreground">Ainda não há despesas lançadas neste mês: usamos a média dos 3 meses anteriores.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Para calcular, o CRM precisa de vendas e despesas lançadas (pelo menos nos últimos 3 meses). Lance as despesas fixas em Despesas.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {o && (
        <Card>
          <CardHeader>
            <CardTitle>Comparativos</CardTitle>
            <CardDescription>
              {o.state === 'current'
                ? `Comparação justa: os mesmos dias (1 a ${o.elapsedDays}) em cada mês.`
                : 'Mês inteiro contra mês inteiro.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH />
                  <TH className="text-right">{monthName(month)}{spanNote}</TH>
                  <TH className="text-right">{monthName(o.previous.month)}</TH>
                  <TH className="text-right">Variação</TH>
                  <TH className="text-right">{monthName(o.lastYear.month)}</TH>
                  <TH className="text-right">Variação</TH>
                </TR>
              </THead>
              <TBody>
                {comparisonRows.map((r) => (
                  <TR key={r.label}>
                    <TD className="font-medium">{r.label}</TD>
                    <TD className="text-right font-medium tabular-nums">{r.cur}</TD>
                    <TD className="text-right tabular-nums">{r.prev}</TD>
                    <TD className="text-right">
                      <Delta value={r.dp} />
                    </TD>
                    <TD className="text-right tabular-nums">{r.ly}</TD>
                    <TD className="text-right">
                      <Delta value={r.dl} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {o.state === 'current' && (
              <p className="mt-2 text-xs text-muted-foreground">
                {monthName(o.previous.month)} fechou com {brl(o.previous.fullMonthRevenueCents)} no mês inteiro.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {o && o.byProcedure.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por procedimento</CardTitle>
            <CardDescription>Faturamento do mês contra a meta de cada procedimento (quando definida).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {o.byProcedure.map((p: any) => (
              <div key={p.procedureId} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {p.name} <span className="font-normal text-muted-foreground">· {num(p.salesCount)} venda(s)</span>
                  </span>
                  <span className="tabular-nums">
                    {brl(p.revenueCents)}
                    {p.goalCents && <span className="text-muted-foreground"> de {brl(p.goalCents)}</span>}
                    {p.achievedPct != null && (
                      <Badge variant={p.achievedPct >= 100 ? 'success' : 'secondary'} className="ml-2">
                        {pctText(p.achievedPct)}
                      </Badge>
                    )}
                  </span>
                </div>
                {p.goalCents ? (
                  <Progress pct={p.achievedPct} marker={o.state === 'current' ? (o.elapsedDays / o.daysInMonth) * 100 : null} tone={p.achievedPct >= 100 ? 'good' : 'neutral'} />
                ) : null}
                {p.projectedCents != null && p.goalCents && p.achievedPct < 100 && (
                  <p className="text-xs text-muted-foreground">No ritmo atual: {brl(p.projectedCents)}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {o && (
        <Card>
          <CardHeader>
            <CardTitle>Últimos 12 meses</CardTitle>
            <CardDescription>Faturamento, meta e resultado de cada mês.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={o.history} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e7e5df" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d6d3cc' }} tick={{ fontSize: 12, fill: '#52514e' }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: '#52514e' }}
                    tickFormatter={brlShort}
                    width={64}
                    label={{ value: 'R$', position: 'insideTopLeft', offset: 0, dy: -12, fontSize: 11, fill: '#52514e' }}
                  />
                  <Tooltip content={<HistoryTooltip />} cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }} />
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: '#52514e' }}>{v}</span>} />
                  <Bar name="Faturamento" dataKey="revenueCents" fill={C_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Line name="Meta" dataKey="goalCents" stroke={C_GOAL} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 4, fill: C_GOAL, stroke: '#fcfcfb', strokeWidth: 2 }} connectNulls={false} />
                  <Line name="Resultado" dataKey="profitCents" stroke={C_PROFIT} strokeWidth={2} dot={{ r: 3, fill: C_PROFIT, strokeWidth: 2, stroke: '#fcfcfb' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <GoalsDialog month={month} open={editing} onOpenChange={setEditing} onSaved={() => setVersion((v) => v + 1)} />
    </div>
  );
}
