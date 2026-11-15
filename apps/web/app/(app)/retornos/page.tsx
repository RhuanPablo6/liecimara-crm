'use client';

import { CalendarPlus, Check, Clock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { MessageButton } from '@/components/message-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { dateTime, num, phone } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'returns' | 'reactivation' | 'confirm' | 'postcare' | 'templates';

const fmtDay = (d: string) => d.split('-').reverse().join('/');
const time = (d: string) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dayOf = (d: string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function PatientCell({ r }: { r: any }) {
  return (
    <div>
      <Link href={`/pacientes/${r.contactId}`} className="font-medium text-navy-800 hover:underline">
        {r.name ?? phone(r.waId)}
      </Link>
      <p className="text-xs text-muted-foreground">
        {phone(r.waId)}
        {r.lastContactedAt && ` · contatada em ${dayOf(r.lastContactedAt)}`}
      </p>
    </div>
  );
}

/** Contatado / adiar / não quer: tira da lista pelo tempo escolhido. */
function RowActions({ r, onDone }: { r: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const act = (kind: 'CONTACTED' | 'SNOOZED' | 'DISMISSED', days?: number) =>
    run(async () => {
      await api('/recalls/actions', { method: 'POST', body: { contactId: r.contactId, dueKey: r.dueKey, kind, days } });
      onDone();
    });
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <MessageButton
        waId={r.waId}
        use={r.dueKey?.startsWith('reactivation') ? 'REACTIVATION' : 'RETURN'}
        variant="gold"
        label="Mensagem"
        vars={{ nome: r.name, procedimento: r.procedureName, ultima_vez: r.lastDay ? fmtDay(r.lastDay) : null }}
        onSent={() => void act('CONTACTED', 3)}
      />
      {r.leadId && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/leads/${r.leadId}`}>
            <CalendarPlus /> Agendar
          </Link>
        </Button>
      )}
      <NativeSelect
        aria-label="Adiar"
        className="h-8 w-28 py-0 text-xs"
        value=""
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'no') void act('DISMISSED');
          else if (v) void act('SNOOZED', Number(v));
        }}
      >
        <option value="">Adiar…</option>
        <option value="7">7 dias</option>
        <option value="30">30 dias</option>
        <option value="60">60 dias</option>
        <option value="90">90 dias</option>
        <option value="no">Não quer agora</option>
      </NativeSelect>
    </div>
  );
}

function ReturnsList({ data, onDone }: { data: any; onDone: () => void }) {
  if (!data.returns.length)
    return <p className="text-sm text-muted-foreground">Nenhuma paciente para retorno neste período. 🎉</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Paciente</th>
            <th className="py-2 pr-3 font-medium">Procedimento</th>
            <th className="py-2 pr-3 font-medium">Última vez</th>
            <th className="py-2 pr-3 font-medium">Retorno</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.returns.map((r: any) => (
            <tr key={r.dueKey + r.contactId} className="border-t">
              <td className="py-2 pr-3">
                <PatientCell r={r} />
              </td>
              <td className="py-2 pr-3">{r.procedureName}</td>
              <td className="whitespace-nowrap py-2 pr-3">{fmtDay(r.lastDay)}</td>
              <td className="whitespace-nowrap py-2 pr-3">
                {fmtDay(r.dueDay)}
                <div>
                  {r.status === 'UPCOMING' ? (
                    <Badge variant="secondary">em {num(-r.daysLate)} dia(s)</Badge>
                  ) : r.status === 'DUE' ? (
                    <Badge variant="warning">{r.daysLate === 0 ? 'hoje' : `há ${num(r.daysLate)} dia(s)`}</Badge>
                  ) : (
                    <Badge variant="danger">atrasado {num(r.daysLate)} dias</Badge>
                  )}
                </div>
              </td>
              <td className="py-2">
                <RowActions r={r} onDone={onDone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReactivationList({ data, onDone }: { data: any; onDone: () => void }) {
  if (!data.reactivation.length) return <p className="text-sm text-muted-foreground">Nenhuma paciente sumida há mais de 6 meses.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Paciente</th>
            <th className="py-2 pr-3 font-medium">Último procedimento</th>
            <th className="py-2 pr-3 font-medium">Última visita</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.reactivation.map((r: any) => (
            <tr key={r.contactId} className="border-t">
              <td className="py-2 pr-3">
                <PatientCell r={r} />
              </td>
              <td className="py-2 pr-3">{r.procedureName ?? '—'}</td>
              <td className="whitespace-nowrap py-2 pr-3">
                {fmtDay(r.lastDay)}
                <p className="text-xs text-muted-foreground">há {num(Math.round(r.daysSince / 30))} meses</p>
              </td>
              <td className="py-2">
                <RowActions r={r} onDone={onDone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApptList({ rows, kind, onDone }: { rows: any[]; kind: 'confirm' | 'postcare'; onDone: () => void }) {
  const act = useAction();
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">{kind === 'confirm' ? 'Nenhum agendamento para amanhã.' : 'Nenhum atendimento ontem ou hoje.'}</p>;
  return (
    <div className="space-y-2">
      <ErrorText>{act.error}</ErrorText>
      {rows.map((a) => (
        <div key={a.appointmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="flex items-center gap-4">
            <div className="w-24 text-sm">
              <p className="font-medium">{kind === 'confirm' ? time(a.scheduledFor) : dayOf(a.scheduledFor)}</p>
              {kind === 'confirm' && (a.status === 'CONFIRMED' ? <Badge variant="success">Confirmado</Badge> : <Badge variant="warning">A confirmar</Badge>)}
            </div>
            <div>
              <PatientCell r={a} />
              <p className="text-xs text-muted-foreground">{a.procedureName ?? 'Procedimento não informado'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <MessageButton
              waId={a.waId}
              use={kind === 'confirm' ? 'CONFIRM' : 'POSTCARE'}
              variant="gold"
              label={kind === 'confirm' ? 'Confirmar pelo WhatsApp' : 'Mensagem de cuidado'}
              vars={{ nome: a.name, procedimento: a.procedureName, data: dayOf(a.scheduledFor), hora: time(a.scheduledFor) }}
            />
            {kind === 'confirm' && a.status !== 'CONFIRMED' && (
              <Button
                size="sm"
                variant="outline"
                disabled={act.busy}
                onClick={() =>
                  act.run(async () => {
                    await api(`/appointments/${a.appointmentId}/status`, { method: 'POST', body: { status: 'CONFIRMED' } });
                    onDone();
                  })
                }
              >
                <Check /> Paciente confirmou
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const USES: [string, string][] = [
  ['RETURN', 'Retorno'],
  ['REACTIVATION', 'Reativação'],
  ['CONFIRM', 'Confirmação'],
  ['POSTCARE', 'Pós-procedimento'],
  ['CHARGE', 'Cobrança'],
  ['GENERAL', 'Geral'],
];
const PLACEHOLDERS: [string, string][] = [
  ['{primeiro_nome}', 'primeiro nome'],
  ['{nome}', 'nome completo'],
  ['{procedimento}', 'procedimento'],
  ['{ultima_vez}', 'data da última vez'],
  ['{data}', 'data do agendamento'],
  ['{hora}', 'hora'],
  ['{valor}', 'valor (cobrança)'],
  ['{clinica}', 'nome da clínica'],
];

function TemplatesEditor() {
  const { data, reload } = useApi<any>('/messages/templates');
  return data ? <TemplatesForm key={JSON.stringify(data.templates)} data={data} onSaved={reload} /> : <p className="text-sm text-muted-foreground">Carregando…</p>;
}

function TemplatesForm({ data, onSaved }: { data: any; onSaved: () => void }) {
  const [clinicName, setClinicName] = useState<string>(data.clinicName);
  const [items, setItems] = useState<any[]>(data.templates);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (i: number, patch: any) => (setSaved(false), setItems((cur) => cur.map((t, idx) => (idx === i ? { ...t, ...patch } : t))));
  return (
    <div className="space-y-4">
      <Field label="Nome da clínica nas mensagens">
        <Input className="max-w-md" value={clinicName} onChange={(e) => (setSaved(false), setClinicName(e.target.value))} />
      </Field>
      <div className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
        Campos que o CRM preenche sozinho:{' '}
        {PLACEHOLDERS.map(([k, v]) => (
          <span key={k} className="mr-3 inline-block">
            <code className="text-navy-800">{k}</code> {v}
          </span>
        ))}
      </div>
      {items.map((t, i) => (
        <Card key={t.id}>
          <CardContent className="space-y-3 pt-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
              <Input aria-label="Nome do modelo" value={t.name} onChange={(e) => set(i, { name: e.target.value })} />
              <NativeSelect aria-label="Usar em" value={t.use} onChange={(e) => set(i, { use: e.target.value })}>
                {USES.map(([k, v]) => (
                  <option key={k} value={k}>
                    Usar em: {v}
                  </option>
                ))}
              </NativeSelect>
              <Button size="icon" variant="ghost" aria-label="Excluir modelo" onClick={() => (setSaved(false), setItems((cur) => cur.filter((_, idx) => idx !== i)))}>
                <Trash2 />
              </Button>
            </div>
            <Textarea className="min-h-[90px]" value={t.body} onChange={(e) => set(i, { body: e.target.value })} />
          </CardContent>
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => (setSaved(false), setItems((cur) => [...cur, { id: `t${Date.now()}`, name: 'Novo modelo', use: 'GENERAL', body: 'Oi, {primeiro_nome}! ' }]))}
        >
          <Plus /> Novo modelo
        </Button>
        <Button variant="ghost" onClick={() => (setSaved(false), setItems(data.defaults.templates), setClinicName(data.defaults.clinicName))}>
          <RotateCcw /> Restaurar modelos sugeridos
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-3">
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api('/messages/templates', { method: 'PUT', body: { clinicName, templates: items } });
              setSaved(true);
              onSaved();
            })
          }
        >
          Salvar mensagens
        </Button>
        {saved && <span className="text-sm text-emerald-700">Salvo.</span>}
      </div>
    </div>
  );
}

export default function RecallsPage() {
  const [tab, setTab] = useState<Tab>('returns');
  const [horizon, setHorizon] = useState('14');
  const { data, error, reload } = useApi<any>(`/recalls?horizonDays=${horizon}`);
  const s = data?.summary;
  const tabs: [Tab, string, number | null][] = [
    ['returns', 'Retornos', s ? s.returnsDue + s.returnsUpcoming : null],
    ['reactivation', 'Reativação', s?.reactivation ?? null],
    ['confirm', 'Confirmar amanhã', data?.confirmTomorrow.length ?? null],
    ['postcare', 'Pós-procedimento', s?.postCare ?? null],
    ['templates', 'Mensagens prontas', null],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-navy-800">Retornos</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Quem está na hora de voltar, quem sumiu, quem confirmar amanhã e quem atendemos ontem, com mensagem pronta para o WhatsApp em um clique.
        </p>
      </div>

      {s && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Retorno vencido', s.returnsDue, 'Pacientes que já passaram da data', s.returnsDue ? 'text-amber-700' : ''],
            [`Retorno nos próximos ${horizon} dias`, s.returnsUpcoming, 'Avise antes de vencer', ''],
            ['Para reativar', s.reactivation, 'Sem vir há 6 meses ou mais', ''],
            ['Confirmar amanhã', s.confirmTomorrow, 'Agendamentos ainda não confirmados', s.confirmTomorrow ? 'text-amber-700' : ''],
          ].map(([label, value, hint, tone]) => (
            <Card key={label as string}>
              <CardContent className="pt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={cn('mt-1 text-2xl font-semibold tabular-nums text-navy-800', tone)}>{num(value as number)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-lg bg-secondary p-1" role="tablist">
          {tabs.map(([k, l, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                tab === k ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground hover:text-navy-700',
              )}
            >
              {l}
              {n != null && n > 0 && <span className="ml-1.5 rounded-full bg-navy-700 px-1.5 text-xs text-white">{n}</span>}
            </button>
          ))}
        </div>
        {tab === 'returns' && (
          <NativeSelect aria-label="Mostrar retornos" className="w-56" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
            <option value="0">Só os vencidos</option>
            <option value="7">Vencidos + próximos 7 dias</option>
            <option value="14">Vencidos + próximos 14 dias</option>
            <option value="30">Vencidos + próximos 30 dias</option>
          </NativeSelect>
        )}
      </div>
      <ErrorText>{error}</ErrorText>

      {tab !== 'templates' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gold-500" />
              {tabs.find(([k]) => k === tab)?.[1]}
            </CardTitle>
            <CardDescription>
              {tab === 'returns' &&
                'Data da última vez + intervalo de retorno do procedimento (ajuste em Financeiro → Procedimentos). Quem já tem horário marcado não aparece.'}
              {tab === 'reactivation' && 'Pacientes sem compra ou visita há 6 meses ou mais, sem horário marcado.'}
              {tab === 'confirm' && 'Agendamentos de amanhã. Envie a confirmação e marque quando a paciente responder.'}
              {tab === 'postcare' && 'Atendimentos de ontem e de hoje (marcados como "Compareceu"): um cuidado que fideliza.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!data && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {data && tab === 'returns' && <ReturnsList data={data} onDone={reload} />}
            {data && tab === 'reactivation' && <ReactivationList data={data} onDone={reload} />}
            {data && tab === 'confirm' && <ApptList rows={data.confirmTomorrow} kind="confirm" onDone={reload} />}
            {data && tab === 'postcare' && <ApptList rows={data.postCare} kind="postcare" onDone={reload} />}
          </CardContent>
        </Card>
      )}
      {tab === 'templates' && <TemplatesEditor />}
      {tab !== 'templates' && (
        <p className="text-xs text-muted-foreground">
          Ao abrir a mensagem pelo botão, a paciente sai da lista por 3 dias (marcada como contatada). Use "Adiar" para outros prazos.
        </p>
      )}
    </div>
  );
}
