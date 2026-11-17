'use client';

import { ArrowLeft, Bell, CalendarPlus, CheckCircle2, CircleDollarSign, Link2, Megaphone, MessageCircle, Trash2, Undo2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { ConfidenceBadge, LOST_REASONS, StageBadge, STAGES } from '@/components/badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { MessageButton } from '@/components/message-button';
import { ORGANIC_ORIGINS, ORIGIN_LABEL, ORIGIN_NOTE_HINT } from '@/lib/origins';
import { PatientTagControl } from '@/components/patient-tag';
import { brl, date, dateTime, parseBRL, phone } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '@/components/confirm-button';
import { PurgeButton } from '@/components/purge-dialog';
import { AppointmentSaleFields, type SalePayload } from '@/components/appointment-sale-fields';
import { EditNameButton } from '@/components/edit-name';
import { useMe } from '@/components/access';

const METHODS = [
  ['PIX', 'Pix'],
  ['CREDIT_CARD', 'Crédito'],
  ['DEBIT_CARD', 'Débito'],
  ['CASH', 'Dinheiro'],
  ['BANK_TRANSFER', 'Transferência'],
] as const;

function Chips<T extends string>({ options, value, onChange }: { options: readonly (readonly [T, string])[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'rounded-full border px-3 py-1 text-sm transition-colors',
            value === v ? 'border-navy-700 bg-navy-700 text-white' : 'hover:border-navy-300 hover:bg-secondary',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Datas rápidas: hoje/amanhã/+2… com horário em blocos de 30 min. */
function QuickDateTime({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
  const [day, setDay] = useState(0);
  const [time, setTime] = useState('09:00');
  const apply = (di: number, t: string) => {
    const d = new Date(days[di]!);
    const [h, m] = t.split(':').map(Number);
    d.setHours(h!, m!, 0, 0);
    onChange(d.toISOString());
  };
  const times = Array.from({ length: 23 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  return (
    <div className="space-y-2">
      <Chips
        options={days.map((d, i) => [String(i), i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })] as const)}
        value={String(day)}
        onChange={(v) => (setDay(Number(v)), apply(Number(v), time))}
      />
      <NativeSelect value={time} onChange={(e) => (setTime(e.target.value), apply(day, e.target.value))}>
        {times.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </NativeSelect>
      {value && <p className="text-xs text-muted-foreground">{dateTime(value)}</p>}
    </div>
  );
}

function ActionDialog({ trigger, title, children }: { trigger: React.ReactNode; title: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}

const APPT_LABEL: Record<string, string> = { SCHEDULED: 'Agendado', CONFIRMED: 'Confirmado', ATTENDED: 'Compareceu', NO_SHOW: 'Faltou' };

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, reload } = useApi(`/leads/${id}`);
  const { data: procedures } = useApi<any[]>('/procedures');
  const { data: ads } = useApi<any[]>('/ads');
  const act = useAction();

  // Estados dos formulários rápidos
  const [apptAt, setApptAt] = useState('');
  const [apptProc, setApptProc] = useState<string | null>(null);
  const [apptSale, setApptSale] = useState<SalePayload>(null);
  const [apptSaleErr, setApptSaleErr] = useState<string | null>(null);
  const me = useMe();
  const canSell = !!me?.permissions.includes('sales:write');
  const canPay = !!me?.permissions.includes('payments:write');
  const [saleProc, setSaleProc] = useState('');
  const [saleValue, setSaleValue] = useState('');
  const [saleAd, setSaleAd] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [payValue, setPayValue] = useState('');
  const [payMethod, setPayMethod] = useState<(typeof METHODS)[number][0] | null>('PIX');
  const [lostReason, setLostReason] = useState<string | null>(null);
  const [lostNote, setLostNote] = useState('');
  const [remDays, setRemDays] = useState<string | null>('1');
  const [remNote, setRemNote] = useState('Retornar contato');
  const [attrAd, setAttrAd] = useState('');
  const [attrNote, setAttrNote] = useState('');
  const [orgType, setOrgType] = useState('');
  const [orgNote, setOrgNote] = useState('');

  if (!data) return <p className="text-muted-foreground">Carregando…</p>;
  const { lead, contact, ad, evidence, appointments, sales, performed, reminders, messages } = data;
  const procName = (pid: string | null) => procedures?.find((p) => p.id === pid)?.name ?? '—';
  // Vendas ainda em uso (saldo ou procedimento não realizado): o novo horário pode usar a mesma venda.
  const openSales = (sales as any[])
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({
      id: s.id,
      procedureId: s.procedureId,
      procedureName: procName(s.procedureId),
      amountCents: s.amountCents,
      paidCents: s.paidCents,
      balanceCents: Math.max(0, s.amountCents - s.paidCents),
      performed: performed.some((p: any) => p.saleId === s.id),
      linkedAppointments: appointments.filter((a: any) => a.saleId === s.id && a.status !== 'CANCELED').length,
    }))
    .filter((s) => s.balanceCents > 0 || !s.performed);
  const nextAppt = (appointments as any[]).find((a) => (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && a.procedureId);

  const call = (fn: () => Promise<unknown>, close?: () => void) =>
    act.run(async () => {
      await fn();
      close?.();
      await reload();
    });

  const openStages = STAGES.filter((s) => ['NEW', 'CONTACTED', 'SCHEDULED', 'ATTENDED'].includes(s.value));

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-navy-700">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-1 text-3xl font-semibold text-navy-800">
            {contact?.name ?? contact?.profileName ?? 'Sem nome'}
            {contact?.id && <EditNameButton contactId={contact.id} name={contact?.name ?? contact?.profileName ?? null} onSaved={() => void reload()} />}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{phone(contact?.waId)}</span>
            {contact?.waId && (
              <a className="inline-flex items-center gap-1 text-navy-600 hover:underline" href={`https://wa.me/${contact.waId}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-3.5 w-3.5" /> Abrir no WhatsApp
              </a>
            )}
            {contact?.preExisting && <Badge variant="secondary">Paciente já cadastrado no app</Badge>}
            {contact?.id && (
              <PatientTagControl contactId={contact.id} tag={lead.patientTag} manual={lead.patientTagManual} onChanged={reload} />
            )}
            <MessageButton waId={contact?.waId} vars={{ nome: contact?.name ?? contact?.profileName, procedimento: lead.procedureInterest }} label="Mensagem pronta" />
            {contact?.id && (
              <Link className="text-navy-600 hover:underline" href={`/pacientes/${contact.id}`}>
                Ver histórico do paciente
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StageBadge stage={lead.stage} />
          {!lead.adMetaId && lead.originType ? (
            <Badge variant="secondary">Origem: {ORIGIN_LABEL[lead.originType] ?? lead.originType}</Badge>
          ) : (
            <ConfidenceBadge value={lead.attributionConfidence} long />
          )}
        </div>
      </div>

      <ErrorText>{act.error}</ErrorText>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Origem */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-gold-500" /> Origem
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {lead.adMetaId ? (
                <div className="rounded-md border border-gold-200 bg-gold-50/60 p-3">
                  <p className="font-medium text-navy-800">{ad?.name ?? lead.adName}</p>
                  <p className="text-xs text-muted-foreground">ID do anúncio {lead.adMetaId}</p>
                </div>
              ) : lead.originType ? (
                <div className="rounded-md border p-3">
                  <p className="font-medium text-navy-800">{ORIGIN_LABEL[lead.originType] ?? lead.originType}</p>
                  {lead.originNote && <p className="text-xs text-muted-foreground">{lead.originNote}</p>}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Origem não informada. Se o paciente veio de anúncio, de indicação ou de outro lugar, registre abaixo.
                </p>
              )}
              {evidence.length > 0 && (
                <ul className="space-y-1">
                  {evidence.map((e: any) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Link2 className="h-3 w-3" />
                      {e.kind === 'OFFICIAL_REFERRAL' ? 'Referência oficial do WhatsApp' : 'Informada manualmente'}
                      {e.sourceType === 'post' && ' (publicação, não anúncio)'} · {dateTime(e.occurredAt)}
                      {e.headline && <span>· “{e.headline}”</span>}
                      {e.note && <span>· {e.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {lead.attributionConfidence !== 'OFFICIAL_REFERRAL' && (
                <div className="flex flex-wrap gap-2">
                <ActionDialog
                  title="Não veio de anúncio"
                  trigger={
                    <Button size="sm" variant="outline">
                      {lead.originType ? 'Alterar origem' : 'Indicação ou outra origem'}
                    </Button>
                  }
                >
                  {(close) => (
                    <div className="space-y-4">
                      <Field label="Como o paciente chegou?">
                        <NativeSelect value={orgType} onChange={(e) => setOrgType(e.target.value)}>
                          <option value="">Selecione…</option>
                          {ORGANIC_ORIGINS.map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      {orgType && (
                        <Field label="Detalhe">
                          <Input placeholder={ORIGIN_NOTE_HINT[orgType]} value={orgNote} onChange={(e) => setOrgNote(e.target.value)} />
                        </Field>
                      )}
                      {lead.adMetaId && <p className="text-xs text-amber-700">O anúncio informado antes será removido deste lead.</p>}
                      <div className="flex gap-2">
                        <Button
                          disabled={!orgType || act.busy}
                          onClick={() => call(() => api(`/leads/${id}/origin`, { method: 'PUT', body: { type: orgType, note: orgNote || null } }), close)}
                        >
                          Salvar origem
                        </Button>
                        {lead.originType && (
                          <Button variant="ghost" disabled={act.busy} onClick={() => call(() => api(`/leads/${id}/origin`, { method: 'PUT', body: { type: null } }), close)}>
                            Limpar origem
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </ActionDialog>
                <ActionDialog
                  title="Informar anúncio de origem"
                  trigger={
                    <Button size="sm" variant="outline">
                      Veio de anúncio
                    </Button>
                  }
                >
                  {(close) => (
                    <div className="space-y-4">
                      <Field label="Anúncio">
                        <NativeSelect value={attrAd} onChange={(e) => setAttrAd(e.target.value)}>
                          <option value="">Selecione…</option>
                          {ads?.map((a) => (
                            <option key={a.metaId} value={a.metaId}>
                              {a.code ? `[${a.code}] ` : ''}
                              {a.name} — {a.campaignName}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Como foi confirmado?">
                        <Chips
                          options={[
                            ['Paciente mostrou o anúncio', 'Mostrou o anúncio'],
                            ['Paciente citou o anúncio na conversa', 'Citou na conversa'],
                            ['Paciente informou por telefone', 'Informou por telefone'],
                          ]}
                          value={attrNote}
                          onChange={setAttrNote}
                        />
                      </Field>
                      <Button disabled={!attrAd || !attrNote || act.busy} onClick={() => call(() => api(`/leads/${id}/attribution`, { method: 'POST', body: { adMetaId: attrAd, note: attrNote } }), close)}>
                        Registrar atribuição manual
                      </Button>
                    </div>
                  )}
                </ActionDialog>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Atendimento */}
          <Card>
            <CardHeader>
              <CardTitle>Atendimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Procedimento de interesse">
                <NativeSelect value={lead.procedureInterestId ?? ''} onChange={(e) => call(() => api(`/leads/${id}/procedure`, { method: 'PATCH', body: { procedureId: e.target.value || null } }))}>
                  <option value="">Não informado</option>
                  {procedures?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              {lead.stage !== 'WON' && (
                <Field label="Etapa comercial">
                  <div className="flex flex-wrap gap-2">
                    {openStages.map((s) => (
                      <Button
                        key={s.value}
                        size="sm"
                        variant={lead.stage === s.value ? 'default' : 'outline'}
                        disabled={act.busy}
                        onClick={() => call(() => api(`/leads/${id}/stage`, { method: 'PATCH', body: { stage: s.value } }))}
                      >
                        {s.label}
                      </Button>
                    ))}
                  </div>
                </Field>
              )}

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <ActionDialog
                  title="Registrar agendamento"
                  trigger={
                    <Button variant="outline" disabled={lead.stage === 'LOST'}>
                      <CalendarPlus /> Agendar
                    </Button>
                  }
                >
                  {(close) => (
                    <div className="space-y-4">
                      <QuickDateTime value={apptAt} onChange={setApptAt} />
                      <Field label="Procedimento">
                        <NativeSelect value={apptProc ?? lead.procedureInterestId ?? ''} onChange={(e) => setApptProc(e.target.value)}>
                          <option value="">Não definido</option>
                          {procedures
                            ?.filter((p) => p.active || p.id === lead.procedureInterestId)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </NativeSelect>
                      </Field>
                      {canSell && (
                        <AppointmentSaleFields
                          procedureId={(apptProc ?? lead.procedureInterestId) || ''}
                          procedures={procedures ?? []}
                          openSales={openSales}
                          canPay={canPay}
                          onChange={(p, err) => {
                            setApptSale(p);
                            setApptSaleErr(err);
                          }}
                        />
                      )}
                      {canSell && apptSaleErr && <p className="text-xs text-amber-700">{apptSaleErr}</p>}
                      <Button
                        disabled={!apptAt || act.busy || (canSell && !!apptSaleErr)}
                        onClick={() =>
                          call(
                            () =>
                              api(`/leads/${id}/appointments`, {
                                method: 'POST',
                                body: { scheduledFor: apptAt, procedureId: (apptProc ?? lead.procedureInterestId) || null, sale: canSell ? apptSale : null },
                              }),
                            close,
                          )
                        }
                      >
                        Confirmar agendamento
                      </Button>
                    </div>
                  )}
                </ActionDialog>

                <ActionDialog
                  title="Registrar venda"
                  trigger={
                    <Button
                      variant="gold"
                      onClick={() => {
                        // Já vem com o procedimento do próximo horário (ou o de interesse) e o preço de tabela.
                        const pid = saleProc || nextAppt?.procedureId || lead.procedureInterestId || '';
                        setSaleProc(pid);
                        const p = procedures?.find((x) => x.id === pid);
                        if (!saleValue && p?.defaultPriceCents) setSaleValue((p.defaultPriceCents / 100).toFixed(2).replace('.', ','));
                      }}
                    >
                      <CircleDollarSign /> Registrar venda
                    </Button>
                  }
                >
                  {(close) => (
                    <div className="space-y-4">
                      <Field label="Procedimento">
                        <NativeSelect
                          value={saleProc}
                          onChange={(e) => {
                            setSaleProc(e.target.value);
                            const p = procedures?.find((x) => x.id === e.target.value);
                            if (p?.defaultPriceCents) setSaleValue((p.defaultPriceCents / 100).toFixed(2).replace('.', ','));
                          }}
                        >
                          <option value="">Selecione…</option>
                          {procedures?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Valor (R$)">
                        <Input inputMode="decimal" value={saleValue} onChange={(e) => setSaleValue(e.target.value)} />
                      </Field>
                      {lead.attributionConfidence === 'UNKNOWN' && (
                        <details className="rounded-md border p-3 text-sm">
                          <summary className="cursor-pointer text-muted-foreground">Paciente informou de qual anúncio veio? (opcional)</summary>
                          <div className="mt-3 space-y-3">
                            <NativeSelect value={saleAd} onChange={(e) => setSaleAd(e.target.value)}>
                              <option value="">Não informar</option>
                              {ads?.map((a) => (
                                <option key={a.metaId} value={a.metaId}>
                                  {a.code ? `[${a.code}] ` : ''}
                                  {a.name}
                                </option>
                              ))}
                            </NativeSelect>
                            {saleAd && <Input placeholder="Como foi confirmado?" value={saleNote} onChange={(e) => setSaleNote(e.target.value)} />}
                          </div>
                        </details>
                      )}
                      <Button
                        disabled={!saleProc || !parseBRL(saleValue) || act.busy}
                        onClick={() =>
                          call(
                            () =>
                              api(`/leads/${id}/sales`, {
                                method: 'POST',
                                body: {
                                  procedureId: saleProc,
                                  amountCents: parseBRL(saleValue),
                                  manualAttribution: saleAd ? { adMetaId: saleAd, note: saleNote || 'Informado pelo paciente' } : null,
                                },
                              }),
                            close,
                          )
                        }
                      >
                        Confirmar venda
                      </Button>
                    </div>
                  )}
                </ActionDialog>

                <ActionDialog
                  title="Criar lembrete de retorno"
                  trigger={
                    <Button variant="outline">
                      <Bell /> Lembrete
                    </Button>
                  }
                >
                  {(close) => (
                    <div className="space-y-4">
                      <Chips
                        options={[
                          ['1', 'Amanhã'],
                          ['3', 'Em 3 dias'],
                          ['7', 'Em 1 semana'],
                          ['30', 'Em 1 mês'],
                        ]}
                        value={remDays}
                        onChange={setRemDays}
                      />
                      <Input value={remNote} onChange={(e) => setRemNote(e.target.value)} />
                      <Button
                        disabled={!remDays || act.busy}
                        onClick={() => {
                          const due = new Date();
                          due.setDate(due.getDate() + Number(remDays));
                          due.setHours(9, 0, 0, 0);
                          return call(() => api(`/leads/${id}/reminders`, { method: 'POST', body: { dueAt: due.toISOString(), note: remNote } }), close);
                        }}
                      >
                        Criar lembrete
                      </Button>
                    </div>
                  )}
                </ActionDialog>

                {lead.stage !== 'WON' && lead.stage !== 'LOST' && (
                  <ActionDialog
                    title="Marcar como perdido"
                    trigger={
                      <Button variant="ghost" className="text-red-700">
                        <XCircle /> Perdido
                      </Button>
                    }
                  >
                    {(close) => (
                      <div className="space-y-4">
                        <Chips options={LOST_REASONS.map((r) => [r.value, r.label] as const)} value={lostReason} onChange={setLostReason} />
                        {lostReason === 'OTHER' && <Textarea placeholder="Descreva o motivo" value={lostNote} onChange={(e) => setLostNote(e.target.value)} />}
                        <Button
                          variant="destructive"
                          disabled={!lostReason || act.busy}
                          onClick={() => call(() => api(`/leads/${id}/lost`, { method: 'POST', body: { reason: lostReason, note: lostNote || null } }), close)}
                        >
                          Confirmar perda
                        </Button>
                      </div>
                    )}
                  </ActionDialog>
                )}
                {lead.stage === 'LOST' && (
                  <Button variant="outline" onClick={() => call(() => api(`/leads/${id}/stage`, { method: 'PATCH', body: { stage: 'CONTACTED', reason: 'reaberto' } }))}>
                    Reabrir lead
                  </Button>
                )}
              </div>
              {lead.stage === 'LOST' && (
                <p className="text-sm text-red-700">
                  Perdido: {LOST_REASONS.find((r) => r.value === lead.lostReason)?.label} {lead.lostNote && `— ${lead.lostNote}`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Agendamentos */}
          <Card>
            <CardHeader>
              <CardTitle>Agendamentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {appointments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum agendamento.</p>}
              {appointments.map((a: any) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{dateTime(a.scheduledFor)}</p>
                    <p className="text-xs text-muted-foreground">
                      {procName(a.procedureId)} · {a.status === 'CANCELED' ? `Cancelado: ${a.cancelReason}` : (APPT_LABEL[a.status] ?? a.status)}
                      {(() => {
                        const sv = a.saleId ? (sales as any[]).find((x) => x.id === a.saleId) : null;
                        if (!sv) return null;
                        const bal = sv.amountCents - sv.paidCents;
                        return (
                          <span className="ml-1 font-medium text-navy-700">
                            · {brl(sv.amountCents)}
                            {bal > 0 ? ` (saldo ${brl(bal)})` : ' (pago)'}
                          </span>
                        );
                      })()}
                    </p>
                  </div>
                  <PurgeButton
                    endpoint={`/appointments/${a.id}/purge`}
                    title="Apagar agendamento"
                    description={<p>O agendamento de {dateTime(a.scheduledFor)} sai da Agenda e do histórico.</p>}
                    onDone={() => void reload()}
                  />
                  {a.status !== 'SCHEDULED' && (
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      confirmLabel="Voltar para “a confirmar”?"
                      title="Desfazer o último status (clique errado)"
                      onConfirm={() => call(() => api(`/appointments/${a.id}/reopen`, { method: 'POST' }))}
                    >
                      <Undo2 /> Corrigir
                    </ConfirmButton>
                  )}
                  {(a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && (
                    <div className="flex gap-1">
                      {a.status === 'SCHEDULED' && (
                        <Button size="sm" variant="outline" onClick={() => call(() => api(`/appointments/${a.id}/status`, { method: 'POST', body: { status: 'CONFIRMED' } }))}>
                          Confirmado
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => call(() => api(`/appointments/${a.id}/status`, { method: 'POST', body: { status: 'ATTENDED' } }))}>
                        Compareceu
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => call(() => api(`/appointments/${a.id}/status`, { method: 'POST', body: { status: 'NO_SHOW' } }))}>
                        Faltou
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-700" onClick={() => call(() => api(`/appointments/${a.id}/cancel`, { method: 'POST', body: { reason: 'Cancelado pelo paciente' } }))}>
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Vendas */}
          <Card>
            <CardHeader>
              <CardTitle>Vendas, pagamentos e procedimentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sales.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma venda registrada.</p>}
              {sales.map((s: any) => {
                const balance = s.amountCents - s.paidCents;
                const doneRow = performed.find((p: any) => p.saleId === s.id);
                const done = !!doneRow;
                return (
                  <div key={s.id} className={cn('rounded-md border p-3', s.status === 'CANCELED' && 'opacity-50')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {procName(s.procedureId)} · {brl(s.amountCents)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {date(s.soldAt)} · pago {brl(s.paidCents)} · <ConfidenceBadge value={s.attributionConfidence} />
                        </p>
                      </div>
                      <PurgeButton
                        endpoint={`/sales/${s.id}/purge`}
                        title="Apagar venda"
                        description={
                          <p>
                            A venda de {brl(s.amountCents)} ({procName(s.procedureId)}) e os pagamentos dela saem do Financeiro, de Contas a receber e dos relatórios.
                          </p>
                        }
                        onDone={() => void reload()}
                      />
                      {s.status === 'CANCELED' && (
                        <ConfirmButton size="sm" variant="outline" confirmLabel="Reativar a venda?" onConfirm={() => call(() => api(`/sales/${s.id}/reactivate`, { method: 'POST' }))}>
                          <Undo2 /> Desfazer cancelamento
                        </ConfirmButton>
                      )}
                      {s.status === 'ACTIVE' && (
                        <div className="flex gap-1">
                          {balance > 0 && (
                            <ActionDialog
                              title="Registrar pagamento"
                              trigger={
                                <Button size="sm" variant="outline" onClick={() => setPayValue((balance / 100).toFixed(2).replace('.', ','))}>
                                  Pagamento
                                </Button>
                              }
                            >
                              {(close) => (
                                <div className="space-y-4">
                                  <Field label={`Valor (saldo ${brl(balance)})`}>
                                    <Input inputMode="decimal" value={payValue} onChange={(e) => setPayValue(e.target.value)} />
                                  </Field>
                                  <Chips options={METHODS} value={payMethod} onChange={setPayMethod} />
                                  <Button
                                    disabled={!parseBRL(payValue) || !payMethod || act.busy}
                                    onClick={() => call(() => api(`/sales/${s.id}/payments`, { method: 'POST', body: { amountCents: parseBRL(payValue), method: payMethod } }), close)}
                                  >
                                    Confirmar pagamento
                                  </Button>
                                </div>
                              )}
                            </ActionDialog>
                          )}
                          {!done && (
                            <ConfirmButton
                              size="sm"
                              variant="outline"
                              confirmLabel="Confirmar: já realizou?"
                              onConfirm={() => call(() => api(`/leads/${id}/procedures-performed`, { method: 'POST', body: { procedureId: s.procedureId, saleId: s.id } }))}
                            >
                              <CheckCircle2 /> Realizado
                            </ConfirmButton>
                          )}
                        </div>
                      )}
                    </div>
                    {s.payments.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {s.payments.map((p: any) => (
                          <li key={p.id} className="flex items-center gap-2">
                            <span>
                              {date(p.paidAt)} · {METHODS.find((m) => m[0] === p.method)?.[1] ?? p.method} · {brl(p.amountCents)}
                              {p.installments > 1 && ` em ${p.installments}x`}
                            </span>
                            <ConfirmButton
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-xs"
                              confirmLabel="Excluir este pagamento?"
                              title="Excluir pagamento lançado errado"
                              onConfirm={() => call(() => api(`/payments/${p.id}`, { method: 'DELETE' }))}
                            >
                              <Trash2 className="size-3.5" />
                            </ConfirmButton>
                          </li>
                        ))}
                      </ul>
                    )}
                    {done && (
                      <div className="mt-1 flex items-center gap-2 text-xs text-emerald-700">
                        <span>Procedimento realizado em {date(doneRow.performedAt)}</span>
                        <ConfirmButton
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-xs text-muted-foreground"
                          confirmLabel="Desmarcar realizado?"
                          onConfirm={() => call(() => api(`/procedures-performed/${doneRow.id}`, { method: 'DELETE' }))}
                        >
                          <Undo2 className="size-3.5" /> Desfazer
                        </ConfirmButton>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Lateral: lembretes e conversa */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Lembretes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reminders.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lembrete.</p>}
              {reminders.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className={cn(r.doneAt && 'text-muted-foreground line-through')}>
                    {r.note} <span className="text-xs text-muted-foreground">· {dateTime(r.dueAt)}</span>
                  </span>
                  {!r.doneAt && (
                    <Button size="sm" variant="ghost" onClick={() => call(() => api(`/reminders/${r.id}/done`, { method: 'POST' }))}>
                      Feito
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conversa</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Somente leitura. O atendimento continua no WhatsApp Business.</p>
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {messages.map((m: any) => (
                  <div key={m.id} className={cn('flex', m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                        m.direction === 'OUTBOUND' ? 'bg-navy-700 text-white' : 'bg-secondary',
                        m.source === 'HISTORY' && 'opacity-70',
                      )}
                    >
                      {m.hasAdReferral && <p className="mb-1 text-[10px] font-semibold uppercase text-gold-500">via anúncio</p>}
                      <p className="whitespace-pre-wrap">{m.body ?? `[${m.type}]`}</p>
                      <p className={cn('mt-1 text-[10px]', m.direction === 'OUTBOUND' ? 'text-navy-200' : 'text-muted-foreground')}>
                        {dateTime(m.occurredAt)}
                        {m.source === 'BUSINESS_APP' && ' · app'}
                        {m.source === 'HISTORY' && ' · histórico'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <PurgeButton
              endpoint={`/leads/${id}/purge`}
              title="Apagar lead de vez"
              label="Apagar lead (teste ou cadastro errado)"
              description={
                <>
                  <p>
                    Apaga <b>{contact?.name ?? contact?.profileName ?? phone(contact?.waId)}</b> e tudo deste atendimento:
                  </p>
                  <ul className="list-disc pl-5">
                    <li>{appointments.length} agendamento(s) — saem da Agenda</li>
                    <li>{sales.length} venda(s) e os pagamentos — saem do Financeiro e de Contas a receber</li>
                    <li>lembretes e histórico de etapas</li>
                  </ul>
                  <p>Se o contato não tiver conversa pelo WhatsApp nem outro atendimento, ele também é apagado.</p>
                </>
              }
              onDone={() => (window.location.href = '/leads')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
