'use client';

import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { brl, date, parseBRL } from '@/lib/format';

const METHODS: Record<string, string> = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  BOLETO: 'Boleto',
  CASH: 'Dinheiro',
  BANK_TRANSFER: 'Transferência',
  OTHER: 'Outro',
};

interface Item {
  name: string;
  quantity: string | null;
  procedureId?: string | null;
  amountCents?: number | null;
}

interface FormItem {
  name: string;
  quantity: string;
  procedureId: string;
  amount: string;
}

const emptyItem = (): FormItem => ({ name: '', quantity: '', procedureId: '', amount: '' });

interface Purchase {
  id: string;
  purchasedAt: string;
  supplier: string | null;
  items: Item[];
  totalCents: number;
  paymentMethod: string;
  installments: number;
  notes: string | null;
}

interface ListResponse {
  items: Purchase[];
  summary: { count: number; totalCents: number; installmentCents: number; cashCents: number; byMethod: Record<string, number> };
}

/** Hoje (ou o dia de uma data) no fuso de São Paulo, como AAAA-MM-DD. */
const spDay = (d: Date | string = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Último dia do mês AAAA-MM. */
function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const centsToInput = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function paymentLabel(p: Pick<Purchase, 'paymentMethod' | 'installments' | 'totalCents'>) {
  if (p.installments > 1) return `${p.installments}x de ${brl(Math.round(p.totalCents / p.installments))}`;
  return 'À vista';
}

function PurchaseDialog({
  open,
  onOpenChange,
  purchase,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  purchase: Purchase | null;
  onSaved: () => Promise<void>;
}) {
  const { data: procedures } = useApi<any[]>('/procedures');
  const [purchasedAt, setPurchasedAt] = useState(purchase ? spDay(purchase.purchasedAt) : spDay());
  const [supplier, setSupplier] = useState(purchase?.supplier ?? '');
  const [items, setItems] = useState<FormItem[]>(
    purchase?.items.length
      ? purchase.items.map((i) => ({
          name: i.name,
          quantity: i.quantity ?? '',
          procedureId: i.procedureId ?? '',
          amount: i.amountCents ? centsToInput(i.amountCents) : '',
        }))
      : [emptyItem()],
  );
  const [total, setTotal] = useState(purchase ? centsToInput(purchase.totalCents) : '');
  const [method, setMethod] = useState(purchase?.paymentMethod ?? 'PIX');
  const [split, setSplit] = useState((purchase?.installments ?? 1) > 1);
  const [installments, setInstallments] = useState(String(Math.max(2, purchase?.installments ?? 2)));
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const { busy, error, run } = useAction();

  const totalCents = parseBRL(total);
  const n = split ? Number.parseInt(installments, 10) : 1;
  const filled = items.filter((i) => i.name.trim());
  const itemsSum = filled.reduce((t, i) => t + (parseBRL(i.amount) ?? 0), 0);
  const overTotal = !!totalCents && itemsSum > totalCents;
  const valid = !!purchasedAt && !!totalCents && filled.length > 0 && Number.isInteger(n) && n >= 1 && n <= 48 && !overTotal;

  const setItem = (idx: number, patch: Partial<FormItem>) =>
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{purchase ? 'Editar compra' : 'Nova compra de insumos'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data da compra">
            <Input type="date" value={purchasedAt} max={spDay()} onChange={(e) => setPurchasedAt(e.target.value)} />
          </Field>
          <Field label="Fornecedor (opcional)">
            <Input placeholder="ex.: Dental Cremer" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <Field label="Materiais comprados">
            <p className="text-xs text-muted-foreground">
              Escolha o procedimento em que o material é usado (toxina, preenchimento, bioestimulador…) para ver o custo de cada procedimento no
              Financeiro. Com um material só, o valor dele é o total da compra.
            </p>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_5.5rem_auto] gap-2 sm:grid-cols-[1fr_5.5rem_10rem_7rem_auto]">
                  <Input
                    aria-label={`Material ${idx + 1}`}
                    placeholder="Material (ex.: Toxina 100U)"
                    value={it.name}
                    onChange={(e) => setItem(idx, { name: e.target.value })}
                  />
                  <Input
                    aria-label={`Quantidade ${idx + 1}`}
                    placeholder="Qtd."
                    value={it.quantity}
                    onChange={(e) => setItem(idx, { quantity: e.target.value })}
                  />
                  <NativeSelect
                    aria-label={`Procedimento ${idx + 1}`}
                    className="col-span-2 sm:col-span-1"
                    value={it.procedureId}
                    onChange={(e) => setItem(idx, { procedureId: e.target.value })}
                  >
                    <option value="">Uso geral</option>
                    {(procedures ?? [])
                      .filter((p) => p.active || p.id === it.procedureId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </NativeSelect>
                  <Input
                    aria-label={`Valor ${idx + 1}`}
                    inputMode="decimal"
                    placeholder="Valor R$"
                    value={it.amount}
                    onChange={(e) => setItem(idx, { amount: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remover material"
                    disabled={items.length === 1}
                    onClick={() => setItems((cur) => cur.filter((_, i) => i !== idx))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </Field>
          <Button type="button" size="sm" variant="outline" onClick={() => setItems((cur) => [...cur, emptyItem()])}>
            <Plus /> Adicionar material
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor total (R$)">
            <Input inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} />
            {itemsSum > 0 && (
              <p className={overTotal ? 'text-xs text-red-700' : 'text-xs text-muted-foreground'}>
                Soma dos materiais: {brl(itemsSum)}
                {overTotal ? ' (maior que o total)' : ''}
                {itemsSum !== totalCents && (
                  <button type="button" className="ml-2 text-navy-600 underline" onClick={() => setTotal(centsToInput(itemsSum))}>
                    usar como total
                  </button>
                )}
              </p>
            )}
          </Field>
          <Field label="Forma de pagamento">
            <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(METHODS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Parcelado?">
            <NativeSelect value={split ? 'yes' : 'no'} onChange={(e) => setSplit(e.target.value === 'yes')}>
              <option value="no">Não, à vista</option>
              <option value="yes">Sim, parcelado</option>
            </NativeSelect>
          </Field>
          {split && (
            <Field label="Número de parcelas">
              <Input type="number" min={2} max={48} value={installments} onChange={(e) => setInstallments(e.target.value)} />
            </Field>
          )}
        </div>
        {split && totalCents && n >= 2 && n <= 48 && (
          <p className="text-sm text-muted-foreground">
            {n}x de <b>{brl(Math.round(totalCents / n))}</b>
          </p>
        )}

        <Field label="Observações (opcional)">
          <Textarea placeholder="ex.: nota fiscal 1234, entrega em 5 dias" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <ErrorText>{error}</ErrorText>
        <Button
          disabled={busy || !valid}
          onClick={() =>
            run(async () => {
              const body = {
                purchasedAt,
                supplier: supplier || null,
                items: filled.map((i) => ({
                  name: i.name.trim(),
                  quantity: i.quantity.trim() || null,
                  procedureId: i.procedureId || null,
                  amountCents: parseBRL(i.amount),
                })),
                totalCents,
                paymentMethod: method,
                installments: n,
                notes: notes || null,
              };
              if (purchase) await api(`/purchases/${purchase.id}`, { method: 'PATCH', body });
              else await api('/purchases', { method: 'POST', body });
              await onSaved();
              onOpenChange(false);
            })
          }
        >
          {purchase ? 'Salvar alterações' : 'Salvar compra'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ purchase, onDeleted }: { purchase: Purchase; onDeleted: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction();
  if (!confirm)
    return (
      <Button size="icon" variant="ghost" aria-label="Excluir compra" onClick={() => setConfirm(true)}>
        <Trash2 />
      </Button>
    );
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await api(`/purchases/${purchase.id}`, { method: 'DELETE' });
            await onDeleted();
          })
        }
      >
        Excluir
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
        Cancelar
      </Button>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-navy-800">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function PurchasesPage() {
  const { data: procedures } = useApi<any[]>('/procedures');
  const procName = (id?: string | null) => (id ? procedures?.find((p) => p.id === id)?.name : null);
  const [scope, setScope] = useState<'month' | 'all'>('month');
  const [month, setMonth] = useState(spDay().slice(0, 7));
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);

  const path = useMemo(() => {
    if (scope === 'all' || !month) return '/purchases';
    const { from, to } = monthBounds(month);
    return `/purchases?from=${from}&to=${to}`;
  }, [scope, month]);
  const { data, error, reload } = useApi<ListResponse>(path);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (p) => !q || `${p.supplier ?? ''} ${p.notes ?? ''} ${p.items.map((i) => i.name).join(' ')}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  const openDialog = (p: Purchase | null) => {
    setEditing(p);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };

  const s = data?.summary;
  const periodLabel =
    scope === 'all' ? 'Todo o histórico' : new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Compras de insumos</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Histórico do que a clínica comprou: materiais, valor, data e como foi pago.
          </p>
        </div>
        <Button variant="gold" onClick={() => openDialog(null)}>
          <Plus /> Nova compra
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-48" value={scope} onChange={(e) => setScope(e.target.value as 'month' | 'all')} aria-label="Período">
          <option value="month">Por mês</option>
          <option value="all">Todo o histórico</option>
        </NativeSelect>
        {scope === 'month' && (
          <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês" />
        )}
        <Input
          className="max-w-xs"
          placeholder="Buscar material ou fornecedor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total gasto" value={brl(s?.totalCents ?? 0)} hint={periodLabel} />
        <Stat label="Compras" value={String(s?.count ?? 0)} />
        <Stat label="À vista" value={brl(s?.cashCents ?? 0)} />
        <Stat label="Parcelado" value={brl(s?.installmentCents ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Mais recentes primeiro. Clique no lápis para corrigir uma compra.</CardDescription>
        </CardHeader>
        <CardContent>
          <ErrorText>{error}</ErrorText>
          {!data && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {data && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma compra {search ? 'encontrada' : 'registrada neste período'}. Use <b>Nova compra</b> para lançar a primeira.
            </p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Data</TH>
                    <TH>Materiais</TH>
                    <TH>Pagamento</TH>
                    <TH className="text-right">Valor</TH>
                    <TH className="w-28" />
                  </TR>
                </THead>
                <TBody>
                  {rows.map((p) => (
                    <TR key={p.id}>
                      <TD className="whitespace-nowrap align-top">{date(p.purchasedAt)}</TD>
                      <TD className="align-top">
                        <ul className="space-y-0.5">
                          {p.items.map((i, idx) => (
                            <li key={idx}>
                              {i.name}
                              {i.quantity && <span className="text-muted-foreground"> · {i.quantity}</span>}
                              {i.amountCents ? <span className="text-muted-foreground"> · {brl(i.amountCents)}</span> : null}
                              {procName(i.procedureId) && (
                                <Badge variant="secondary" className="ml-2">
                                  {procName(i.procedureId)}
                                </Badge>
                              )}
                            </li>
                          ))}
                        </ul>
                        {p.supplier && <p className="mt-1 text-xs text-muted-foreground">Fornecedor: {p.supplier}</p>}
                        {p.notes && <p className="mt-0.5 text-xs text-muted-foreground">{p.notes}</p>}
                      </TD>
                      <TD className="align-top">
                        <p>{METHODS[p.paymentMethod] ?? p.paymentMethod}</p>
                        {p.installments > 1 ? (
                          <Badge variant="outline" className="mt-1">
                            {paymentLabel(p)}
                          </Badge>
                        ) : (
                          <p className="text-xs text-muted-foreground">À vista</p>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-right align-top font-medium">{brl(p.totalCents)}</TD>
                      <TD className="align-top">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" aria-label="Editar compra" onClick={() => openDialog(p)}>
                            <Pencil />
                          </Button>
                          <DeleteButton purchase={p} onDeleted={reload} />
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PurchaseDialog key={dialogKey} open={dialogOpen} onOpenChange={setDialogOpen} purchase={editing} onSaved={reload} />
    </div>
  );
}
