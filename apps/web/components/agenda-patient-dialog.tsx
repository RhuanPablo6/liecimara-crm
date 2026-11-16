'use client';

import { CalendarPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { PaymentFields } from '@/components/finance-sales';
import { useMe } from '@/components/access';
import { api, useAction, useApi } from '@/lib/api';
import { brl, parseBRL } from '@/lib/format';
import { ORGANIC_ORIGINS, ORIGIN_NOTE_HINT } from '@/lib/origins';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const TIMES = Array.from({ length: 65 }, (_, i) => {
  const m = 6 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
const OFFSET = 180; // São Paulo, UTC-3
const toInstant = (day: string, time: string) => new Date(`${day}T${time}:00-03:00`).toISOString();
const spDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const spMinutes = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - OFFSET * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });

interface Saved {
  leadId: string;
  name: string;
  when: string;
  existing: boolean;
}

/**
 * Inclui na lista de leads uma paciente que já estava marcada na agenda antes do CRM:
 * cria o lead (ou usa o atendimento em aberto) e já grava o horário na Agenda.
 */
export function AgendaPatientDialog({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [waId, setWaId] = useState('55');
  const [name, setName] = useState('');
  const [procedureId, setProcedureId] = useState('');
  const [day, setDay] = useState(spDay());
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const [originType, setOriginType] = useState('RETURNING');
  const [originNote, setOriginNote] = useState('');
  const [wallet, setWallet] = useState(true);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [amount, setAmount] = useState('');
  const [received, setReceived] = useState<'none' | 'full' | 'partial'>('none');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('PIX');
  const [installments, setInstallments] = useState('1');
  const [paidAt, setPaidAt] = useState(spDay());
  const me = useMe();
  const canSell = !!me?.permissions.includes('sales:write');
  const { data: procedures } = useApi<any[]>(open ? '/procedures' : null);
  const { data: dayAppts } = useApi<any[]>(open && day ? `/agenda?from=${toInstant(day, '00:00')}&to=${toInstant(day, '23:59')}&v=${saved.length}` : null);
  const { data: dayBlocks } = useApi<any[]>(open && day ? `/agenda/blocks?from=${toInstant(day, '00:00')}&to=${toInstant(day, '23:59')}` : null);
  const { busy, error, run, setError } = useAction();

  const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const clash = (dayAppts ?? []).filter((a) => {
    if (a.status === 'CANCELED') return false;
    const s = spMinutes(a.scheduledFor);
    return s < start + Number(duration) && start < s + a.durationMin;
  });
  const slotStart = new Date(toInstant(day || '2000-01-01', time)).getTime();
  const blocked = (dayBlocks ?? []).filter((b) => new Date(b.startAt).getTime() < slotStart + Number(duration) * 60_000 && new Date(b.endAt).getTime() > slotStart);
  const phoneOk = waId.length >= 12;
  const amountCents = parseBRL(amount);
  const paidCents = received === 'partial' ? parseBRL(paid) : received === 'full' ? amountCents : 0;
  const saleError =
    amount.trim() && !amountCents
      ? 'Valor inválido'
      : amountCents && !procedureId
        ? 'Escolha o procedimento para lançar o valor'
        : received === 'partial' && (!paidCents || paidCents >= (amountCents ?? 0))
          ? 'O valor pago deve ser menor que o valor do procedimento'
          : null;

  function resetPatient() {
    setWaId('55');
    setName('');
    setNotes('');
    setOriginNote('');
    setAmount('');
    setPaid('');
    setReceived('none');
    setError(null);
  }

  async function save(again: boolean) {
    await run(async () => {
      const lead = await api('/leads', {
        method: 'POST',
        body: {
          waId,
          name: name.trim() || undefined,
          origin: originType === 'UNKNOWN' ? undefined : { type: originType, note: originNote || null },
          walletPatient: wallet ? true : undefined,
          appointment: {
            scheduledFor: toInstant(day, time),
            durationMin: Number(duration),
            procedureId: procedureId || null,
            notes: notes.trim() || null,
          },
          sale: amountCents
            ? {
                amountCents,
                // Saldo em aberto: previsão de receber no dia do atendimento.
                dueAt: received === 'full' ? null : day,
                payment:
                  received === 'none'
                    ? null
                    : {
                        method,
                        installments: method === 'CREDIT_CARD' ? Number(installments) : 1,
                        amountCents: received === 'partial' ? paidCents : null,
                        paidAt,
                      },
              }
            : undefined,
        },
      });
      const money = amountCents ? ` · ${brl(amountCents)} ${received === 'full' ? '(pago)' : received === 'partial' ? `(pago ${brl(paidCents ?? 0)})` : '(a receber)'}` : '';
      setSaved((s) => [{ leadId: lead.id, name: name.trim() || `+${waId}`, when: `${dayLabel(day)} ${time}${money}`, existing: !!lead.existing }, ...s]);
      onSaved?.();
      resetPatient();
      if (!again) setOpen(false);
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setSaved([]);
          resetPatient();
          setOpen(true);
        }}
      >
        <CalendarPlus /> Paciente da agenda
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Incluir paciente da agenda</DialogTitle>
            <DialogDescription>
              Para pacientes marcadas antes do CRM: ela entra em Leads e o horário já aparece na Agenda, com o link de confirmação.
            </DialogDescription>
          </DialogHeader>

          {saved.length > 0 && (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <p className="font-medium">Incluídas nesta sessão: {saved.length}</p>
              <ul className="mt-1 space-y-0.5">
                {saved.slice(0, 4).map((s) => (
                  <li key={s.leadId + s.when}>
                    <Link href={`/leads/${s.leadId}`} className="underline">
                      {s.name}
                    </Link>{' '}
                    · {s.when}
                    {s.existing && <span className="text-emerald-700"> (já estava em Leads, horário acrescentado)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="WhatsApp (DDI + DDD + número)">
              <Input inputMode="numeric" value={waId} onChange={(e) => setWaId(e.target.value.replace(/\D/g, ''))} placeholder="5511999998888" />
            </Field>
            <Field label="Nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Procedimento">
              <NativeSelect value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
                <option value="">Não definido</option>
                {(procedures ?? [])
                  .filter((p) => p.active !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Data">
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Horário">
              <NativeSelect value={time} onChange={(e) => setTime(e.target.value)}>
                {TIMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Duração">
              <NativeSelect value={duration} onChange={(e) => setDuration(e.target.value)}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : `${d / 60}h${d % 60 ? ` ${d % 60}` : ''}`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {clash.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Já existe agendamento nesse horário:{' '}
              {clash.map((a) => `${a.name ?? 'Paciente'} (${hhmm(spMinutes(a.scheduledFor))})`).join(', ')}. Dá para salvar mesmo assim.
            </p>
          )}

          {blocked.length > 0 && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
              Atenção: a agenda está fechada nesse horário ({blocked.map((b) => b.reason).join(', ')}). Confira a data antes de salvar.
            </p>
          )}

          <Field label="Observações (opcional)">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex.: 2ª sessão, sinal pago" />
          </Field>

          {canSell && (
            <div className="space-y-4 rounded-md border p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valor e pagamento (opcional)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Valor do procedimento (R$)">
                  <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Já está pago?">
                  <NativeSelect value={received} onChange={(e) => setReceived(e.target.value as any)} disabled={!amountCents}>
                    <option value="none">Não, vai pagar depois</option>
                    <option value="full">Sim, pago o valor total</option>
                    <option value="partial">Pagou uma parte (sinal)</option>
                  </NativeSelect>
                </Field>
                {amountCents && received === 'partial' ? (
                  <Field label="Valor já pago (R$)">
                    <Input inputMode="decimal" placeholder="0,00" value={paid} onChange={(e) => setPaid(e.target.value)} />
                  </Field>
                ) : null}
                {amountCents && received !== 'none' ? (
                  <>
                    <PaymentFields method={method} setMethod={setMethod} installments={installments} setInstallments={setInstallments} />
                    <Field label="Data do pagamento">
                      <Input type="date" max={spDay()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                    </Field>
                  </>
                ) : null}
              </div>
              {amountCents && received !== 'full' && !saleError ? (
                <p className="text-xs text-muted-foreground">
                  {brl(amountCents - (paidCents ?? 0))} fica em Contas a receber com previsão para o dia do atendimento.
                </p>
              ) : null}
              {saleError && <p className="text-sm text-red-700">{saleError}</p>}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Como a paciente chegou?">
              <NativeSelect value={originType} onChange={(e) => setOriginType(e.target.value)}>
                {ORGANIC_ORIGINS.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
                <option value="UNKNOWN">Não sei</option>
              </NativeSelect>
            </Field>
            {originType !== 'UNKNOWN' && (
              <Field label="Detalhe (opcional)">
                <Input placeholder={ORIGIN_NOTE_HINT[originType]} value={originNote} onChange={(e) => setOriginNote(e.target.value)} />
              </Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-navy-700" checked={wallet} onChange={(e) => setWallet(e.target.checked)} />
            Já é paciente da clínica (da carteira)
          </label>

          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !phoneOk || !day || !!saleError} onClick={() => save(false)}>
              Salvar
            </Button>
            <Button variant="outline" disabled={busy || !phoneOk || !day || !!saleError} onClick={() => save(true)}>
              Salvar e incluir outra
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
