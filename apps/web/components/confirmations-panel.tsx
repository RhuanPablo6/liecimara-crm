'use client';

// "Confirmações do dia": todas as pacientes de amanhã numa lista. Um clique abre o WhatsApp da clínica
// com a mensagem e o link prontos; a paciente responde pelo link e a Agenda atualiza sozinha.
import { CalendarCheck, CalendarClock, CalendarX, Check, ChevronLeft, ChevronRight, Clock, MessageCircle, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fillTemplate, waLink } from '@/components/message-button';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Textarea } from '@/components/ui/form';
import { api, useApi } from '@/lib/api';
import { phone } from '@/lib/format';
import { cn } from '@/lib/utils';

const TZ = 'America/Sao_Paulo';
const spDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const ddmm = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const dayTitle = (day: string) => {
  const t = spDay();
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const prefix = day === t ? 'Hoje' : day === addDays(t, 1) ? 'Amanhã' : null;
  return prefix ? `${prefix}, ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
};
const DEFAULT_TEXT =
  'Olá, {primeiro_nome}! Aqui é da {clinica}. 💛 Passando para confirmar seu horário de {procedimento} no dia {data} às {hora}.\n\nToque no link para confirmar, remarcar ou desmarcar: {link}';

type Row = {
  id: string;
  leadId: string;
  name: string | null;
  waId: string | null;
  scheduledFor: string;
  procedureName: string | null;
  status: string;
  patientResponse: string | null;
  patientResponseAt: string | null;
  patientNote: string | null;
  linkSentAt: string | null;
  whatsappSentAt: string | null;
  token: string;
};

function state(r: Row): { key: 'confirmed' | 'reschedule' | 'canceled' | 'waiting' | 'pending' | 'done'; label: string; cls: string; icon: typeof Check } {
  if (r.status === 'ATTENDED' || r.status === 'NO_SHOW') return { key: 'done', label: r.status === 'ATTENDED' ? 'Compareceu' : 'Faltou', cls: 'bg-slate-100 text-slate-700', icon: Check };
  if (r.patientResponse === 'RESCHEDULE') return { key: 'reschedule', label: 'Pediu para remarcar', cls: 'bg-amber-50 text-amber-800', icon: CalendarClock };
  if (r.status === 'CANCELED' || r.patientResponse === 'CANCELED') return { key: 'canceled', label: 'Desmarcou', cls: 'bg-red-50 text-red-800', icon: CalendarX };
  if (r.status === 'CONFIRMED') return { key: 'confirmed', label: 'Confirmou', cls: 'bg-emerald-50 text-emerald-800', icon: CalendarCheck };
  if (r.linkSentAt || r.whatsappSentAt) return { key: 'waiting', label: 'Aguardando resposta', cls: 'bg-sky-50 text-sky-800', icon: Clock };
  return { key: 'pending', label: 'Não enviada', cls: 'bg-secondary text-muted-foreground', icon: Send };
}

export function ConfirmationsPanel({ onChanged }: { onChanged: () => void }) {
  const [day, setDay] = useState(addDays(spDay(), 1));
  const [v, setV] = useState(0);
  const { data: rows, error } = useApi<Row[]>(`/agenda/confirmations?day=${day}&v=${v}`);
  const { data: tpl } = useApi<any>('/messages/templates');
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Atualiza sozinho para mostrar as respostas que chegam pelo link.
  useEffect(() => {
    const t = setInterval(() => setV((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const template = useMemo(() => {
    if (text != null) return text;
    const t = (tpl?.templates ?? []).find((x: any) => x.use === 'CONFIRM');
    const body: string = t?.body ?? DEFAULT_TEXT;
    return body.includes('{link}') ? body : `${body}\n\nConfirme, desmarque ou remarque por aqui: {link}`;
  }, [tpl, text]);

  const messageFor = (r: Row) =>
    fillTemplate(
      template,
      { nome: r.name, procedimento: r.procedureName ?? 'avaliação', data: ddmm(r.scheduledFor), hora: hhmm(r.scheduledFor), link: `${window.location.origin}/c/${r.token}` },
      tpl?.clinicName ?? 'clínica',
    );

  const send = async (r: Row) => {
    if (!r.waId) return;
    // Abre já (antes do await) para o navegador não bloquear a nova aba.
    window.open(waLink(r.waId, messageFor(r)), '_blank', 'noopener');
    try {
      await api(`/appointments/${r.id}/confirmation-link-sent`, { method: 'POST' });
      setV((x) => x + 1);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const markConfirmed = async (r: Row) => {
    try {
      await api(`/appointments/${r.id}/status`, { method: 'POST', body: { status: 'CONFIRMED' } });
      setV((x) => x + 1);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const list = rows ?? [];
  const open = list.filter((r) => r.status === 'SCHEDULED' || r.status === 'CONFIRMED' || r.patientResponse);
  const counts = {
    total: open.length,
    pending: open.filter((r) => state(r).key === 'pending').length,
    waiting: open.filter((r) => state(r).key === 'waiting').length,
    confirmed: open.filter((r) => state(r).key === 'confirmed').length,
    issues: open.filter((r) => ['reschedule', 'canceled'].includes(state(r).key)).length,
  };
  const next = list.find((r) => state(r).key === 'pending' && r.waId);

  return (
    <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Confirmações</DialogTitle>
        <DialogDescription>
          Um clique abre o WhatsApp da clínica com a mensagem pronta; é só apertar enviar. A paciente responde pelo link e a Agenda atualiza sozinha.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setDay(addDays(day, -1))} aria-label="Dia anterior">
            <ChevronLeft />
          </Button>
          <span className="min-w-56 text-center text-sm font-medium">{dayTitle(day)}</span>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setDay(addDays(day, 1))} aria-label="Próximo dia">
            <ChevronRight />
          </Button>
        </div>
        {next && (
          <Button variant="gold" size="sm" onClick={() => send(next)}>
            <Send /> Enviar para a próxima ({next.name?.split(' ')[0] ?? phone(next.waId)})
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-secondary px-2.5 py-1">{counts.total} horário(s)</span>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">{counts.pending} a enviar</span>
        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-800">{counts.waiting} aguardando</span>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">{counts.confirmed} confirmaram</span>
        {counts.issues > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{counts.issues} remarcar/desmarcou</span>}
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      {!rows && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {rows && list.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum horário nesse dia.</p>}

      <div className="divide-y rounded-lg border">
        {list.map((r) => {
          const s = state(r);
          const Icon = s.icon;
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="w-12 font-semibold tabular-nums">{hhmm(r.scheduledFor)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name ?? 'Sem nome'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.procedureName ?? 'Avaliação'} · {phone(r.waId)}
                  {r.patientNote && <span className="text-amber-700"> · “{r.patientNote}”</span>}
                </p>
              </div>
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>
                <Icon className="size-3.5" /> {s.label}
                {s.key === 'waiting' && r.linkSentAt && <span className="font-normal opacity-80">· {hhmm(r.linkSentAt)}</span>}
              </span>
              <div className="flex gap-1">
                {(s.key === 'pending' || s.key === 'waiting') && r.waId && (
                  <Button size="sm" variant={s.key === 'pending' ? 'gold' : 'outline'} onClick={() => send(r)}>
                    <MessageCircle /> {s.key === 'pending' ? 'Enviar' : 'Reenviar'}
                  </Button>
                )}
                {s.key === 'waiting' && (
                  <Button size="sm" variant="ghost" title="A paciente respondeu por mensagem que confirma" onClick={() => markConfirmed(r)}>
                    <Check /> Confirmou
                  </Button>
                )}
                {!r.waId && <span className="text-xs text-muted-foreground">sem WhatsApp</span>}
              </div>
            </div>
          );
        })}
      </div>
      <ErrorText>{err}</ErrorText>

      <div className="space-y-2 rounded-lg bg-secondary/50 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">Mensagem</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing((x) => !x)}>
            {editing ? 'Fechar' : 'Ajustar texto'}
          </Button>
        </div>
        {editing ? (
          <>
            <Textarea className="min-h-[120px]" value={template} onChange={(e) => setText(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Use {'{primeiro_nome}'}, {'{procedimento}'}, {'{data}'}, {'{hora}'} e {'{link}'}. Vale para esta lista; o modelo fixo fica em Retornos → Mensagens.
            </p>
          </>
        ) : (
          <p className="whitespace-pre-line text-xs text-muted-foreground">
            {list[0] ? messageFor(list[0]) : template}
          </p>
        )}
      </div>
    </DialogContent>
  );
}
