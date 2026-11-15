'use client';

import { Download, Medal } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PatientTagBadge } from '@/components/patient-tag';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorText, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useApi } from '@/lib/api';
import { brl, date, num, phone } from '@/lib/format';
import { ORIGIN_LABEL } from '@/lib/origins';
import { cn } from '@/lib/utils';

const SORTS: [string, string][] = [
  ['spent', 'Quem mais gastou'],
  ['purchases', 'Mais compras'],
  ['attended', 'Mais compareceu'],
  ['attendance', 'Melhor comparecimento (%)'],
  ['noShow', 'Mais faltas'],
  ['ticket', 'Maior ticket médio'],
  ['balance', 'Maior saldo a receber'],
  ['recent', 'Mais recentes'],
];

type Period = 'all' | 'year' | '12m' | 'month' | 'custom';

const todaySP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

function periodRange(p: Period, custom: { from: string; to: string }) {
  const t = todaySP();
  if (p === 'year') return { from: `${t.slice(0, 4)}-01-01`, to: t };
  if (p === '12m') return { from: addDays(t, -364), to: t };
  if (p === 'month') return { from: `${t.slice(0, 7)}-01`, to: t };
  if (p === 'custom') return custom;
  return null;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-800">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function downloadCsv(rows: any[]) {
  const money = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Posição', 'Paciente', 'WhatsApp', 'Etiqueta', 'Origem', 'Detalhe da origem', 'Compras', 'Total gasto', 'Ticket médio', 'Saldo a receber', 'Agendamentos', 'Compareceu', 'Faltas', 'Comparecimento %', 'Última compra', 'Última visita', 'Procedimentos'];
  const lines = rows.map((r) => [
    r.rank,
    r.name ?? '',
    r.waId ?? '',
    r.tag === 'WALLET' ? 'Da carteira' : 'Paciente novo',
    r.originLabel,
    r.originNote ?? r.originAd ?? '',
    r.purchases,
    money(r.spentCents),
    money(r.avgTicketCents),
    money(r.balanceCents),
    r.appointments,
    r.attended,
    r.noShow,
    r.attendancePct ?? '',
    r.lastPurchaseAt ? date(r.lastPurchaseAt) : '',
    r.lastVisitAt ? date(r.lastVisitAt) : '',
    r.procedures.map((p: any) => `${p.name} (${p.count})`).join(', '),
  ]);
  const csv = '﻿' + [head, ...lines].map((l) => l.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `pacientes_${todaySP()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PatientsPage() {
  const [sort, setSort] = useState('spent');
  const [period, setPeriod] = useState<Period>('all');
  const [custom, setCustom] = useState({ from: `${todaySP().slice(0, 4)}-01-01`, to: todaySP() });
  const [origin, setOrigin] = useState('');
  const [tag, setTag] = useState('');
  const [procedureId, setProcedureId] = useState('');
  const [onlyClients, setOnlyClients] = useState(false);
  const [q, setQ] = useState('');
  const { data: procedures } = useApi<any[]>('/procedures');

  const range = periodRange(period, custom);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ sort, limit: '500' });
    if (range) (p.set('from', range.from), p.set('to', range.to));
    if (origin) p.set('origin', origin);
    if (tag) p.set('tag', tag);
    if (procedureId) p.set('procedureId', procedureId);
    if (onlyClients) p.set('onlyClients', 'true');
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [sort, range?.from, range?.to, origin, tag, procedureId, onlyClients, q]);
  const { data, error } = useApi<any>(`/patients?${qs}`);
  const s = data?.summary;
  const maxOrigin = Math.max(1, ...(s?.byOrigin ?? []).map((o: any) => o.patients));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Pacientes</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Histórico de cada paciente (compras, comparecimento, origem) e ranking para entender quem são as melhores pacientes da clínica.
          </p>
        </div>
        <Button variant="outline" disabled={!data?.rows.length} onClick={() => downloadCsv(data.rows)}>
          <Download /> Exportar (Excel/CSV)
        </Button>
      </div>

      {s && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Pacientes" value={num(s.patients)} hint={`${num(s.newPatients)} novos · ${num(s.walletPatients)} da carteira`} />
          <Stat label="Já compraram" value={num(s.clients)} hint={s.patients ? `${Math.round((s.clients / s.patients) * 100)}% dos pacientes` : undefined} />
          <Stat label={period === 'all' ? 'Total gasto' : 'Gasto no período'} value={brl(s.spentCents)} hint={s.avgPerClientCents ? `${brl(s.avgPerClientCents)} por paciente que comprou` : undefined} />
          <Stat label="Saldo a receber" value={brl(s.balanceCents)} hint="O que pacientes ainda devem" />
        </div>
      )}

      {s && s.byOrigin.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>De onde vêm os pacientes</CardTitle>
            <CardDescription>Quantos pacientes, quantos compraram e quanto gastaram, por origem.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.byOrigin.map((o: any) => (
              <button
                key={o.type}
                className={cn('block w-full space-y-1 rounded-md px-1 text-left hover:bg-secondary/60', origin === o.type && 'bg-secondary')}
                onClick={() => setOrigin(origin === o.type ? '' : o.type)}
                title="Filtrar por esta origem"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{o.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {num(o.patients)} paciente(s) · {num(o.clients)} compraram · <b className="text-foreground">{brl(o.spentCents)}</b>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary">
                  <div className="h-2 rounded-full bg-navy-600" style={{ width: `${(o.patients / maxOrigin) * 100}%` }} />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Medal className="h-4 w-4 text-gold-500" /> Ranking
          </CardTitle>
          <CardDescription>{data ? `${num(data.total)} paciente(s) no filtro` : 'Carregando…'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Ordenar" className="w-56" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Período" className="w-44" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="all">Todo o histórico</option>
              <option value="month">Este mês</option>
              <option value="year">Este ano</option>
              <option value="12m">Últimos 12 meses</option>
              <option value="custom">Personalizado…</option>
            </NativeSelect>
            {period === 'custom' && (
              <>
                <Input type="date" aria-label="De" className="w-40" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                <Input type="date" aria-label="Até" className="w-40" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </>
            )}
            <NativeSelect aria-label="Origem" className="w-48" value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">Todas as origens</option>
              {Object.entries(ORIGIN_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Etiqueta" className="w-44" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">Novos e carteira</option>
              <option value="NEW">Pacientes novos</option>
              <option value="WALLET">Da carteira</option>
            </NativeSelect>
            <NativeSelect aria-label="Procedimento" className="w-52" value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
              <option value="">Qualquer procedimento</option>
              {procedures?.map((p) => (
                <option key={p.id} value={p.id}>
                  Comprou {p.name}
                </option>
              ))}
            </NativeSelect>
            <Input className="w-56" placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-4 accent-navy-700" checked={onlyClients} onChange={(e) => setOnlyClients(e.target.checked)} />
              Só quem comprou
            </label>
          </div>
          <ErrorText>{error}</ErrorText>

          {data && data.rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum paciente neste filtro.</p>}
          {data && data.rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-10">#</TH>
                    <TH>Paciente</TH>
                    <TH>Origem</TH>
                    <TH className="text-right">Compras</TH>
                    <TH className="text-right">Gasto</TH>
                    <TH className="text-right">Ticket médio</TH>
                    <TH className="text-right">Compareceu</TH>
                    <TH className="text-right">Faltas</TH>
                    <TH>Última compra</TH>
                    <TH className="text-right">A receber</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.rows.map((r: any) => (
                    <TR key={r.contactId}>
                      <TD className="tabular-nums text-muted-foreground">{r.rank}</TD>
                      <TD>
                        <Link href={`/pacientes/${r.contactId}`} className="block">
                          <p className="font-medium text-navy-800 hover:underline">
                            {r.name ?? phone(r.waId)}
                            <PatientTagBadge tag={r.tag} />
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {phone(r.waId)}
                            {r.procedures.length > 0 && ` · ${r.procedures.slice(0, 3).map((p: any) => p.name).join(', ')}`}
                          </p>
                        </Link>
                      </TD>
                      <TD className="text-sm">
                        {r.originLabel}
                        {(r.originNote || r.originAd) && <p className="max-w-[200px] truncate text-xs text-muted-foreground">{r.originNote ?? r.originAd}</p>}
                      </TD>
                      <TD className="text-right tabular-nums">{num(r.purchases)}</TD>
                      <TD className="text-right font-medium tabular-nums">{brl(r.spentCents)}</TD>
                      <TD className="text-right tabular-nums">{r.avgTicketCents == null ? '—' : brl(r.avgTicketCents)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">
                        {num(r.attended)}
                        {r.attendancePct != null && <span className="ml-1 text-xs text-muted-foreground">({r.attendancePct.toLocaleString('pt-BR')}%)</span>}
                      </TD>
                      <TD className={cn('text-right tabular-nums', r.noShow > 0 && 'text-red-700')}>{num(r.noShow)}</TD>
                      <TD className="whitespace-nowrap text-sm">{r.lastPurchaseAt ? date(r.lastPurchaseAt) : '—'}</TD>
                      <TD className={cn('text-right tabular-nums', r.balanceCents > 0 && 'text-amber-700')}>{r.balanceCents ? brl(r.balanceCents) : '—'}</TD>
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
