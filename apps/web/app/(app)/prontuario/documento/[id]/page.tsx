'use client';

import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { AnamnesisAnswers } from '@/components/clinical/anamnesis-form';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/form';
import { useApi } from '@/lib/api';
import { dateTime } from '@/lib/format';

const IMAGE_USE: Record<string, string> = {
  NONE: 'Não autorizou o uso das fotos fora do prontuário.',
  INTERNAL: 'Autorizou o uso das fotos apenas para acompanhamento clínico e discussão técnica, sem identificação.',
  MARKETING: 'Autorizou a divulgação das fotos de antes e depois nas redes sociais e materiais da clínica, sem expor o nome.',
};

/** Documento do prontuário pronto para imprimir/PDF, com assinatura e dados de verificação. */
export default function ClinicalDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: f, error } = useApi<any>(`/clinical/forms/${id}`);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!f) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={f.patient ? `/pacientes/${f.patient.id}?tab=prontuario` : '/prontuario'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-navy-700">
          <ArrowLeft className="h-4 w-4" /> Prontuário de {f.patient?.name ?? 'paciente'}
        </Link>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> Imprimir / PDF
        </Button>
      </div>

      <article className="overflow-hidden rounded-2xl border bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <header className="flex items-center gap-4 bg-navy-800 px-8 py-5 print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark-gold.png" alt="" className="h-12 w-auto" />
          <div>
            <p className="font-serif text-2xl text-gold-300">{f.clinicName}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-navy-100">{f.title}</p>
          </div>
        </header>
        <div className="space-y-6 px-8 py-7">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Paciente: </span>
              <b>{f.patient?.name ?? '—'}</b>
            </p>
            {f.procedureName && (
              <p>
                <span className="text-muted-foreground">Procedimento: </span>
                <b>{f.procedureName}</b>
              </p>
            )}
          </div>

          {f.status === 'PENDING' && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Documento ainda não assinado pela paciente.</p>}

          {f.kind === 'CONSENT' && <div className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{f.content.text}</div>}
          {f.kind === 'ANAMNESIS' && f.content?.sections && <AnamnesisAnswers sections={f.content.sections} />}

          {f.imageUse && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm print:[-webkit-print-color-adjust:exact]">
              <b>Uso de imagem:</b> {IMAGE_USE[f.imageUse]}
            </p>
          )}

          {f.status === 'SIGNED' && (
            <footer className="space-y-3 border-t pt-5">
              <div className="w-72">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.signature} alt="Assinatura" className="h-24 w-full object-contain object-left" />
                <div className="border-t border-slate-400 pt-1 text-sm">
                  {f.signerName}
                  {f.signerDocument && <span className="text-muted-foreground"> · CPF {f.signerDocument.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}</span>}
                </div>
              </div>
              <div className="space-y-0.5 text-[11px] leading-snug text-slate-500">
                <p>Assinado eletronicamente em {dateTime(f.signedAt)} (horário de Brasília).</p>
                {f.signedIp && <p>IP: {f.signedIp}</p>}
                {f.signedUserAgent && <p className="break-all">Aparelho: {f.signedUserAgent}</p>}
                <p className="break-all">Código de verificação (SHA-256): {f.contentHash}</p>
              </div>
            </footer>
          )}
        </div>
      </article>
    </div>
  );
}
