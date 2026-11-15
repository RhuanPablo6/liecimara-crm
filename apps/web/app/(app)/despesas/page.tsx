'use client';

import { CopyPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { brl, date, parseBRL } from '@/lib/format';

const EXPENSE_CATEGORIES = [
  'Aluguel',
  'Condomínio',
  'Energia',
  'Água',
  'Internet e telefone',
  'Salários e encargos',
  'Pró-labore',
  'Impostos e taxas',
  'Contabilidade',
  'Sistemas e softwares',
  'Marketing (outros)',
  'Taxas de cartão',
  'Manutenção',
  'Limpeza',
  'Material de escritório',
  'Empréstimos e financiamentos',
  'Outros',
];

const METHODS = ['Pix', 'Boleto', 'Cartão de crédito', 'Cartão de débito', 'Débito automático', 'Transferência', 'Dinheiro'];

interface Expense {
  id: string;
  date: string;
  category: string;
  description: string | null;
  amountCents: number;
  paymentMethod: string | null;
  paid: boolean;
}

interface ListResponse {
  items: Expense[];
  summary: { count: number; totalCents: number; pendingCents: number; paidCents: number };
}

const spDay = (d: Date | string = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

const centsToInput = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  defaultDay,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expense: Expense | null;
  defaultDay: string;
  onSaved: () => Promise<void>;
}) {
  const [day, setDay] = useState(expense ? spDay(expense.date) : defaultDay);
  const [category, setCategory] = useState(expense?.category ?? 'Aluguel');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? centsToInput(expense.amountCents) : '');
  const [method, setMethod] = useState(expense?.paymentMethod ?? '');
  const [paid, setPaid] = useState(expense?.paid ?? true);
  const { busy, error, run } = useAction();
  const amountCents = parseBRL(amount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{expense ? 'Editar despesa' : 'Nova despesa'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria">
            <Input list="expense-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="expense-categories">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Valor (R$)">
            <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Data (vencimento ou pagamento)">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Situação">
            <NativeSelect value={paid ? 'paid' : 'pending'} onChange={(e) => setPaid(e.target.value === 'paid')}>
              <option value="paid">Pago</option>
              <option value="pending">A pagar</option>
            </NativeSelect>
          </Field>
          <Field label="Forma de pagamento (opcional)">
            <Input list="expense-methods" value={method} onChange={(e) => setMethod(e.target.value)} />
            <datalist id="expense-methods">
              {METHODS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Descrição (opcional)">
            <Input placeholder="ex.: conta de outubro" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button
          disabled={busy || !day || !category.trim() || !amountCents}
          onClick={() =>
            run(async () => {
              const body = {
                date: day,
                category: category.trim(),
                description: description || null,
                amountCents,
                paymentMethod: method || null,
                paid,
              };
              if (expense) await api(`/expenses/${expense.id}`, { method: 'PATCH', body });
              else await api('/expenses', { method: 'POST', body });
              await onSaved();
              onOpenChange(false);
            })
          }
        >
          {expense ? 'Salvar alterações' : 'Salvar despesa'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone === 'warn' ? 'text-amber-700' : 'text-navy-800'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function ExpensesPage() {
  const [month, setMonth] = useState(spDay().slice(0, 7));
  const [editing, setEditing] = useState<Expense | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const copy = useAction();
  const act = useAction();
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const { from, to } = monthBounds(month);
  const { data, error, reload } = useApi<ListResponse>(`/expenses?from=${from}&to=${to}`);
  const prev = shiftMonth(month, -1);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.items ?? []) m.set(e.category, (m.get(e.category) ?? 0) + e.amountCents);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const openDialog = (e: Expense | null) => {
    setEditing(e);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };

  const today = spDay();
  const defaultDay = today.startsWith(month) ? today : `${month}-05`;
  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Despesas</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Custos da clínica mês a mês: aluguel, energia, condomínio, salários, impostos… Elas entram no resultado do Financeiro.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={copy.busy}
            onClick={() =>
              copy.run(async () => {
                const r = await api<{ created: number; skipped: number }>('/expenses/copy-month', {
                  method: 'POST',
                  body: { fromMonth: prev, toMonth: month },
                });
                setCopyMsg(
                  r.created
                    ? `${r.created} despesa(s) de ${monthName(prev)} copiada(s) como "a pagar". Confira os valores.`
                    : `Nada novo para copiar de ${monthName(prev)}.`,
                );
                await reload();
              })
            }
          >
            <CopyPlus /> Repetir despesas de {monthName(prev).split(' ')[0]}
          </Button>
          <Button variant="gold" onClick={() => openDialog(null)}>
            <Plus /> Nova despesa
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
          ‹
        </Button>
        <Input type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Mês" />
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
          ›
        </Button>
        <span className="text-sm text-muted-foreground">{monthName(month).replace(/^./, (c) => c.toUpperCase())}</span>
      </div>
      {copyMsg && <p className="rounded-md bg-secondary px-3 py-2 text-sm">{copyMsg}</p>}
      <ErrorText>{copy.error ?? act.error ?? error}</ErrorText>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total do mês" value={brl(s?.totalCents ?? 0)} />
        <Stat label="Pago" value={brl(s?.paidCents ?? 0)} />
        <Stat label="A pagar" value={brl(s?.pendingCents ?? 0)} tone={s?.pendingCents ? 'warn' : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos</CardTitle>
            <CardDescription>Clique em "A pagar" para marcar como pago.</CardDescription>
          </CardHeader>
          <CardContent>
            {!data && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {data && data.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma despesa neste mês. Use <b>Nova despesa</b> ou <b>Repetir despesas</b> do mês anterior.
              </p>
            )}
            {data && data.items.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Data</TH>
                      <TH>Categoria</TH>
                      <TH>Situação</TH>
                      <TH className="text-right">Valor</TH>
                      <TH className="w-28" />
                    </TR>
                  </THead>
                  <TBody>
                    {data.items.map((e) => (
                      <TR key={e.id}>
                        <TD className="whitespace-nowrap align-top">{date(e.date)}</TD>
                        <TD className="align-top">
                          <p className="font-medium">{e.category}</p>
                          {(e.description || e.paymentMethod) && (
                            <p className="text-xs text-muted-foreground">{[e.description, e.paymentMethod].filter(Boolean).join(' · ')}</p>
                          )}
                        </TD>
                        <TD className="align-top">
                          <button
                            disabled={act.busy}
                            onClick={() =>
                              act.run(async () => {
                                await api(`/expenses/${e.id}`, { method: 'PATCH', body: { paid: !e.paid } });
                                await reload();
                              })
                            }
                            title={e.paid ? 'Marcar como a pagar' : 'Marcar como pago'}
                          >
                            <Badge variant={e.paid ? 'success' : 'warning'}>{e.paid ? 'Pago' : 'A pagar'}</Badge>
                          </button>
                        </TD>
                        <TD className="whitespace-nowrap text-right align-top font-medium">{brl(e.amountCents)}</TD>
                        <TD className="align-top">
                          {confirmDelete === e.id ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={act.busy}
                                onClick={() =>
                                  act.run(async () => {
                                    await api(`/expenses/${e.id}`, { method: 'DELETE' });
                                    setConfirmDelete(null);
                                    await reload();
                                  })
                                }
                              >
                                Excluir
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" aria-label="Editar despesa" onClick={() => openDialog(e)}>
                                <Pencil />
                              </Button>
                              <Button size="icon" variant="ghost" aria-label="Excluir despesa" onClick={() => setConfirmDelete(e.id)}>
                                <Trash2 />
                              </Button>
                            </div>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por categoria</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byCategory.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
            {byCategory.map(([c, v]) => (
              <div key={c} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{c}</span>
                <span className="font-medium tabular-nums">{brl(v)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <ExpenseDialog key={dialogKey} open={dialogOpen} onOpenChange={setDialogOpen} expense={editing} defaultDay={defaultDay} onSaved={reload} />
    </div>
  );
}
