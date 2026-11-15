'use client';

import { ArrowLeft, CalendarCheck, CalendarX, CircleDollarSign, MessageCircle, ShoppingBag, Sparkles, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { PatientTagControl } from '@/components/patient-tag';
import { StageBadge } from '@/components/badges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/form';
import { useApi } from '@/lib/api';
import { brl, date, dateTime, num, phone } from '@/lib/format';
import { cn } from '@/lib/utils';

const APPT_STATUS: Record<string, { label: string; variant: any }> = {
  SCHEDULED: { label: 'Agendado', variant: 'secondary' },
  CONFIRMED: { label: 'Confirmado', variant: 'secondary' },
  ATTENDED: { label: 'Compareceu', variant: 'success' },
  NO_SHOW: { label: 'Faltou', variant: 'danger' },
  CANCELED: { label: 'Cancelado', variant: 'secondary' },
};

function EventIcon({ kind, status }: { kind: string; status?: string }) {
  const cls = 'size-4';
  if (kind === 'LEAD') return <UserPlus className={cls} />;
  if (kind === 'APPOINTMENT') return status === 'NO_SHOW' || status === 'CANCELED' ? <CalendarX className={cls} /> : <CalendarCheck className={cls} />;
  if (kind === 'SALE') return <ShoppingBag className={cls} />;
  if (kind === 'PAYMENT') return <CircleDollarSign className={cls} />;
  return <Sparkles className={cls} />;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'bad' }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-navy-800')}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useApi<any>(`/patients/${id}`);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const { contact, summary: s, leads, events } = data;

  return (
    <div className="space-y-6">
      <Link href="/pacientes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-navy-700">
        <ArrowLeft className="h-4 w-4" /> Pacientes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">{contact.name ?? 'Sem nome'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{phone(contact.waId)}</span>
            {contact.waId && (
              <a className="inline-flex items-center gap-1 text-navy-600 hover:underline" href={`https://wa.me/${contact.waId}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
            <span>Primeiro contato em {date(contact.firstSeenAt)}</span>
            {s && <PatientTagControl contactId={contact.id} tag={s.tag} manual={s.tagManual} onChanged={reload} />}
          </div>
          {s && (
            <p className="mt-2 text-sm">
              Origem: <b>{s.originLabel}</b>
              {(s.originNote || s.originAd) && <span className="text-muted-foreground"> · {s.originNote ?? s.originAd}</span>}
              {s.leadId && (
                <Link className="ml-2 text-navy-600 hover:underline" href={`/leads/${s.leadId}`}>
                  alterar no atendimento
                </Link>
              )}
            </p>
          )}
        </div>
      </div>

      {s && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total gasto" value={brl(s.spentCents)} hint={`${num(s.purchases)} compra(s) · ticket ${s.avgTicketCents == null ? '—' : brl(s.avgTicketCents)}`} />
          <Stat
            label="Comparecimento"
            value={s.attendancePct == null ? '—' : `${s.attendancePct.toLocaleString('pt-BR')}%`}
            hint={`${num(s.attended)} compareceu · ${num(s.noShow)} faltou${s.upcoming ? ` · ${num(s.upcoming)} agendado(s)` : ''}`}
            tone={s.noShow > s.attended ? 'bad' : undefined}
          />
          <Stat label="Saldo a receber" value={brl(s.balanceCents)} tone={s.balanceCents ? 'warn' : undefined} hint={`Pago: ${brl(s.paidCents)}`} />
          <Stat
            label="Última visita"
            value={s.lastVisitAt ? date(s.lastVisitAt) : '—'}
            hint={s.lastPurchaseAt ? `Última compra: ${date(s.lastPurchaseAt)}` : 'Ainda sem compras'}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Histórico</CardTitle>
            <CardDescription>Tudo o que aconteceu com a paciente, do mais recente ao mais antigo.</CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 && <p className="text-sm text-muted-foreground">Sem registros.</p>}
            <ol className="relative space-y-4 border-l pl-6">
              {events.map((e: any, i: number) => (
                <li key={i} className="relative">
                  <span
                    className={cn(
                      'absolute -left-[33px] flex size-6 items-center justify-center rounded-full border bg-background',
                      e.kind === 'SALE' && e.status !== 'CANCELED' && 'border-gold-300 text-gold-700',
                      e.kind === 'PAYMENT' && 'border-emerald-300 text-emerald-700',
                      e.status === 'NO_SHOW' && 'border-red-300 text-red-700',
                    )}
                  >
                    <EventIcon kind={e.kind} status={e.status} />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className={cn('text-sm font-medium', e.status === 'CANCELED' && 'text-muted-foreground line-through')}>
                      {e.title}
                      {e.kind === 'APPOINTMENT' && APPT_STATUS[e.status] && (
                        <Badge variant={APPT_STATUS[e.status]!.variant} className="ml-2">
                          {APPT_STATUS[e.status]!.label}
                        </Badge>
                      )}
                    </p>
                    <span className="text-xs text-muted-foreground">{e.kind === 'APPOINTMENT' || e.kind === 'LEAD' ? dateTime(e.at) : date(e.at)}</span>
                  </div>
                  {(e.detail || e.amountCents != null) && (
                    <p className="text-xs text-muted-foreground">
                      {e.amountCents != null && <b className="text-foreground">{brl(e.amountCents)}</b>}
                      {e.amountCents != null && e.detail ? ' · ' : ''}
                      {e.detail}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Procedimentos comprados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!s?.procedures.length && <p className="text-sm text-muted-foreground">Nenhum ainda.</p>}
              {s?.procedures.map((p: any) => (
                <div key={p.procedureId} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {p.name} <span className="text-muted-foreground">× {p.count}</span>
                  </span>
                  <span className="font-medium tabular-nums">{brl(p.spentCents)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Atendimentos</CardTitle>
              <CardDescription>Cada vez que a paciente entrou em contato.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {leads.map((l: any) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="block rounded-md border px-3 py-2 hover:bg-secondary/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{date(l.openedAt)}</span>
                    <StageBadge stage={l.stage} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {l.originLabel}
                    {l.adName ? ` · ${l.adName}` : l.originNote ? ` · ${l.originNote}` : ''}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
