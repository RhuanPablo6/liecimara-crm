'use client';

// Montar/editar orçamento na consulta: paciente, tratamentos (do cadastro de procedimentos), descontos,
// formas de pagamento e validade. O total aparece ao vivo.
import { Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { brl, phone } from '@/lib/format';

type Row = { procedureId: string; description: string; quantity: string; unit: string; discount: string };
export type EditableQuote = {
  id: string;
  patient: { id: string; name: string | null } | null;
  items: { procedureId: string; description: string; quantity: number; unitPriceCents: number; discountCents: number }[];
  discountCents: number;
  validUntil: string;
  paymentTerms: string | null;
  notes: string | null;
};

const TERMS_KEY = 'crm.quote.paymentTerms';
const spDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const plusDays = (n: number) => spDay(new Date(Date.now() + n * 86_400_000));
const toText = (cents: number) => (cents ? (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
/** "1.234,56" / "1234.56" / "" → centavos (0 quando vazio). */
const cents = (v: string) => {
  const clean = v.replace(/[^\d,.-]/g, '');
  if (!clean) return 0;
  const n = Number.parseFloat(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const emptyRow = (): Row => ({ procedureId: '', description: '', quantity: '1', unit: '', discount: '' });

export function QuoteEditor({
  open,
  onOpenChange,
  patient,
  quote,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Paciente já escolhida (ex.: aberto pelo perfil). */
  patient?: { id: string; name: string | null } | null;
  /** Orçamento para editar. */
  quote?: EditableQuote | null;
  onSaved: (q: any) => void;
}) {
  const { data: procedures } = useApi<any[]>(open ? '/procedures' : null);
  const active = useMemo(() => (procedures ?? []).filter((p) => p.active !== false), [procedures]);
  const [chosen, setChosen] = useState<{ id: string; name: string | null; waId?: string | null } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('55');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<any[]>([]);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [discount, setDiscount] = useState('');
  const [discountMode, setDiscountMode] = useState<'BRL' | 'PCT'>('BRL');
  const [validUntil, setValidUntil] = useState(plusDays(15));
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run, setError } = useAction();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (quote) {
      setChosen(quote.patient);
      setRows(
        quote.items.map((i) => ({
          procedureId: i.procedureId,
          description: i.description,
          quantity: String(i.quantity),
          unit: toText(i.unitPriceCents),
          discount: toText(i.discountCents),
        })),
      );
      setDiscount(toText(quote.discountCents));
      setDiscountMode('BRL');
      setValidUntil(spDay(new Date(quote.validUntil)));
      setTerms(quote.paymentTerms ?? '');
      setNotes(quote.notes ?? '');
    } else {
      setChosen(patient ?? null);
      setIsNew(false);
      setNewName('');
      setNewPhone('55');
      setSearch('');
      setRows([emptyRow()]);
      setDiscount('');
      setDiscountMode('BRL');
      setValidUntil(plusDays(15));
      let last = '';
      try {
        last = window.localStorage.getItem(TERMS_KEY) ?? '';
      } catch {}
      setTerms(last);
      setNotes('');
    }
  }, [open, quote, patient, setError]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) return setHits([]);
    const t = setTimeout(() => {
      api<any[]>(`/agenda/patients?q=${encodeURIComponent(term)}`).then(setHits, () => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const lines = rows.map((r) => {
    const qty = Math.max(1, Number.parseInt(r.quantity, 10) || 1);
    const unit = cents(r.unit);
    const disc = cents(r.discount);
    return { ...r, qty, unitCents: unit, discCents: disc, total: qty * unit - disc };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const discountCents =
    discountMode === 'PCT'
      ? Math.round((subtotal * Math.min(100, Number.parseFloat(discount.replace(',', '.')) || 0)) / 100)
      : cents(discount);
  const total = subtotal - discountCents;

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickProcedure = (i: number, id: string) => {
    const p = active.find((x) => x.id === id);
    const prev = rows[i]!;
    const prevProc = active.find((x) => x.id === prev.procedureId);
    setRow(i, {
      procedureId: id,
      // Mantém texto editado à mão; troca se ainda era o nome do procedimento anterior.
      description: !prev.description || prev.description === prevProc?.name ? (p?.name ?? '') : prev.description,
      unit: !prev.unit && p?.defaultPriceCents ? toText(p.defaultPriceCents) : prev.unit,
    });
  };

  const problem = (() => {
    if (!quote && !chosen && !isNew) return 'Escolha a paciente';
    if (isNew && !chosen && (newName.trim().length < 2 || newPhone.replace(/\D/g, '').length < 12)) return 'Informe nome e WhatsApp da paciente nova';
    if (lines.some((l) => !l.procedureId)) return 'Escolha o procedimento de cada linha';
    const bad = lines.find((l) => l.total <= 0);
    if (bad) return `Informe o valor de "${bad.description || 'tratamento'}"`;
    if (discountCents >= subtotal && subtotal > 0) return 'O desconto não pode ser maior que o total';
    if (!validUntil) return 'Informe a validade';
    return null;
  })();

  async function save() {
    if (problem) return setError(problem);
    const body = {
      items: lines.map((l) => ({ procedureId: l.procedureId, description: l.description.trim(), quantity: l.qty, unitPriceCents: l.unitCents, discountCents: l.discCents })),
      discountCents,
      validUntil,
      paymentTerms: terms.trim() || null,
      notes: notes.trim() || null,
    };
    const saved = await run(() =>
      quote
        ? api(`/quotes/${quote.id}`, { method: 'PATCH', body })
        : api('/quotes', {
            method: 'POST',
            body: { ...body, contactId: chosen?.id ?? null, newPatient: chosen ? null : { waId: newPhone.replace(/\D/g, ''), name: newName.trim() } },
          }),
    );
    if (saved) {
      try {
        if (terms.trim()) window.localStorage.setItem(TERMS_KEY, terms.trim());
      } catch {}
      onOpenChange(false);
      onSaved(saved);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{quote ? 'Editar orçamento' : 'Novo orçamento'}</DialogTitle>
          <DialogDescription>Monte os tratamentos combinados na consulta. Fica salvo no perfil da paciente.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Paciente */}
          <section className="space-y-2">
            <p className="text-sm font-medium">Paciente</p>
            {chosen ? (
              <div className="flex items-center justify-between rounded-md border bg-secondary/40 px-3 py-2 text-sm">
                <span>
                  <b>{chosen.name ?? 'Sem nome'}</b>
                  {chosen.waId && <span className="text-muted-foreground"> · {phone(chosen.waId)}</span>}
                </span>
                {!quote && !patient && (
                  <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
                    Trocar
                  </Button>
                )}
              </div>
            ) : isNew ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
                <Field label="Nome">
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome da paciente" autoFocus />
                </Field>
                <Field label="WhatsApp (com DDI e DDD)">
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="5511999999999" />
                </Field>
                <Button variant="ghost" onClick={() => setIsNew(false)}>
                  Buscar cadastrada
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone" autoFocus />
                  </div>
                  <Button variant="outline" onClick={() => setIsNew(true)}>
                    <UserPlus /> Paciente nova
                  </Button>
                </div>
                {hits.length > 0 && (
                  <div className="max-h-48 divide-y overflow-y-auto rounded-md border">
                    {hits.map((h) => (
                      <button
                        key={h.contactId}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-secondary/60"
                        onClick={() => setChosen({ id: h.contactId, name: h.name, waId: h.waId })}
                      >
                        <span>{h.name ?? 'Sem nome'}</span>
                        <span className="text-xs text-muted-foreground">{phone(h.waId)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {search.trim().length >= 2 && hits.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma paciente encontrada. Use “Paciente nova”.</p>}
              </div>
            )}
          </section>

          {/* Tratamentos */}
          <section className="space-y-2">
            <p className="text-sm font-medium">Tratamentos</p>
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                    <Field label="Procedimento">
                      <NativeSelect value={l.procedureId} onChange={(e) => pickProcedure(i, e.target.value)}>
                        <option value="">Escolha…</option>
                        {active.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Descrição no orçamento">
                      <Input value={l.description} onChange={(e) => setRow(i, { description: e.target.value })} placeholder="Ex.: Botox – terço superior" maxLength={200} />
                    </Field>
                    <div className="flex items-end">
                      <Button variant="ghost" size="icon" title="Remover" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[90px_1fr_1fr_1fr]">
                    <Field label="Qtd.">
                      <Input value={l.quantity} onChange={(e) => setRow(i, { quantity: e.target.value.replace(/\D/g, '') })} inputMode="numeric" />
                    </Field>
                    <Field label="Valor unitário (R$)">
                      <Input value={l.unit} onChange={(e) => setRow(i, { unit: e.target.value })} inputMode="decimal" placeholder="0,00" />
                    </Field>
                    <Field label="Desconto no item (R$)">
                      <Input value={l.discount} onChange={(e) => setRow(i, { discount: e.target.value })} inputMode="decimal" placeholder="0,00" />
                    </Field>
                    <div className="col-span-2 flex flex-col justify-end text-right sm:col-span-1">
                      <span className="text-xs text-muted-foreground">Total do item</span>
                      <span className={l.total < 0 ? 'font-semibold text-red-700' : 'font-semibold tabular-nums'}>{brl(Math.max(0, l.total))}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              <Plus /> Adicionar tratamento
            </Button>
          </section>

          {/* Totais e condições */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <Field label="Desconto geral">
                <div className="flex gap-2">
                  <NativeSelect className="w-20" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as any)}>
                    <option value="BRL">R$</option>
                    <option value="PCT">%</option>
                  </NativeSelect>
                  <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder={discountMode === 'PCT' ? '10' : '0,00'} />
                </div>
              </Field>
              <Field label="Válido até">
                <div className="flex gap-2">
                  <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  {[7, 15, 30].map((d) => (
                    <Button key={d} type="button" variant="ghost" size="sm" className="h-9" onClick={() => setValidUntil(plusDays(d))}>
                      {d}d
                    </Button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="flex flex-col justify-end rounded-xl bg-navy-800 px-5 py-4 text-right text-navy-100">
              {discountCents > 0 && (
                <p className="text-sm">
                  Subtotal {brl(subtotal)} · desconto <span className="text-gold-300">− {brl(discountCents)}</span>
                </p>
              )}
              <p className="text-xs uppercase tracking-wider">Total do orçamento</p>
              <p className="font-serif text-3xl text-white tabular-nums">{brl(Math.max(0, total))}</p>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Formas de pagamento">
              <Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Ex.: Pix com 5% de desconto ou cartão em até 10x" maxLength={1000} />
            </Field>
            <Field label="Observações (aparecem para a paciente)">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: intervalo de 30 dias entre as sessões" maxLength={2000} />
            </Field>
          </section>

          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Salvando…' : quote ? 'Salvar alterações' : 'Criar orçamento'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
