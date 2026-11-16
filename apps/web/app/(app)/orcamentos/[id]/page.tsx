'use client';

import { ArrowLeft, Check, Copy, MessageCircle, Pencil, Printer, RotateCcw, ShoppingBag, X } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { useMe } from '@/components/access';
import { QuoteDocument, QuoteStatusBadge, quoteNumber } from '@/components/quotes/quote-document';
import { QuoteEditor } from '@/components/quotes/quote-editor';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { brl, date, dateTime } from '@/lib/format';

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: q, error: loadError, reload } = useApi<any>(`/quotes/${id}`);
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const me = useMe();
  const canSell = !!me?.permissions.includes('sales:write');

  if (loadError) return <ErrorText>{loadError}</ErrorText>;
  if (!q) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/o/${q.token}`;
  const first = (q.patient?.name ?? '').trim().split(/\s+/)[0];
  const waText =
    `Olá${first ? `, ${first}` : ''}! Segue o seu orçamento da ${q.clinic.name}:\n\n` +
    q.items.map((i: any) => `• ${i.description}${i.quantity > 1 ? ` (${i.quantity}x)` : ''}`).join('\n') +
    `\n\nTotal: ${brl(q.totalCents)}\nVálido até ${date(q.validUntil)}.\n\nVeja os detalhes: ${link}`;
  const waUrl = q.patient?.waId ? `https://wa.me/${q.patient.waId}?text=${encodeURIComponent(waText)}` : null;

  const act = async (fn: () => Promise<unknown>) => {
    if (await run(fn)) await reload();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const isOpen = q.status === 'OPEN';
  const converted = !!q.saleIds?.length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-sm">
            <Link href="/orcamentos" className="inline-flex items-center gap-1 text-muted-foreground hover:text-navy-700">
              <ArrowLeft className="h-4 w-4" /> Orçamentos
            </Link>
            {q.patient && (
              <Link href={`/pacientes/${q.patient.id}`} className="text-navy-600 hover:underline">
                Perfil de {q.patient.name ?? 'paciente'}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Nº {quoteNumber(q.number)} <QuoteStatusBadge status={q.effectiveStatus} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isOpen && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Editar
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Imprimir / PDF
          </Button>
          {waUrl && (
            <Button variant="outline" asChild>
              <a href={waUrl} target="_blank" rel="noreferrer">
                <MessageCircle /> Enviar no WhatsApp
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? 'Link copiado' : 'Copiar link'}
          </Button>
          <div className="flex-1" />
          {q.status !== 'APPROVED' && canSell && (
            <ConfirmButton variant="gold" disabled={busy} confirmLabel="Lançar venda?" onConfirm={() => act(() => api(`/quotes/${id}/convert`, { method: 'POST' }))}>
              <ShoppingBag /> Aprovar e lançar venda
            </ConfirmButton>
          )}
          {isOpen && (
            <ConfirmButton variant="ghost" disabled={busy} confirmLabel="Marcar recusado?" onConfirm={() => act(() => api(`/quotes/${id}/status`, { method: 'POST', body: { status: 'REJECTED' } }))}>
              <X /> Recusado
            </ConfirmButton>
          )}
          {!isOpen && !converted && (
            <Button variant="ghost" disabled={busy} onClick={() => act(() => api(`/quotes/${id}/status`, { method: 'POST', body: { status: 'OPEN' } }))}>
              <RotateCcw /> Reabrir
            </Button>
          )}
        </div>
        <ErrorText>{error}</ErrorText>

        {converted && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
            Aprovado em {dateTime(q.decidedAt)} · {q.saleIds.length} venda(s) lançada(s) no atendimento.{' '}
            {q.leadId && (
              <Link href={`/leads/${q.leadId}`} className="font-medium underline">
                Abrir atendimento para registrar pagamento ou agendar
              </Link>
            )}
          </p>
        )}
        {q.status === 'REJECTED' && <p className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-700">Marcado como recusado em {dateTime(q.decidedAt)}.</p>}
        {q.effectiveStatus === 'EXPIRED' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">Validade vencida. Edite a data para reenviar ou aprove mesmo assim.</p>
        )}
      </div>

      <QuoteDocument
        q={{
          number: q.number,
          patientName: q.patient?.name ?? null,
          createdAt: q.createdAt,
          validUntil: q.validUntil,
          items: q.items,
          subtotalCents: q.subtotalCents,
          discountCents: q.discountCents,
          totalCents: q.totalCents,
          paymentTerms: q.paymentTerms,
          notes: q.notes,
          status: q.effectiveStatus,
          clinicName: q.clinic.name,
        }}
      />
      <p className="text-xs text-muted-foreground print:hidden">
        Criado por {q.createdByName ?? '—'} em {dateTime(q.createdAt)}
        {q.updatedAt !== q.createdAt && ` · atualizado em ${dateTime(q.updatedAt)}`}
      </p>

      <QuoteEditor open={editing} onOpenChange={setEditing} quote={q} onSaved={() => reload()} />
    </div>
  );
}
