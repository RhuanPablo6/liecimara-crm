'use client';

import { FilePlus2, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { QuoteEditor } from '@/components/quotes/quote-editor';
import { QuoteStatusBadge, quoteNumber } from '@/components/quotes/quote-document';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorText, Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useApi } from '@/lib/api';
import { brl, date, num, phone } from '@/lib/format';
import { cn } from '@/lib/utils';

const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'OPEN', label: 'Em aberto' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'REJECTED', label: 'Recusados' },
  { value: 'EXPIRED', label: 'Vencidos' },
];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

export default function QuotesPage() {
  const router = useRouter();
  const { data, error } = useApi<{ items: any[] }>('/quotes');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const all = data?.items ?? [];

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return all.filter(
      (r) =>
        (!status || r.effectiveStatus === status) &&
        (!term ||
          (r.patientName ?? '').toLowerCase().includes(term) ||
          r.summary.toLowerCase().includes(term) ||
          (digits.length >= 3 && ((r.waId ?? '').includes(digits) || String(r.number).includes(digits)))),
    );
  }, [all, status, q]);

  const openOnes = all.filter((r) => r.effectiveStatus === 'OPEN');
  const decided = all.filter((r) => r.status === 'APPROVED' || r.status === 'REJECTED');
  const approved = all.filter((r) => r.status === 'APPROVED');
  const rate = decided.length ? Math.round((approved.length / decided.length) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Orçamentos</h1>
          <p className="text-sm text-muted-foreground">Monte na consulta, mostre ou envie para a paciente. Tudo fica no perfil dela.</p>
        </div>
        <Button variant="gold" onClick={() => setOpen(true)}>
          <FilePlus2 /> Novo orçamento
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Em aberto" value={brl(openOnes.reduce((s, r) => s + r.totalCents, 0))} hint={`${num(openOnes.length)} orçamento(s) aguardando resposta`} />
        <Kpi label="Aprovados" value={brl(approved.reduce((s, r) => s + r.totalCents, 0))} hint={`${num(approved.length)} orçamento(s)`} />
        <Kpi label="Taxa de aprovação" value={rate == null ? '—' : `${rate}%`} hint="Aprovados ÷ (aprovados + recusados)" />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatus(f.value)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm',
                    status === f.value ? 'bg-navy-800 text-white' : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {f.label}
                  {f.value && <span className="ml-1 opacity-70">{all.filter((r) => r.effectiveStatus === f.value).length}</span>}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paciente, tratamento ou nº" />
            </div>
          </div>

          {error && <ErrorText>{error}</ErrorText>}
          {!data && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {data && rows.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {all.length ? 'Nenhum orçamento com esse filtro.' : 'Nenhum orçamento ainda. Clique em “Novo orçamento” durante a consulta.'}
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>Nº</TH>
                  <TH>Paciente</TH>
                  <TH>Tratamentos</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Criado</TH>
                  <TH>Validade</TH>
                  <TH>Situação</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => router.push(`/orcamentos/${r.id}`)}>
                    <TD className="font-mono text-xs">
                      <Link href={`/orcamentos/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-navy-600 hover:underline">
                        {quoteNumber(r.number)}
                      </Link>
                    </TD>
                    <TD>
                      <p className="font-medium">{r.patientName ?? 'Sem nome'}</p>
                      <p className="text-xs text-muted-foreground">{phone(r.waId)}</p>
                    </TD>
                    <TD className="max-w-xs truncate text-sm" title={r.summary}>
                      {r.summary}
                    </TD>
                    <TD className="text-right font-medium tabular-nums">{brl(r.totalCents)}</TD>
                    <TD className="text-sm">{date(r.createdAt)}</TD>
                    <TD className="text-sm">{date(r.validUntil)}</TD>
                    <TD>
                      <QuoteStatusBadge status={r.effectiveStatus} />
                      {r.converted && <span className="ml-1 text-xs text-muted-foreground">· venda lançada</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <QuoteEditor open={open} onOpenChange={setOpen} onSaved={(saved) => router.push(`/orcamentos/${saved.id}`)} />
    </div>
  );
}

