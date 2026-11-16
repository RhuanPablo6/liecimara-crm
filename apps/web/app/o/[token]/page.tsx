'use client';

import { MessageCircle, Printer } from 'lucide-react';
import { use, useEffect, useState } from 'react';
import { QuoteDocument } from '@/components/quotes/quote-document';

/** Orçamento que a paciente abre pelo link enviado no WhatsApp (sem login). */
export default function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/quotes/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.message ?? 'Não foi possível abrir o orçamento.');
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  const wa = data?.clinic?.whatsapp
    ? `https://wa.me/${data.clinic.whatsapp}?text=${encodeURIComponent(`Olá! Vi o orçamento nº ${String(data.number).padStart(4, '0')} e gostaria de agendar.`)}`
    : null;

  return (
    <main className="min-h-screen bg-[#f7f4ee] px-3 py-8 sm:px-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl space-y-4">
        {!data && !error && <p className="text-center text-sm text-muted-foreground">Carregando…</p>}
        {error && <p className="mx-auto max-w-md rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}
        {data && (
          <>
            {data.firstName && <p className="text-center text-lg text-navy-800 print:hidden">Olá, {data.firstName}! Aqui está o seu orçamento. 💛</p>}
            {data.status === 'EXPIRED' && (
              <p className="rounded-lg bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 print:hidden">
                Este orçamento passou da validade. Fale com a clínica para atualizar os valores.
              </p>
            )}
            <QuoteDocument q={{ ...data, patientName: data.firstName, clinicName: data.clinic.name }} />
            <div className="flex flex-wrap justify-center gap-3 print:hidden">
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-emerald-700">
                  <MessageCircle className="size-4" /> Quero agendar
                </a>
              )}
              <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full border bg-white px-5 py-2.5 text-sm font-medium text-navy-800 hover:bg-slate-50">
                <Printer className="size-4" /> Salvar em PDF
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
