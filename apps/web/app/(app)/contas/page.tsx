'use client';

import { AlertTriangle, Check, Table2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CashBalanceDialog, FeesDialog } from '@/components/finance-settings';
import { ReceiveDialog } from '@/components/finance-sales';
import { MessageButton } from '@/components/message-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorText, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'pay' | 'receive' | 'flow';

const C_IN = '#2a78d6';
const C_OUT = '#eb6834';
const C_BALANCE = '#1baf7a';

const todaySP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const fmtDay = (d: string) => d.split('-').reverse().join('/');
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` };
};
const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const brlShort = (cents: number) => {
  const v = cents / 100;
  const a = Math.abs(v);
  return `${v < 0 ? '−' : ''}${a >= 1000 ? `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

const TYPE_LABEL: Record<string, string> = {
  EXPENSE: 'Despesa',
  PURCHASE: 'Insumos',
  RENTAL: 'Aluguel de aparelho',
  CARD: 'Repasse',
  SALE_BALANCE: 'Saldo do paciente',
};

function StatusBadge({ status, receivable }: { status: string; receivable?: boolean }) {
  if (status === 'PAID') return <Badge variant="success" className="whitespace-nowrap">{receivable ? 'Recebido' : 'Pago'}</Badge>;
  if (status === 'OVERDUE') return <Badge variant="danger" className="whitespace-nowrap">Vencido</Badge>;
  return <Badge variant="warning" className="whitespace-nowrap">{receivable ? 'A receber' : 'A pagar'}</Badge>;
}

function Summary({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'warn' | 'good' }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums',
            tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : 'text-navy-800',
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function PayablesTable({ items, showPaid, onChanged }: { items: any[]; showPaid: boolean; onChanged: () => Promise<void> }) {
  const act = useAction();
  const rows = items.filter((i) => showPaid || i.status !== 'PAID');
  const toggle = (i: any, paid: boolean) =>
    act.run(async () => {
      if (i.type === 'EXPENSE') await api(`/expenses/${i.refId}`, { method: 'PATCH', body: { paid } });
      else await api(`/purchases/${i.refId}/paid`, { method: 'POST', body: { paidInstallments: paid ? i.installment : i.installment - 1 } });
      await onChanged();
    });
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nada a pagar neste período.</p>;
  return (
    <div className="overflow-x-auto">
      <ErrorText>{act.error}</ErrorText>
      <Table>
        <THead>
          <TR>
            <TH>Vencimento</TH>
            <TH>Conta</TH>
            <TH>Forma</TH>
            <TH className="text-right">Valor</TH>
            <TH>Situação</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {rows.map((i) => (
            <TR key={i.key} className={i.status === 'PAID' ? 'text-muted-foreground' : undefined}>
              <TD className="whitespace-nowrap">{fmtDay(i.dueDay)}</TD>
              <TD>
                <p className="font-medium">
                  {i.description}
                  {i.installments > 1 && <span className="ml-1 font-normal text-muted-foreground">· parcela {i.installment}/{i.installments}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {TYPE_LABEL[i.type]}
                  {i.detail ? ` · ${i.detail}` : ''}
                </p>
              </TD>
              <TD className="text-sm">{i.method ?? '—'}</TD>
              <TD className="whitespace-nowrap text-right font-medium tabular-nums">{brl(i.amountCents)}</TD>
              <TD>
                <StatusBadge status={i.status} />
              </TD>
              <TD className="whitespace-nowrap text-right">
                {i.status === 'PAID' ? (
                  <Button size="sm" variant="ghost" disabled={act.busy} onClick={() => toggle(i, false)} title="Desfazer pagamento">
                    <Undo2 /> Desfazer
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={act.busy} onClick={() => toggle(i, true)}>
                    <Check /> Pago
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function DueEditor({ item, onChanged }: { item: any; onChanged: () => Promise<void> }) {
  const [value, setValue] = useState(item.dueDay);
  const act = useAction();
  return (
    <Input
      type="date"
      aria-label="Previsão de recebimento"
      className="h-8 w-40"
      value={value}
      disabled={act.busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() =>
        value &&
        value !== item.dueDay &&
        act.run(async () => {
          await api(`/sales/${item.refId}/due`, { method: 'PATCH', body: { dueAt: value } });
          await onChanged();
        })
      }
    />
  );
}

function ReceivablesTable({ items, showPaid, onChanged }: { items: any[]; showPaid: boolean; onChanged: () => Promise<void> }) {
  const [receiving, setReceiving] = useState<any>(null);
  const rows = items.filter((i) => showPaid || i.status !== 'PAID');
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nada a receber neste período.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>Previsão</TH>
            <TH>Paciente</TH>
            <TH>Origem</TH>
            <TH className="text-right">Bruto</TH>
            <TH className="text-right">Taxa</TH>
            <TH className="text-right">Líquido</TH>
            <TH>Situação</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {rows.map((i) => (
            <TR key={i.key} className={i.status === 'PAID' ? 'text-muted-foreground' : undefined}>
              <TD className="whitespace-nowrap">{i.type === 'SALE_BALANCE' && i.status !== 'PAID' ? <DueEditor item={i} onChanged={onChanged} /> : fmtDay(i.dueDay)}</TD>
              <TD>
                {i.leadId ? (
                  <Link className="font-medium hover:underline" href={`/leads/${i.leadId}`}>
                    {i.description}
                  </Link>
                ) : (
                  <span className="font-medium">{i.description}</span>
                )}
                {i.detail && <p className="text-xs text-muted-foreground">{i.detail}</p>}
              </TD>
              <TD className="whitespace-nowrap text-sm">
                {i.type === 'CARD' ? (
                  <>
                    {i.method}
                    {i.installments > 1 && <span className="text-muted-foreground"> · {i.installment}/{i.installments}</span>}
                  </>
                ) : (
                  TYPE_LABEL[i.type]
                )}
              </TD>
              <TD className="whitespace-nowrap text-right tabular-nums">{brl(i.grossCents ?? i.amountCents)}</TD>
              <TD className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{i.feeCents ? brl(i.feeCents) : '—'}</TD>
              <TD className="whitespace-nowrap text-right font-medium tabular-nums">{brl(i.amountCents)}</TD>
              <TD>
                <StatusBadge status={i.status} receivable />
              </TD>
              <TD className="whitespace-nowrap text-right">
                {i.type === 'SALE_BALANCE' && i.status !== 'PAID' && i.waId && (
                  <span className="mr-1 inline-block">
                    <MessageButton
                      waId={i.waId}
                      use="CHARGE"
                      label="Cobrar"
                      vars={{ nome: i.description, procedimento: i.procedureName, valor: brl(i.amountCents) }}
                    />
                  </span>
                )}
                {i.type === 'SALE_BALANCE' && i.status !== 'PAID' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReceiving({ id: i.refId, amountCents: i.amountCents, paidCents: 0, patientName: i.description, procedureName: i.detail })}
                  >
                    Receber
                  </Button>
                )}
                {i.type === 'CARD' && i.status !== 'PAID' && <span className="text-xs text-muted-foreground">Repasse automático</span>}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog open={!!receiving} onOpenChange={(v) => !v && setReceiving(null)}>
        {receiving && (
          <ReceiveDialog
            key={receiving.id}
            sale={receiving}
            onDone={async () => {
              setReceiving(null);
              await onChanged();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function FlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {[
        ['Entradas', p.inCents, C_IN],
        ['Saídas', p.outCents, C_OUT],
        ['Saldo no fim', p.balanceCents, C_BALANCE],
      ].map(([n, v, c]) => (
        <div key={n as string} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block size-2 rounded-sm" style={{ background: c as string }} />
            {n}
          </span>
          <span className="tabular-nums">{brl(v as number)}</span>
        </div>
      ))}
    </div>
  );
}

function CashFlow({ version }: { version: number }) {
  const [horizon, setHorizon] = useState('30');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [showTable, setShowTable] = useState(false);
  const today = todaySP();
  const to = addDays(today, Number(horizon) - 1);
  const g = Number(horizon) > 90 && granularity === 'day' ? 'week' : granularity;
  const { data: f, error, reload } = useApi<any>(`/finance/cashflow?to=${to}&granularity=${g}&v=${version}`);
  const rows = useMemo(
    () =>
      (f?.rows ?? []).map((r: any) => {
        const [, m, d] = r.key.split('-');
        const label = g === 'month' ? r.key.split('-').reverse().join('/') : g === 'week' ? `sem. ${d}/${m}` : `${d}/${m}`;
        return { ...r, label, outNeg: -r.outCents };
      }),
    [f, g],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-48" aria-label="Horizonte" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
          <option value="7">Próximos 7 dias</option>
          <option value="30">Próximos 30 dias</option>
          <option value="60">Próximos 60 dias</option>
          <option value="90">Próximos 90 dias</option>
          <option value="180">Próximos 6 meses</option>
          <option value="365">Próximos 12 meses</option>
        </NativeSelect>
        <div className="inline-flex rounded-lg bg-secondary p-1" role="group" aria-label="Agrupar por">
          {(
            [
              ['day', 'Dia'],
              ['week', 'Semana'],
              ['month', 'Mês'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              disabled={v === 'day' && Number(horizon) > 90}
              onClick={() => setGranularity(v)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:opacity-40',
                g === v ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground hover:text-navy-700',
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <CashBalanceDialog current={f?.opening ?? null} onSaved={reload} />
        </div>
      </div>
      <ErrorText>{error}</ErrorText>

      {f && !f.opening && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Informe o <b>saldo em conta</b> de hoje para a projeção partir do valor real. Sem ele, a projeção começa em R$ 0,00.
        </p>
      )}
      {f?.opening && f.opening.staleDays > 7 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          O saldo foi informado há {f.opening.staleDays} dias ({fmtDay(f.opening.asOf)}). Atualize para a projeção ficar precisa.
        </p>
      )}
      {f && f.lowest.balanceCents < 0 && (
        <p className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="size-4 shrink-0" />
          Atenção: o saldo previsto fica negativo em {g === 'day' ? fmtDay(f.lowest.key) : `período de ${fmtDay(f.lowest.key)}`} ({brl(f.lowest.balanceCents)}).
          Antecipe recebimentos ou renegocie vencimentos.
        </p>
      )}

      {f && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Summary label="Saldo hoje" value={brl(f.opening?.amountCents ?? 0)} hint={f.opening ? `Informado em ${fmtDay(f.opening.asOf)}` : 'Não informado'} />
          <Summary label="Entradas previstas" value={brl(f.totals.inCents)} hint="Repasses de cartão e saldos de pacientes" />
          <Summary label="Saídas previstas" value={brl(f.totals.outCents)} hint="Despesas e parcelas de compras/aluguéis" />
          <Summary
            label={`Saldo em ${fmtDay(f.to)}`}
            value={brl(f.totals.closingCents)}
            tone={f.totals.closingCents < 0 ? 'bad' : 'good'}
            hint={`Menor saldo: ${brl(f.lowest.balanceCents)}`}
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Fluxo de caixa projetado</CardTitle>
            <CardDescription>Contas vencidas e ainda em aberto entram no dia de hoje.</CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)}>
            <Table2 /> {showTable ? 'Ver gráfico' : 'Ver tabela'}
          </Button>
        </CardHeader>
        <CardContent>
          {f && !showTable && (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 16, right: 8, left: 8, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="#e7e5df" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d6d3cc' }} tick={{ fontSize: 12, fill: '#52514e' }} minTickGap={12} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: '#52514e' }}
                    tickFormatter={brlShort}
                    width={64}
                    label={{ value: 'R$', position: 'insideTopLeft', offset: 0, dy: -12, fontSize: 11, fill: '#52514e' }}
                  />
                  <ReferenceLine y={0} stroke="#a8a59c" />
                  <Tooltip content={<FlowTooltip />} cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }} />
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: '#52514e' }}>{v}</span>} />
                  <Bar name="Entradas" dataKey="inCents" fill={C_IN} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar name="Saídas" dataKey="outNeg" fill={C_OUT} radius={[0, 0, 4, 4]} maxBarSize={28} />
                  <Line name="Saldo" dataKey="balanceCents" stroke={C_BALANCE} strokeWidth={2} dot={rows.length <= 31 ? { r: 3, strokeWidth: 2, stroke: '#fcfcfb' } : false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {f && showTable && (
            <div className="max-h-96 overflow-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Período</TH>
                    <TH className="text-right">Entradas</TH>
                    <TH className="text-right">Saídas</TH>
                    <TH className="text-right">Saldo no fim</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r: any) => (
                    <TR key={r.key}>
                      <TD>{r.label}</TD>
                      <TD className="text-right tabular-nums">{brl(r.inCents)}</TD>
                      <TD className="text-right tabular-nums">{brl(r.outCents)}</TD>
                      <TD className={cn('text-right font-medium tabular-nums', r.balanceCents < 0 && 'text-red-700')}>{brl(r.balanceCents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AccountsPage() {
  const [tab, setTab] = useState<Tab>('pay');
  const [month, setMonth] = useState(todaySP().slice(0, 7));
  const [showPaid, setShowPaid] = useState(false);
  const [version, setVersion] = useState(0);
  const { from, to } = monthBounds(month);
  const { data, error, reload } = useApi<any>(`/finance/accounts?from=${from}&to=${to}&v=${version}`);
  const changed = async () => {
    await reload();
    setVersion((v) => v + 1);
  };
  const sp = data?.summary.payables;
  const sr = data?.summary.receivables;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Contas</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            O que a clínica tem a pagar e a receber, com vencimentos, taxas da maquininha e a projeção do caixa.
          </p>
        </div>
        <FeesDialog onSaved={changed} />
      </div>

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Summary
            label="A pagar vencido"
            value={brl(sp.overdueCents)}
            hint={sp.overdueCount ? `${sp.overdueCount} conta(s)` : 'Nada vencido'}
            tone={sp.overdueCents ? 'bad' : undefined}
          />
          <Summary label="A pagar em 7 dias" value={brl(sp.next7Cents)} tone={sp.next7Cents ? 'warn' : undefined} />
          <Summary
            label="A receber vencido"
            value={brl(sr.overdueCents)}
            hint={sr.overdueCount ? `${sr.overdueCount} paciente(s) com saldo` : 'Nada vencido'}
            tone={sr.overdueCents ? 'warn' : undefined}
          />
          <Summary label="A receber em 7 dias" value={brl(sr.next7Cents)} hint="Líquido das taxas" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-secondary p-1" role="tablist">
          {(
            [
              ['pay', 'A pagar'],
              ['receive', 'A receber'],
              ['flow', 'Fluxo de caixa'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                tab === k ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground hover:text-navy-700',
              )}
            >
              {l}
            </button>
          ))}
        </div>
        {tab !== 'flow' && (
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
                ‹
              </Button>
              <span className="w-40 text-center text-sm font-medium">{monthName(month)}</span>
              <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
                ›
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-4 accent-navy-700" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
              Mostrar {tab === 'pay' ? 'pagas' : 'recebidas'}
            </label>
          </>
        )}
      </div>
      <ErrorText>{error}</ErrorText>

      {tab === 'pay' && (
        <Card>
          <CardHeader>
            <CardTitle>A pagar</CardTitle>
            <CardDescription>
              {data
                ? `${brl(sp.periodPendingCents)} em aberto e ${brl(sp.periodDoneCents)} pago em ${monthName(month).toLowerCase()}. Vencidas de meses anteriores aparecem no topo.`
                : 'Carregando…'}{' '}
              Lance em <Link className="underline" href="/despesas">Despesas</Link> e <Link className="underline" href="/compras">Compras</Link>.
            </CardDescription>
          </CardHeader>
          <CardContent>{data && <PayablesTable items={data.payables} showPaid={showPaid} onChanged={changed} />}</CardContent>
        </Card>
      )}

      {tab === 'receive' && (
        <Card>
          <CardHeader>
            <CardTitle>A receber</CardTitle>
            <CardDescription>
              Repasses da maquininha (já sem a taxa) e saldos que os pacientes ainda devem. Clique na data do saldo para mudar a previsão.
            </CardDescription>
          </CardHeader>
          <CardContent>{data && <ReceivablesTable items={data.receivables} showPaid={showPaid} onChanged={changed} />}</CardContent>
        </Card>
      )}

      {tab === 'flow' && <CashFlow version={version} />}
    </div>
  );
}
