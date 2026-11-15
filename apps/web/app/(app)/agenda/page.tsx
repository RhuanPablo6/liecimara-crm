'use client';

import { CalendarCheck, CalendarX, Check, ChevronLeft, ChevronRight, Plus, UserCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageButton } from '@/components/message-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { phone } from '@/lib/format';
import { ORGANIC_ORIGINS } from '@/lib/origins';
import { cn } from '@/lib/utils';

type View = 'day' | 'week' | 'month';

// São Paulo: UTC−3 fixo (sem horário de verão desde 2019).
const OFFSET = 3 * 60;
const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_PX = 64;

const todaySP = () => new Date(Date.now() - OFFSET * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7));
const spDayOf = (iso: string) => new Date(new Date(iso).getTime() - OFFSET * 60_000).toISOString().slice(0, 10);
const spMinutes = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - OFFSET * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toInstant = (day: string, time: string) => new Date(`${day}T${time}:00-03:00`).toISOString();
const label = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...opts });
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

const TIMES = Array.from({ length: (24 * 60) / 15 }, (_, i) => hhmm(i * 15)).filter((t) => t >= '06:00' && t <= '22:00');
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

const STATUS: Record<string, { label: string; block: string; badge: any }> = {
  SCHEDULED: { label: 'A confirmar', block: 'border-l-navy-600 bg-navy-50 text-navy-900', badge: 'warning' },
  CONFIRMED: { label: 'Confirmado', block: 'border-l-emerald-600 bg-emerald-50 text-emerald-950', badge: 'success' },
  ATTENDED: { label: 'Compareceu', block: 'border-l-slate-400 bg-slate-100 text-slate-700', badge: 'secondary' },
  NO_SHOW: { label: 'Faltou', block: 'border-l-red-500 bg-red-50 text-red-900', badge: 'danger' },
  CANCELED: { label: 'Cancelado', block: 'border-l-slate-300 bg-white text-slate-400 line-through', badge: 'secondary' },
};

type Appt = {
  id: string;
  leadId: string;
  contactId: string | null;
  name: string | null;
  waId: string | null;
  procedureId: string | null;
  procedureName: string | null;
  scheduledFor: string;
  durationMin: number;
  notes: string | null;
  status: string;
  cancelReason: string | null;
  patientResponse: string | null;
  patientResponseAt: string | null;
  patientNote: string | null;
};

const RESPONSE: Record<string, string> = { CONFIRMED: 'Confirmou pelo link', CANCELED: 'Desmarcou pelo link', RESCHEDULE: 'Pediu para remarcar' };

