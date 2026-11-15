'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ConfidenceBadge } from '@/components/badges';
import { ErrorText } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const NEXT: Record<string, { stage: string; label: string } | undefined> = {
  NEW: { stage: 'CONTACTED', label: 'Em atendimento' },
  CONTACTED: { stage: 'SCHEDULED', label: 'Agendado' },
  SCHEDULED: { stage: 'ATTENDED', label: 'Compareceu' },
};

const COLUMN_STYLE: Record<string, string> = {
  NEW: 'border-t-gold-400',
  CONTACTED: 'border-t-navy-300',
  SCHEDULED: 'border-t-navy-600',
  ATTENDED: 'border-t-amber-500',
  WON: 'border-t-emerald-500',
  LOST: 'border-t-red-400',
};

export default function FunnelPage() {
  const { data, reload } = useApi<{ stage: string; label: string; leads: any[] }[]>('/funnel/board');
  const act = useAction();

  async function advance(leadId: string, stage: string) {
    // "Agendado" exige data: abre o lead para registrar o agendamento.
    if (stage === 'SCHEDULED') {
      window.location.href = `/leads/${leadId}`;
      return;
    }
    await act.run(() => api(`/leads/${leadId}/stage`, { method: 'PATCH', body: { stage } }));
    await reload();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-navy-800">Funil comercial</h1>
        <p className="text-sm text-muted-foreground">Leads abertos e fechados nos últimos 30 dias</p>
      </div>
      <ErrorText>{act.error}</ErrorText>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {data?.map((col) => (
          <section key={col.stage} className={cn('flex w-72 shrink-0 flex-col rounded-lg border border-t-4 bg-secondary/40', COLUMN_STYLE[col.stage])}>
            <header className="flex items-center justify-between px-3 py-2.5">
              <h2 className="font-sans text-sm font-semibold text-navy-800">{col.label}</h2>
              <span className="rounded-full bg-background px-2 text-xs text-muted-foreground">{col.leads.length}</span>
            </header>
            <div className="flex flex-col gap-2 px-2 pb-2">
              {col.leads.map((l) => (
                <article key={l.id} className="rounded-md border bg-background p-3 shadow-sm">
                  <Link href={`/leads/${l.id}`} className="block">
                    <p className="truncate font-medium text-navy-800">{l.contact?.name ?? l.contact?.waId}</p>
                    <p className="truncate text-xs text-muted-foreground">{l.adName ?? 'Origem desconhecida'}</p>
                    {l.procedureInterest && <p className="truncate text-xs text-navy-600">{l.procedureInterest}</p>}
                  </Link>
                  <div className="mt-2 flex items-center justify-between">
                    <ConfidenceBadge value={l.attributionConfidence} />
                    <span className="text-[10px] text-muted-foreground">{dateTime(l.lastActivityAt)}</span>
                  </div>
                  {NEXT[l.stage] && (
                    <button
                      disabled={act.busy}
                      onClick={() => advance(l.id, NEXT[l.stage]!.stage)}
                      className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-dashed py-1 text-xs text-navy-600 hover:bg-secondary"
                    >
                      {NEXT[l.stage]!.label} <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
