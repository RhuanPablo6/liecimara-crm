'use client';

import { CircleDollarSign, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { brl, date, parseBRL, phone } from '@/lib/format';

export const SALE_METHODS: Record<string, string> = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  CASH: 'Dinheiro',
  BANK_TRANSFER: 'Transferência',
  OTHER: 'Outro',
};

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const centsToInput = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function PaymentFields({
  method,
  setMethod,
  installments,
  setInstallments,
}: {
  method: string;
  setMethod: (v: string) => void;
  installments: string;
  setInstallments: (v: string) => void;
}) {
  return (
    <>
      <Field label="Forma de pagamento">
        <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(SALE_METHODS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {method === 'CREDIT_CARD' && (
        <Field label="Parcelas no cartão">
          <NativeSelect value={installments} onChange={(e) => setInstallments(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
              <option key={n} value={n}>
                {n === '1' ? 'À vista' : `${n}x`}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </>
  );
}

/** Lançar venda direto no Financeiro: paciente de indicação, retorno, balcão... */
export function NewSaleDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        variant="gold"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Plus /> Nova venda
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <SaleForm key={key} onDone={() => (setOpen(false), onSaved())} />
      </Dialog>
    </>
  );
}

function SaleForm({ onDone }: { onDone: () => void }) {
  const { data: procedures } = useApi<any[]>('/procedures');
  const { data: ads } = useApi<any[]>('/ads');
  const [waId, setWaId] = useState('55');
  const [patient, setPatient] = useState<any>(null);
  const [name, setName] = useState('');
  const [procedureId, setProcedureId] = useState('');
  const [amount, setAmount] = useState('');
  const [soldAt, setSoldAt] = useState(today());
  const [adMetaId, setAdMetaId] = useState('');
  const [received, setReceived] = useState<'full' | 'partial' | 'none'>('full');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('PIX');
  const [installments, setInstallments] = useState('1');
  const lookup = useAction();
  const { busy, error, run } = useAction();

  const amountCents = parseBRL(amount);
  const paidCents = received === 'partial' ? parseBRL(paid) : null;
  const askOrigin = !patient?.found || patient.attributionConfidence === 'UNKNOWN';
  const valid =
    waId.length >= 12 && !!procedureId && !!amountCents && !!soldAt && (received !== 'partial' || (!!paidCents && paidCents < amountCents!));

  const findPatient = () =>
    waId.length >= 12 &&
    lookup.run(async () => {
      const p = await api(`/finance/patient?waId=${waId}`);
      setPatient(p);
      if (p.found && p.name && !name) setName(p.name);
    });

  return (
    <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Nova venda</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Para pacientes que não vieram pelo CRM (indicação, retorno, balcão). Se o WhatsApp já existir, a venda entra no histórico do paciente.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="WhatsApp do paciente (DDI + DDD + número)">
          <Input
            inputMode="numeric"
            value={waId}
            onChange={(e) => {
              setWaId(e.target.value.replace(/\D/g, ''));
              setPatient(null);
            }}
            onBlur={findPatient}
          />
          {patient?.found && <p className="text-xs text-emerald-700">Paciente já cadastrado{patient.name ? `: ${patient.name}` : ''}.</p>}
          {patient && !patient.found && <p className="text-xs text-muted-foreground">Paciente novo: será cadastrado com a venda.</p>}
        </Field>
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Procedimento">
          <NativeSelect
            value={procedureId}
            onChange={(e) => {
              setProcedureId(e.target.value);
              const p = procedures?.find((x) => x.id === e.target.value);
              if (p?.defaultPriceCents && !amount) setAmount(centsToInput(p.defaultPriceCents));
            }}
          >
            <option value="">Selecione…</option>
            {procedures
              ?.filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Valor da venda (R$)">
          <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Data da venda">
          <Input type="date" max={today()} value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
        </Field>
        {askOrigin && (
          <Field label="Veio de algum anúncio? (opcional)">
            <NativeSelect value={adMetaId} onChange={(e) => setAdMetaId(e.target.value)}>
              <option value="">Não / não sabe</option>
              {(ads ?? [])
                .filter((a) => a.status === 'ACTIVE' || a.code)
                .map((a) => (
                  <option key={a.metaId} value={a.metaId}>
                    {a.code ? `[${a.code}] ` : ''}
                    {a.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
        )}
      </div>

      <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
        <Field label="Recebimento">
          <NativeSelect value={received} onChange={(e) => setReceived(e.target.value as any)}>
            <option value="full">Recebido o valor total</option>
            <option value="partial">Recebido uma parte (sinal)</option>
            <option value="none">Ainda não recebido</option>
          </NativeSelect>
        </Field>
        {received === 'partial' && (
          <Field label="Valor recebido (R$)">
            <Input inputMode="decimal" placeholder="0,00" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
        )}
        {received !== 'none' && <PaymentFields method={method} setMethod={setMethod} installments={installments} setInstallments={setInstallments} />}
      </div>
      {received === 'partial' && amountCents && paidCents && paidCents < amountCents && (
        <p className="text-sm text-muted-foreground">
          Fica a receber: <b>{brl(amountCents - paidCents)}</b>
        </p>
      )}

      <ErrorText>{error ?? lookup.error}</ErrorText>
      <Button
        disabled={busy || !valid}
        onClick={() =>
          run(async () => {
            await api('/finance/sales', {
              method: 'POST',
              body: {
                waId,
                name: name || null,
                procedureId,
                amountCents,
                soldAt,
                adMetaId: askOrigin && adMetaId ? adMetaId : null,
                payment:
                  received === 'none'
                    ? null
                    : { method, installments: method === 'CREDIT_CARD' ? Number(installments) : 1, amountCents: paidCents, paidAt: soldAt },
              },
            });
            onDone();
          })
        }
      >
        Salvar venda
      </Button>
    </DialogContent>
  );
}

function ReceiveDialog({ sale, onDone }: { sale: any; onDone: () => void }) {
  const balance = sale.amountCents - sale.paidCents;
  const [amount, setAmount] = useState(centsToInput(balance));
  const [paidAt, setPaidAt] = useState(today());
  const [method, setMethod] = useState('PIX');
  const [installments, setInstallments] = useState('1');
  const { busy, error, run } = useAction();
  const cents = parseBRL(amount);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Registrar recebimento</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        {sale.patientName ?? phone(sale.waId)} · {sale.procedureName} · saldo {brl(balance)}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valor (R$)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Data">
          <Input type="date" max={today()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
        <PaymentFields method={method} setMethod={setMethod} installments={installments} setInstallments={setInstallments} />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button
        disabled={busy || !cents || cents > balance}
        onClick={() =>
          run(async () => {
            await api(`/sales/${sale.id}/payments`, {
              method: 'POST',
              body: {
                amountCents: cents,
                method,
                installments: method === 'CREDIT_CARD' ? Number(installments) : 1,
                paidAt: new Date(`${paidAt}T15:00:00Z`).toISOString(),
              },
            });
            onDone();
          })
        }
      >
        Registrar
      </Button>
    </DialogContent>
  );
}

function CancelDialog({ sale, onDone }: { sale: any; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Cancelar venda</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        {sale.patientName ?? phone(sale.waId)} · {sale.procedureName} · {brl(sale.amountCents)}. A venda sai do faturamento; o histórico fica guardado.
      </p>
      <Field label="Motivo">
        <Input placeholder="ex.: paciente desistiu, lançamento duplicado" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button
        variant="destructive"
        disabled={busy || reason.trim().length < 2}
        onClick={() =>
          run(async () => {
            await api(`/sales/${sale.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } });
            onDone();
          })
        }
      >
        Cancelar venda
      </Button>
    </DialogContent>
  );
}

/** Vendas do período: paciente, procedimento, valor e situação do recebimento. */
export function SalesCard({ from, to, version, onChanged }: { from: string; to: string; version: number; onChanged: () => void }) {
  const { data, reload } = useApi<any[]>(`/finance/sales?from=${from}&to=${to}&v=${version}`);
  const [action, setAction] = useState<{ kind: 'receive' | 'cancel'; sale: any } | null>(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const done = async () => {
    setAction(null);
    await reload();
    onChanged();
  };
  const rows = (data ?? []).filter((s) => showCanceled || s.status === 'ACTIVE');
  const canceled = (data ?? []).filter((s) => s.status !== 'ACTIVE').length;
  const receivable = (data ?? []).filter((s) => s.status === 'ACTIVE').reduce((t, s) => t + (s.amountCents - s.paidCents), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendas do período</CardTitle>
        <CardDescription>
          {data ? `${rows.length} venda(s)` : 'Carregando…'}
          {receivable > 0 && ` · ${brl(receivable)} a receber destas vendas`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data && rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma venda no período.</p>}
        {rows.length > 0 && (
          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Data</TH>
                  <TH>Paciente</TH>
                  <TH>Procedimento</TH>
                  <TH>Origem</TH>
                  <TH className="text-right">Valor</TH>
                  <TH>Recebimento</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((s) => {
                  const balance = s.amountCents - s.paidCents;
                  const canceledRow = s.status !== 'ACTIVE';
                  return (
                    <TR key={s.id} className={canceledRow ? 'text-muted-foreground line-through' : undefined}>
                      <TD className="whitespace-nowrap">{date(s.soldAt)}</TD>
                      <TD>
                        <Link className="hover:underline" href={`/leads/${s.leadId}`}>
                          {s.patientName ?? phone(s.waId)}
                        </Link>
                      </TD>
                      <TD>{s.procedureName}</TD>
                      <TD className="text-xs text-muted-foreground">{s.origin ?? '—'}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{brl(s.amountCents)}</TD>
                      <TD>
                        {canceledRow ? (
                          <Badge variant="secondary">Cancelada</Badge>
                        ) : balance <= 0 ? (
                          <Badge variant="success">Recebido</Badge>
                        ) : s.paidCents > 0 ? (
                          <Badge variant="warning">Falta {brl(balance)}</Badge>
                        ) : (
                          <Badge variant="warning">A receber</Badge>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-right">
                        {!canceledRow && balance > 0 && (
                          <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'receive', sale: s })}>
                            <CircleDollarSign /> Receber
                          </Button>
                        )}
                        {!canceledRow && (
                          <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setAction({ kind: 'cancel', sale: s })}>
                            Cancelar
                          </Button>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
        {canceled > 0 && (
          <button className="mt-2 text-xs text-navy-600 underline" onClick={() => setShowCanceled((v) => !v)}>
            {showCanceled ? 'Ocultar canceladas' : `Mostrar ${canceled} cancelada(s)`}
          </button>
        )}
        <Dialog open={!!action} onOpenChange={(v) => !v && setAction(null)}>
          {action?.kind === 'receive' && <ReceiveDialog key={action.sale.id} sale={action.sale} onDone={done} />}
          {action?.kind === 'cancel' && <CancelDialog key={action.sale.id} sale={action.sale} onDone={done} />}
        </Dialog>
      </CardContent>
    </Card>
  );
}