/** Agendamentos que se sobrepõem ficam lado a lado. */
function layout(list: Appt[]) {
  const items = list
    .map((a) => ({ a, start: spMinutes(a.scheduledFor), end: spMinutes(a.scheduledFor) + a.durationMin }))
    .sort((x, y) => x.start - y.start || y.end - x.end);
  const out: { a: Appt; start: number; end: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => (c.cols = cols));
    out.push(...cluster);
    cluster = [];
  };
  for (const it of items) {
    if (it.start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

const overlaps = (list: Appt[], day: string, start: number, dur: number, ignoreId?: string) =>
  list.filter((a) => {
    if (a.id === ignoreId || a.status === 'CANCELED' || spDayOf(a.scheduledFor) !== day) return false;
    const s = spMinutes(a.scheduledFor);
    return s < start + dur && start < s + a.durationMin;
  });

// ── Novo agendamento ──────────────────────────────────────────

function NewAppointment({
  init,
  appts,
  procedures,
  onDone,
}: {
  init: { day: string; time: string; leadId?: string; name?: string };
  appts: Appt[];
  procedures: any[];
  onDone: (created: boolean) => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState(init.name ?? '');
  const [picked, setPicked] = useState<any>(init.leadId ? { leadId: init.leadId, name: init.name ?? 'Paciente' } : null);
  const [results, setResults] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [waId, setWaId] = useState('55');
  const [origin, setOrigin] = useState('');
  const [procedureId, setProcedureId] = useState('');
  const [day, setDay] = useState(init.day);
  const [time, setTime] = useState(init.time);
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (mode !== 'existing' || picked || query.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      api(`/agenda/patients?q=${encodeURIComponent(query.trim())}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode, picked]);

  const [h, m] = time.split(':').map(Number);
  const clash = overlaps(appts, day, h! * 60 + m!, Number(duration));
  const ready = (mode === 'existing' ? !!picked?.leadId : waId.length >= 12) && !!day && !!time;

  return (
    <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Novo agendamento</DialogTitle>
      </DialogHeader>
      <div className="inline-flex w-fit rounded-lg bg-secondary p-1">
        {(
          [
            ['existing', 'Paciente cadastrada'],
            ['new', 'Paciente nova'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={cn('rounded-md px-3 py-1 text-sm font-medium', mode === k ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground')}
          >
            {l}
          </button>
        ))}
      </div>

      {mode === 'existing' ? (
        picked ? (
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="font-medium">{picked.name ?? phone(picked.waId)}</p>
              {picked.waId && <p className="text-xs text-muted-foreground">{phone(picked.waId)}</p>}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Trocar
            </Button>
          </div>
        ) : (
          <Field label="Buscar paciente (nome ou telefone)">
            <Input autoFocus placeholder="ex.: Mariana ou 9 5555" value={query} onChange={(e) => setQuery(e.target.value)} />
            {results.length > 0 && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-md border">
                {results.map((r) => (
                  <button
                    key={r.contactId}
                    className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-secondary"
                    onClick={() => {
                      setPicked(r);
                      if (r.procedureInterestId && !procedureId) setProcedureId(r.procedureInterestId);
                    }}
                  >
                    <span className="font-medium">{r.name ?? 'Sem nome'}</span> <span className="text-muted-foreground">· {phone(r.waId)}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim().length >= 2 && results.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhuma paciente encontrada.{' '}
                <button className="underline" onClick={() => (setMode('new'), setName(query))}>
                  Cadastrar como nova
                </button>
              </p>
            )}
          </Field>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="WhatsApp (DDI + DDD + número)">
            <Input inputMode="numeric" value={waId} onChange={(e) => setWaId(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Como chegou? (opcional)" className="sm:col-span-2">
            <NativeSelect value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">Não informar</option>
              {ORGANIC_ORIGINS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Procedimento">
          <NativeSelect value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
            <option value="">Não definido (avaliação)</option>
            {procedures
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Duração">
          <NativeSelect value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} min` : `${d / 60} h${d % 60 ? ` ${d % 60} min` : ''}`.replace('.5 h', 'h30')}
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
      </div>
      <Field label="Observações (opcional)">
        <Textarea className="min-h-[60px]" placeholder="ex.: retorno do Botox, trazer exames" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {clash.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Já existe agendamento nesse horário: {clash.map((c) => `${hhmm(spMinutes(c.scheduledFor))} ${c.name ?? ''}`).join(', ')}. Dá para marcar mesmo assim.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <Button
        disabled={busy || !ready}
        onClick={() =>
          run(async () => {
            await api('/agenda/appointments', {
              method: 'POST',
              body: {
                ...(mode === 'existing' ? { leadId: picked.leadId } : { waId, name: name || null, origin: origin ? { type: origin } : null }),
                procedureId: procedureId || null,
                scheduledFor: toInstant(day, time),
                durationMin: Number(duration),
                notes: notes || null,
              },
            });
            onDone(true);
          })
        }
      >
        Agendar
      </Button>
    </DialogContent>
  );
}

// ── Detalhes / ações ──────────────────────────────────────────

function AppointmentDetails({ a, appts, procedures, onDone }: { a: Appt; appts: Appt[]; procedures: any[]; onDone: (changed: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(spDayOf(a.scheduledFor));
  const [time, setTime] = useState(hhmm(spMinutes(a.scheduledFor)));
  const [duration, setDuration] = useState(String(a.durationMin));
  const [procedureId, setProcedureId] = useState(a.procedureId ?? '');
  const [notes, setNotes] = useState(a.notes ?? '');
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const start = spMinutes(a.scheduledFor);
  const st = STATUS[a.status] ?? STATUS.SCHEDULED!;
  const open = a.status === 'SCHEDULED' || a.status === 'CONFIRMED';
  const [h, m] = time.split(':').map(Number);
  const clash = editing ? overlaps(appts, day, h! * 60 + m!, Number(duration), a.id) : [];

  const setStatus = (status: 'CONFIRMED' | 'ATTENDED' | 'NO_SHOW') =>
    run(async () => {
      await api(`/appointments/${a.id}/status`, { method: 'POST', body: { status } });
      onDone(true);
    });

  return (
    <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{a.name ?? 'Paciente'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-1 text-sm">
        <p>
          <b>{cap(label(spDayOf(a.scheduledFor), { weekday: 'long', day: 'numeric', month: 'long' }))}</b>, {hhmm(start)} – {hhmm(start + a.durationMin)}
        </p>
        <p className="text-muted-foreground">
          {a.procedureName ?? 'Procedimento não definido'} · {phone(a.waId)}
        </p>
        <Badge variant={st.badge}>{st.label}</Badge>
        {a.patientResponse && (
          <p className="text-xs font-medium text-navy-700">
            {RESPONSE[a.patientResponse]}
            {a.patientResponseAt && ` em ${new Date(a.patientResponseAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
            {a.patientNote && ` · “${a.patientNote}”`}
          </p>
        )}
        {a.cancelReason && <p className="text-xs text-muted-foreground">Motivo: {a.cancelReason}</p>}
        {a.notes && !editing && <p className="rounded-md bg-secondary/60 px-3 py-2">{a.notes}</p>}
      </div>

      {open && !editing && !canceling && (
        <div className="flex flex-wrap gap-2">
          {a.status === 'SCHEDULED' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus('CONFIRMED')}>
              <Check /> Confirmou
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus('ATTENDED')}>
            <UserCheck /> Compareceu
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus('NO_SHOW')}>
            <UserX /> Faltou
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <CalendarCheck /> Remarcar / editar
          </Button>
          <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setCanceling(true)}>
            <CalendarX /> Cancelar
          </Button>
        </div>
      )}
      {open && !editing && !canceling && (
        <MessageButton
          waId={a.waId}
          appointmentId={a.id}
          use="CONFIRM"
          label="Mensagem de confirmação (com link)"
          vars={{ nome: a.name, procedimento: a.procedureName, data: label(spDayOf(a.scheduledFor), { day: '2-digit', month: '2-digit' }), hora: hhmm(start) }}
        />
      )}

      {editing && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
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
                    {d} min
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Procedimento">
              <NativeSelect value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
                <option value="">Não definido</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Observações">
            <Textarea className="min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {clash.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Conflito com: {clash.map((c) => `${hhmm(spMinutes(c.scheduledFor))} ${c.name ?? ''}`).join(', ')}.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/appointments/${a.id}`, {
                    method: 'PATCH',
                    body: { scheduledFor: toInstant(day, time), durationMin: Number(duration), procedureId: procedureId || null, notes: notes || null },
                  });
                  onDone(true);
                })
              }
            >
              Salvar
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Voltar
            </Button>
          </div>
          {a.status === 'CONFIRMED' && <p className="text-xs text-muted-foreground">Se mudar o horário, o agendamento volta para "a confirmar".</p>}
        </div>
      )}

      {canceling && (
        <div className="space-y-3 border-t pt-3">
          <Field label="Motivo do cancelamento">
            <Input placeholder="ex.: paciente pediu para desmarcar" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 2}
              onClick={() =>
                run(async () => {
                  await api(`/appointments/${a.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } });
                  onDone(true);
                })
              }
            >
              Cancelar agendamento
            </Button>
            <Button variant="ghost" onClick={() => setCanceling(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-3 border-t pt-3 text-sm">
        {a.contactId && (
          <Link className="text-navy-600 hover:underline" href={`/pacientes/${a.contactId}`}>
            Histórico da paciente
          </Link>
        )}
        <Link className="text-navy-600 hover:underline" href={`/leads/${a.leadId}`}>
          Atendimento (registrar venda)
        </Link>
      </div>
    </DialogContent>
  );
}

// ── Página ────────────────────────────────────────────────────

export default function AgendaPage() {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(todaySP());
  const [showCanceled, setShowCanceled] = useState(false);
  const [sunday, setSunday] = useState(false);
  const [creating, setCreating] = useState<{ day: string; time: string; leadId?: string; name?: string } | null>(null);
  const [selected, setSelected] = useState<Appt | null>(null);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const { data: procedures } = useApi<any[]>('/procedures');

  useEffect(() => {
    if (window.innerWidth < 768) setView('day');
    // Vindo de "Agendar" (Retornos, ficha do lead): já abre com a paciente escolhida.
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('lead')) setCreating({ day: todaySP(), time: '09:00', leadId: sp.get('lead')!, name: sp.get('name') ?? undefined });
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'week') {
      const mon = mondayOf(anchor);
      return Array.from({ length: sunday ? 7 : 6 }, (_, i) => addDays(mon, i));
    }
    const first = `${anchor.slice(0, 7)}-01`;
    const start = mondayOf(first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view, anchor, sunday]);

  const from = days[0]!;
  const to = addDays(view === 'week' ? addDays(mondayOf(anchor), 6) : days.at(-1)!, 1);
  const { data, error, reload } = useApi<Appt[]>(`/agenda?from=${toInstant(from, '00:00')}&to=${toInstant(to, '00:00')}`);
  const { data: responses, reload: reloadResponses } = useApi<any[]>('/agenda/responses');
  // As pacientes respondem pelo link a qualquer momento: atualiza sozinho a cada minuto e ao voltar para a aba.
  useEffect(() => {
    const refresh = () => (void reload(), void reloadResponses());
    const t = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => (clearInterval(t), window.removeEventListener('focus', refresh));
  }, [reload, reloadResponses]);
  const handled = useAction();
  const appts = (data ?? []).filter((a) => showCanceled || a.status !== 'CANCELED');
  const byDay = useMemo(() => {
    const m = new Map<string, Appt[]>();
    for (const a of appts) m.set(spDayOf(a.scheduledFor), [...(m.get(spDayOf(a.scheduledFor)) ?? []), a]);
    return m;
  }, [appts]);

  useEffect(() => {
    if (view !== 'month' && scroller.current) scroller.current.scrollTop = (8 - START_HOUR) * HOUR_PX - 4;
  }, [view]);

  const step = (n: number) => setAnchor((d) => (view === 'day' ? addDays(d, n) : view === 'week' ? addDays(d, 7 * n) : `${new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)}-01`));
  const title =
    view === 'day'
      ? cap(label(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
      : view === 'week'
        ? `${label(days[0]!, { day: 'numeric', month: 'short' })} – ${label(addDays(mondayOf(anchor), sunday ? 6 : 5), { day: 'numeric', month: 'short', year: 'numeric' })}`
        : cap(label(`${anchor.slice(0, 7)}-15`, { month: 'long', year: 'numeric' }));
  const today = todaySP();
  const nowMin = Math.floor((now / 60_000 - OFFSET) % 1440 + 1440) % 1440;
  const close = (changed: boolean) => {
    setCreating(null);
    setSelected(null);
    if (changed) (void reload(), void reloadResponses());
  };
  const counts = {
    total: appts.filter((a) => a.status !== 'CANCELED').length,
    toConfirm: appts.filter((a) => a.status === 'SCHEDULED' && new Date(a.scheduledFor).getTime() > now).length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Agenda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.total} agendamento(s) no período{counts.toConfirm ? ` · ${counts.toConfirm} a confirmar` : ''}. Clique num horário livre para marcar.
          </p>
        </div>
        <Button variant="gold" onClick={() => setCreating({ day: anchor < today ? today : anchor, time: '09:00' })}>
          <Plus /> Novo agendamento
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>
          Hoje
        </Button>
        <Button variant="outline" size="icon" className="size-8" aria-label="Anterior" onClick={() => step(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" className="size-8" aria-label="Próximo" onClick={() => step(1)}>
          <ChevronRight />
        </Button>
        <span className="text-lg font-medium text-navy-800">{title}</span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {view === 'week' && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-4 accent-navy-700" checked={sunday} onChange={(e) => setSunday(e.target.checked)} />
              Domingo
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-navy-700" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} />
            Mostrar cancelados
          </label>
          <div className="inline-flex rounded-lg bg-secondary p-1">
            {(
              [
                ['day', 'Dia'],
                ['week', 'Semana'],
                ['month', 'Mês'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={cn('rounded-md px-3 py-1 text-sm font-medium', view === k ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground')}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ErrorText>{error}</ErrorText>

      {responses && responses.length > 0 && (
        <div className="rounded-lg border bg-background">
          <p className="border-b px-4 py-2 text-sm font-medium text-navy-800">Respostas das pacientes pelo link</p>
          <div className="divide-y">
            {responses.map((r) => (
              <div key={r.id} className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm', r.pending && 'bg-amber-50')}>
                <div>
                  <span className="font-medium">{r.name ?? phone(r.waId)}</span>{' '}
                  <span className={cn(r.response === 'CONFIRMED' ? 'text-emerald-700' : r.response === 'CANCELED' ? 'text-red-700' : 'text-amber-800')}>
                    · {RESPONSE[r.response]}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}
                    · horário de {new Date(r.scheduledFor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {r.procedureName ? ` (${r.procedureName})` : ''}
                  </span>
                  {r.note && <p className="text-xs text-muted-foreground">“{r.note}”</p>}
                </div>
                {r.pending && (
                  <div className="flex flex-wrap gap-1">
                    <MessageButton waId={r.waId} use="GENERAL" label="Falar" vars={{ nome: r.name, procedimento: r.procedureName }} />
                    <Button size="sm" variant="gold" onClick={() => setCreating({ day: today, time: '09:00', leadId: r.leadId, name: r.name ?? undefined })}>
                      <CalendarCheck /> Marcar novo horário
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={handled.busy}
                      onClick={() =>
                        handled.run(async () => {
                          await api(`/appointments/${r.id}/reschedule-handled`, { method: 'POST' });
                          await reloadResponses();
                        })
                      }
                    >
                      Resolvido
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view !== 'month' ? (
        <div ref={scroller} className="max-h-[72vh] overflow-y-auto rounded-lg border bg-background">
          {/* Cabeçalho dos dias (fixo no topo, na mesma rolagem da grade: colunas sempre alinhadas) */}
          <div className="sticky top-0 z-30 grid border-b bg-background" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((d) => (
              <button
                key={d}
                onClick={() => (setAnchor(d), setView('day'))}
                className={cn('border-l px-2 py-2 text-center hover:bg-secondary/60', d === today && 'bg-gold-50')}
              >
                <p className="text-xs uppercase text-muted-foreground">{label(d, { weekday: 'short' }).replace('.', '')}</p>
                <p className={cn('text-lg font-semibold', d === today ? 'text-gold-700' : 'text-navy-800')}>{label(d, { day: 'numeric' })}</p>
                <p className="text-[11px] text-muted-foreground">{(byDay.get(d) ?? []).filter((a) => a.status !== 'CANCELED').length || ''}</p>
              </button>
            ))}
          </div>
          {/* Grade de horários */}
          <div className="pt-2">
            <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`, height: (END_HOUR - START_HOUR) * HOUR_PX }}>
              <div className="relative">
                {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                  <span key={i} className="absolute right-2 -translate-y-2 text-[11px] text-muted-foreground" style={{ top: i * HOUR_PX }}>
                    {i ? `${START_HOUR + i}:00` : ''}
                  </span>
                ))}
              </div>
              {days.map((d) => (
                <div key={d} className={cn('relative border-l', d === today && 'bg-gold-50/30')}>
                  {/* Linhas e áreas clicáveis de 30 em 30 min */}
                  {Array.from({ length: (END_HOUR - START_HOUR) * 2 }, (_, i) => (
                    <button
                      key={i}
                      aria-label={`Agendar ${label(d, { day: 'numeric', month: 'short' })} às ${hhmm(START_HOUR * 60 + i * 30)}`}
                      onClick={() => setCreating({ day: d, time: hhmm(START_HOUR * 60 + i * 30) })}
                      className={cn('absolute inset-x-0 hover:bg-navy-50/60', i % 2 ? 'border-t border-dashed border-slate-100' : 'border-t border-slate-200')}
                      style={{ top: (i * HOUR_PX) / 2, height: HOUR_PX / 2 }}
                    />
                  ))}
                  {d === today && nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60 && (
                    <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: ((nowMin - START_HOUR * 60) / 60) * HOUR_PX }}>
                      <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-red-500" />
                    </div>
                  )}
                  {layout(byDay.get(d) ?? []).map(({ a, start, end, col, cols }) => {
                    const top = Math.max(0, ((start - START_HOUR * 60) / 60) * HOUR_PX);
                    const height = Math.max(22, ((Math.min(end, END_HOUR * 60) - Math.max(start, START_HOUR * 60)) / 60) * HOUR_PX - 2);
                    const st = STATUS[a.status] ?? STATUS.SCHEDULED!;
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelected(a)}
                        className={cn('absolute z-10 overflow-hidden rounded-md border border-l-4 px-1.5 py-0.5 text-left text-xs shadow-sm hover:shadow', st.block)}
                        style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                        title={`${hhmm(start)} ${a.name ?? ''} · ${a.procedureName ?? ''} · ${st.label}`}
                      >
                        <p className="truncate font-semibold">
                          {a.patientResponse === 'CONFIRMED' && '✓ '}
                          {hhmm(start)} {a.name ?? phone(a.waId)}
                        </p>
                        {height > 34 && <p className="truncate opacity-80">{a.procedureName ?? 'Avaliação'}</p>}
                        {height > 50 && <p className="truncate opacity-70">{st.label}</p>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <div className="grid grid-cols-7 border-b text-center text-xs uppercase text-muted-foreground">
            {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = (byDay.get(d) ?? []).sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor));
              const other = d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <div key={d} className={cn('min-h-[110px] border-b border-l p-1.5', other && 'bg-secondary/30', d === today && 'bg-gold-50')}>
                  <button className={cn('mb-1 text-sm font-medium hover:underline', other ? 'text-muted-foreground' : 'text-navy-800')} onClick={() => (setAnchor(d), setView('day'))}>
                    {label(d, { day: 'numeric' })}
                  </button>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setSelected(a)}
                        className={cn('block w-full truncate rounded border-l-2 px-1 text-left text-[11px]', (STATUS[a.status] ?? STATUS.SCHEDULED!).block)}
                      >
                        {hhmm(spMinutes(a.scheduledFor))} {a.name ?? ''}
                      </button>
                    ))}
                    {list.length > 3 && (
                      <button className="text-[11px] text-navy-600 hover:underline" onClick={() => (setAnchor(d), setView('day'))}>
                        + {list.length - 3} mais
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {Object.entries(STATUS).map(([k, s]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn('inline-block h-3 w-3 rounded-sm border border-l-4', s.block)} /> {s.label}
          </span>
        ))}
      </div>

      <Dialog open={!!creating} onOpenChange={(v) => !v && setCreating(null)}>
        {creating && <NewAppointment key={`${creating.day}${creating.time}${creating.leadId}`} init={creating} appts={data ?? []} procedures={procedures ?? []} onDone={close} />}
      </Dialog>
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        {selected && <AppointmentDetails key={selected.id} a={selected} appts={data ?? []} procedures={procedures ?? []} onDone={close} />}
      </Dialog>
    </div>
  );
}
