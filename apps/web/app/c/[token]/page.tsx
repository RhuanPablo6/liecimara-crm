'use client';

import { CalendarCheck, CalendarClock, CalendarX, CheckCircle2, MessageCircle } from 'lucide-react';
import { use, useEffect, useState } from 'react';

type Data = {
  firstName: string | null;
  procedureName: string | null;
  scheduledFor: string;
  durationMin: number;
  status: string;
  patientResponse: string | null;
  clinicName: string;
  clinicWhatsapp: string | null;
  canAnswer: boolean;
};

const TZ = 'America/Sao_Paulo';
const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
const timeText = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

async function call(token: string, init?: { action: string; note?: string }) {
  const res = await fetch(`/api/public/appointments/${encodeURIComponent(token)}`, {
    method: init ? 'POST' : 'GET',
    headers: init ? { 'content-type': 'application/json' } : undefined,
    body: init ? JSON.stringify(init) : undefined,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message ?? 'Não foi possível carregar. Tente de novo.');
  return json as Data;
}

/** Página que a paciente abre pelo link da mensagem: confirmar, desmarcar ou pedir para remarcar. */
export default function PatientAppointmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'cancel' | 'reschedule'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    call(token).then(setData, (e) => setError(e.message));
  }, [token]);

  const answer = async (action: 'CONFIRM' | 'CANCEL' | 'RESCHEDULE') => {
    setBusy(true);
    setError(null);
    try {
      setData(await call(token, { action, note: note.trim() || undefined }));
      setDone(action);
      setMode('idle');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const wa = data?.clinicWhatsapp ? `https://wa.me/${data.clinicWhatsapp}` : null;

  return (
    <main className="flex min-h-screen items-start justify-center bg-[#f7f4ee] px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-lg">
        <div className="bg-navy-800 px-6 py-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark-gold.png" alt="" className="mx-auto mb-2 h-12 w-auto" />
          <p className="font-serif text-2xl text-gold-300">{data?.clinicName ?? 'Clínica'}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-navy-100">Seu agendamento</p>
        </div>

        <div className="space-y-5 px-6 py-6">
          {!data && !error && <p className="text-center text-sm text-muted-foreground">Carregando…</p>}
          {error && !data && <p className="rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

          {data && (
            <>
              <div className="text-center">
                <p className="text-lg text-navy-800">Olá{data.firstName ? `, ${data.firstName}` : ''}! 💛</p>
                <div className="mt-3 rounded-xl border border-gold-200 bg-gold-50/60 px-4 py-4">
                  <p className="text-sm text-muted-foreground">{data.procedureName ?? 'Atendimento'}</p>
                  <p className="mt-1 text-xl font-semibold text-navy-800">{dayText(data.scheduledFor)}</p>
                  <p className="text-3xl font-semibold text-navy-800">{timeText(data.scheduledFor)}</p>
                </div>
              </div>

              {done === 'CONFIRM' || (data.status === 'CONFIRMED' && !done) ? (
                <p className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-center text-emerald-800">
                  <CheckCircle2 className="size-5" /> Horário confirmado. Até lá!
                </p>
              ) : null}
              {data.status === 'CANCELED' && (
                <p className="rounded-lg bg-slate-100 px-4 py-3 text-center text-slate-700">
                  {data.patientResponse === 'RESCHEDULE'
                    ? 'Recebemos seu pedido para remarcar. A clínica vai falar com você para combinar o novo horário.'
                    : 'Este horário foi desmarcado.'}
                </p>
              )}

              {data.canAnswer && mode === 'idle' && (
                <div className="space-y-2">
                  {data.status !== 'CONFIRMED' && (
                    <button
                      disabled={busy}
                      onClick={() => answer('CONFIRM')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <CalendarCheck className="size-5" /> Confirmar presença
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => setMode('reschedule')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-navy-700 px-4 py-3 text-base font-semibold text-navy-800 hover:bg-navy-50 disabled:opacity-60"
                  >
                    <CalendarClock className="size-5" /> Remarcar
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setMode('cancel')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    <CalendarX className="size-5" /> Desmarcar
                  </button>
                </div>
              )}

              {data.canAnswer && mode !== 'idle' && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-navy-800">
                    {mode === 'reschedule' ? 'Qual dia e horário ficam melhor para você?' : 'Quer contar o motivo? (opcional)'}
                  </label>
                  <textarea
                    className="min-h-[90px] w-full rounded-lg border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gold-400"
                    placeholder={mode === 'reschedule' ? 'ex.: sábado de manhã ou quinta depois das 17h' : ''}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  {mode === 'reschedule' && (
                    <p className="text-xs text-muted-foreground">Seu horário atual será liberado e a clínica vai te chamar para combinar o novo.</p>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => answer(mode === 'reschedule' ? 'RESCHEDULE' : 'CANCEL')}
                    className={
                      mode === 'reschedule'
                        ? 'w-full rounded-xl bg-navy-800 px-4 py-3.5 text-base font-semibold text-white hover:bg-navy-700 disabled:opacity-60'
                        : 'w-full rounded-xl bg-red-600 px-4 py-3.5 text-base font-semibold text-white hover:bg-red-700 disabled:opacity-60'
                    }
                  >
                    {busy ? 'Enviando…' : mode === 'reschedule' ? 'Pedir para remarcar' : 'Desmarcar horário'}
                  </button>
                  <button className="w-full py-2 text-sm text-muted-foreground" onClick={() => setMode('idle')}>
                    Voltar
                  </button>
                </div>
              )}

              {!data.canAnswer && data.status !== 'CANCELED' && data.status !== 'CONFIRMED' && (
                <p className="text-center text-sm text-muted-foreground">Este horário já passou ou não pode mais ser alterado por aqui.</p>
              )}
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 border-t pt-4 text-sm font-medium text-navy-700 hover:underline"
                >
                  <MessageCircle className="size-4" /> Falar com a clínica no WhatsApp
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
