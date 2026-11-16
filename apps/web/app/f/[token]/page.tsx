'use client';

import { CheckCircle2, Printer, ShieldCheck } from 'lucide-react';
import { use, useEffect, useState } from 'react';
import { AnamnesisAnswers, AnamnesisForm, type Answers, missingCount } from '@/components/clinical/anamnesis-form';
import { SignaturePad } from '@/components/clinical/signature-pad';
import { cn } from '@/lib/utils';

const TZ = 'America/Sao_Paulo';
const when = (d: string) => new Date(d).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' });

async function call(token: string, body?: unknown) {
  const res = await fetch(`/api/public/forms/${encodeURIComponent(token)}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.message ?? 'Não foi possível carregar. Tente de novo.');
  return j;
}

/** Página que a paciente abre no celular: responde a anamnese ou lê o termo, e assina com o dedo. */
export default function SignFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [name, setName] = useState('');
  const [doc, setDoc] = useState('');
  const [imageUse, setImageUse] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    call(token).then(
      (j) => {
        setD(j);
        setName(j.suggestedName ?? '');
        if (j.prefilled) setAnswers(j.prefilled);
      },
      (e) => setError(e.message),
    );
  }, [token]);

  const isAnamnesis = d?.kind === 'ANAMNESIS';
  const missing = isAnamnesis && d?.template ? missingCount(d.template, answers) : 0;
  const problem = !d
    ? null
    : missing
      ? `Responda todas as perguntas de Sim/Não (faltam ${missing}).`
      : !isAnamnesis && !imageUse
        ? 'Escolha uma opção sobre o uso das suas fotos.'
        : name.trim().split(/\s+/).length < 2
          ? 'Informe seu nome completo.'
          : !signature
            ? 'Faça sua assinatura no quadro.'
            : !accept
              ? 'Marque que leu e concorda.'
              : null;

  const submit = async () => {
    setTried(true);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const j = await call(token, { signerName: name, signerDocument: doc || null, signature, imageUse, answers: isAnamnesis ? answers : null, accept });
      setD(j);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f4ee] px-3 py-6 sm:px-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-lg print:rounded-none print:shadow-none">
        <div className="bg-navy-800 px-6 py-5 text-center print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
          <p className="font-serif text-2xl text-gold-300">{d?.clinic?.name ?? 'Clínica'}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-navy-100">{d?.title ?? 'Documento'}</p>
        </div>

        <div className="space-y-6 px-5 py-6 sm:px-8">
          {!d && !error && <p className="text-center text-sm text-muted-foreground">Carregando…</p>}
          {!d && error && <p className="rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

          {d?.status === 'SIGNED' && (
            <>
              <div className="rounded-xl bg-emerald-50 px-4 py-4 text-center text-emerald-900 print:hidden">
                <CheckCircle2 className="mx-auto mb-1 size-8" />
                <p className="font-medium">Assinado com sucesso{d.signerName ? `, ${d.signerName.split(' ')[0]}` : ''}!</p>
                <p className="text-sm">Obrigada. Uma cópia fica guardada na clínica.</p>
              </div>
              {d.text && <div className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{d.text}</div>}
              {d.sections && <AnamnesisAnswers sections={d.sections} />}
              {d.imageUse && d.imageUseOptions && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <b>Uso de imagem:</b> {d.imageUseOptions[d.imageUse]}
                </p>
              )}
              <div className="border-t pt-4 text-xs text-slate-600">
                <p>
                  Assinado eletronicamente por <b>{d.signerName}</b> em {when(d.signedAt)}.
                </p>
                <p className="break-all">Código de verificação: {d.contentHash}</p>
              </div>
              <div className="flex justify-center print:hidden">
                <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium text-navy-800 hover:bg-slate-50">
                  <Printer className="size-4" /> Salvar cópia em PDF
                </button>
              </div>
            </>
          )}

          {d?.status === 'PENDING' && (
            <>
              <p className="text-navy-800">
                Olá{d.firstName ? `, ${d.firstName}` : ''}! 💛{' '}
                {isAnamnesis
                  ? 'Responda com atenção. Suas respostas ajudam a profissional a cuidar de você com segurança.'
                  : 'Leia o termo com calma. Se tiver qualquer dúvida, pergunte antes de assinar.'}
              </p>

              {isAnamnesis && d.template && <AnamnesisForm template={d.template} answers={answers} onChange={setAnswers} highlightMissing={tried} />}

              {!isAnamnesis && (
                <>
                  <div className="max-h-[55vh] overflow-y-auto whitespace-pre-line rounded-xl border bg-slate-50/60 px-4 py-4 text-sm leading-relaxed text-slate-800">{d.text}</div>
                  <fieldset className={cn('space-y-2 rounded-xl border p-4', tried && !imageUse && 'border-red-300 bg-red-50')}>
                    <legend className="px-1 text-sm font-medium text-navy-800">Uso das suas fotos de antes e depois</legend>
                    {Object.entries(d.imageUseOptions as Record<string, string>).map(([k, label]) => (
                      <label key={k} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input type="radio" name="imageUse" className="mt-1" checked={imageUse === k} onChange={() => setImageUse(k)} />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}

              <section className="space-y-3 rounded-xl border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Nome completo</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-input px-3 py-2" autoComplete="name" />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">CPF (opcional)</span>
                    <input value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" className="w-full rounded-md border border-input px-3 py-2" placeholder="000.000.000-00" />
                  </label>
                </div>
                <SignaturePad onChange={setSignature} />
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                  {isAnamnesis
                    ? 'Declaro que as informações acima são verdadeiras e que avisarei a clínica sobre qualquer mudança na minha saúde.'
                    : 'Li e entendi este termo, tirei minhas dúvidas e concordo com a realização do procedimento.'}
                </label>
              </section>

              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button
                onClick={submit}
                disabled={busy}
                className="w-full rounded-full bg-navy-800 py-3.5 text-base font-medium text-white shadow hover:bg-navy-700 disabled:opacity-60"
              >
                {busy ? 'Enviando…' : 'Assinar e enviar'}
              </button>
              <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" /> Registramos data, hora e aparelho da assinatura. Seus dados ficam só com a clínica.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
