// Documento do orçamento: o mesmo visual na tela da consulta, na impressão/PDF e no link da paciente.
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface QuoteDoc {
  number: number;
  patientName: string | null;
  createdAt: string;
  validUntil: string;
  items: { description: string; quantity: number; unitPriceCents: number; discountCents: number; totalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentTerms: string | null;
  notes: string | null;
  status: string;
  clinicName: string;
  professional?: string | null;
}

const TZ = 'America/Sao_Paulo';
const longDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric' });
export const quoteNumber = (n: number) => String(n).padStart(4, '0');

export const QUOTE_STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Em aberto', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  APPROVED: { label: 'Aprovado', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  REJECTED: { label: 'Recusado', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  EXPIRED: { label: 'Vencido', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

export function QuoteStatusBadge({ status }: { status: string }) {
  const s = QUOTE_STATUS[status] ?? QUOTE_STATUS.OPEN!;
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', s.cls)}>{s.label}</span>;
}

export function QuoteDocument({ q, className }: { q: QuoteDoc; className?: string }) {
  const anyItemDiscount = q.items.some((i) => i.discountCents > 0);
  return (
    <article className={cn('quote-doc overflow-hidden rounded-2xl border bg-white text-navy-900 shadow-sm print:rounded-none print:border-0 print:shadow-none', className)}>
      <header className="flex flex-wrap items-end justify-between gap-4 bg-navy-800 px-6 py-6 sm:px-10 print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
        <div>
          <p className="font-serif text-2xl text-gold-300 sm:text-3xl">{q.clinicName}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-navy-100">Orçamento de tratamento</p>
        </div>
        <div className="text-navy-100 sm:text-right">
          <p className="text-xs uppercase tracking-wider">Nº</p>
          <p className="font-serif text-2xl text-white">{quoteNumber(q.number)}</p>
        </div>
      </header>

      <div className="space-y-8 px-6 py-8 sm:px-10">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Paciente</p>
            <p className="mt-0.5 text-lg font-medium">{q.patientName ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Emitido em</p>
            <p className="mt-0.5">{longDate(q.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Válido até</p>
            <p className="mt-0.5">{longDate(q.validUntil)}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gold-300 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Tratamento</th>
              <th className="py-2 px-3 text-center font-medium">Qtd</th>
              <th className="hidden py-2 px-3 text-right font-medium sm:table-cell print:table-cell">Valor unit.</th>
              {anyItemDiscount && <th className="hidden py-2 px-3 text-right font-medium sm:table-cell print:table-cell">Desconto</th>}
              <th className="py-2 pl-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((i, idx) => (
              <tr key={idx} className="border-b border-slate-100 align-top">
                <td className="py-3 pr-3">{i.description}</td>
                <td className="py-3 px-3 text-center tabular-nums">{i.quantity}</td>
                <td className="hidden py-3 px-3 text-right tabular-nums sm:table-cell print:table-cell">{brl(i.unitPriceCents)}</td>
                {anyItemDiscount && (
                  <td className="hidden py-3 px-3 text-right tabular-nums text-emerald-700 sm:table-cell print:table-cell">
                    {i.discountCents ? `− ${brl(i.discountCents)}` : '—'}
                  </td>
                )}
                <td className="py-3 pl-3 text-right font-medium tabular-nums">{brl(i.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
          {q.discountCents > 0 && (
            <>
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{brl(q.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Desconto</span>
                <span className="tabular-nums">− {brl(q.discountCents)}</span>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between border-t-2 border-gold-300 pt-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Total</span>
            <span className="font-serif text-3xl text-navy-800 tabular-nums">{brl(q.totalCents)}</span>
          </div>
        </div>

        {(q.paymentTerms || q.notes) && (
          <div className="grid gap-6 sm:grid-cols-2">
            {q.paymentTerms && (
              <div className="rounded-xl bg-gold-50/70 px-4 py-3 print:[-webkit-print-color-adjust:exact]">
                <p className="text-xs uppercase tracking-wider text-gold-700">Formas de pagamento</p>
                <p className="mt-1 whitespace-pre-line text-sm">{q.paymentTerms}</p>
              </div>
            )}
            {q.notes && (
              <div className="rounded-xl bg-slate-50 px-4 py-3 print:[-webkit-print-color-adjust:exact]">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Observações</p>
                <p className="mt-1 whitespace-pre-line text-sm">{q.notes}</p>
              </div>
            )}
          </div>
        )}

        <footer className="flex flex-wrap items-end justify-between gap-6 border-t pt-6 text-xs text-muted-foreground">
          <p>
            Valores sujeitos a avaliação clínica. Orçamento válido até {longDate(q.validUntil)}.
          </p>
          <div className="min-w-[220px] text-center">
            <div className="mb-1 h-10 border-b border-slate-300" />
            <p>{q.professional ?? q.clinicName}</p>
          </div>
        </footer>
      </div>
    </article>
  );
}
