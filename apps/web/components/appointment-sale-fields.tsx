'use client';

// "Valor do atendimento" no próprio agendamento: lança uma vez e o mesmo valor aparece no Lead,
// no Financeiro e em Contas a receber (o saldo vence no dia do horário). Se já existe venda
// (ex.: orçamento aprovado), vincula a ela em vez de lançar de novo.
import { useEffect, useRef, useState } from 'react';
import { PaymentFields } from '@/components/finance-sales';
import { Field, Input } from '@/components/ui/form';
import { brl, parseBRL } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface OpenSale {
  id: string;
  procedureId: string;
  procedureName: string | null;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  performed?: boolean;
  linkedAppointments?: number;
}

export type SalePayload =
  | { saleId: string }
  | { amountCents: number; payment?: { amountCents: number; method: string; installments: number; paidAt?: string } | null }
  | null;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const toInput = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AppointmentSaleFields({
  procedureId,
  procedures,
  openSales = [],
  canPay = true,
  onChange,
}: {
  procedureId: string;
  procedures: any[];
  openSales?: OpenSale[];
  canPay?: boolean;
  /** payload (ou null = sem valor) e erro de preenchimento (null = ok). */
  onChange: (payload: SalePayload, error: string | null) => void;
}) {
  const matching = openSales.filter((s) => !procedureId || s.procedureId === procedureId);
  const proc = procedures.find((p) => p.id === procedureId);
  const [mode, setMode] = useState<'existing' | 'new' | 'none'>('none');
  const [saleId, setSaleId] = useState('');
  const [amount, setAmount] = useState('');
  const [received, setReceived] = useState<'none' | 'full' | 'partial'>('none');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('PIX');
  const [installments, setInstallments] = useState('1');
  const [paidAt, setPaidAt] = useState(today());
  const touched = useRef(false);
  const notify = useRef(onChange);
  notify.current = onChange;

  // Escolha automática quando muda o procedimento: venda já lançada > preço do procedimento > sem valor.
  useEffect(() => {
    if (matching.length) {
      setMode('existing');
      setSaleId(matching[0]!.id);
    } else if (proc?.defaultPriceCents) {
      setMode('new');
    } else if (!touched.current) {
      setMode(procedureId ? 'new' : 'none');
    }
    if (!touched.current || !amount) setAmount(proc?.defaultPriceCents ? toInput(proc.defaultPriceCents) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedureId, openSales.length]);

  const amountCents = parseBRL(amount) ?? 0;
  const paidCents = received === 'full' ? amountCents : received === 'partial' ? (parseBRL(paid) ?? 0) : 0;

  useEffect(() => {
    if (mode === 'none') return notify.current(null, null);
    if (mode === 'existing') return notify.current(saleId ? { saleId } : null, saleId ? null : 'Escolha a venda');
    if (!procedureId) return notify.current(null, 'Escolha o procedimento para lançar o valor');
    if (!amountCents) return notify.current(null, 'Informe o valor do procedimento');
    if (received === 'partial' && (!paidCents || paidCents >= amountCents)) return notify.current(null, 'O valor pago deve ser menor que o total (ou marque "pagou tudo")');
    notify.current(
      {
        amountCents,
        payment: received === 'none' ? null : { amountCents: paidCents, method, installments: method === 'CREDIT_CARD' ? Number(installments) : 1, paidAt: new Date(`${paidAt}T12:00:00-03:00`).toISOString() },
      },
      null,
    );
  }, [mode, saleId, procedureId, amountCents, paidCents, received, method, installments, paidAt]);

  const pick = (m: typeof mode) => {
    touched.current = true;
    setMode(m);
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Valor do atendimento</p>
      <div className="flex flex-wrap gap-1.5 text-sm">
        {matching.length > 0 && (
          <button type="button" onClick={() => pick('existing')} className={cn('rounded-full border px-3 py-1', mode === 'existing' ? 'border-navy-800 bg-navy-800 text-white' : 'hover:bg-secondary')}>
            Usar venda já lançada
          </button>
        )}
        <button type="button" onClick={() => pick('new')} className={cn('rounded-full border px-3 py-1', mode === 'new' ? 'border-navy-800 bg-navy-800 text-white' : 'hover:bg-secondary')}>
          Lançar valor
        </button>
        <button type="button" onClick={() => pick('none')} className={cn('rounded-full border px-3 py-1', mode === 'none' ? 'border-navy-800 bg-navy-800 text-white' : 'hover:bg-secondary')}>
          Sem valor agora
        </button>
      </div>

      {mode === 'existing' && (
        <div className="space-y-1.5">
          {matching.map((s) => (
            <label key={s.id} className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm', saleId === s.id && 'border-navy-600 bg-navy-50')}>
              <span className="flex items-center gap-2">
                <input type="radio" checked={saleId === s.id} onChange={() => setSaleId(s.id)} />
                {s.procedureName ?? 'Venda'} · {brl(s.amountCents)}
              </span>
              <span className="text-xs text-muted-foreground">
                {s.balanceCents > 0 ? `saldo ${brl(s.balanceCents)}` : 'pago'}
                {s.linkedAppointments ? ` · ${s.linkedAppointments} horário(s)` : ''}
              </span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">O horário fica ligado a essa venda: nada é lançado em dobro.</p>
        </div>
      )}

      {mode === 'new' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Valor (R$)${proc?.defaultPriceCents ? ` · tabela ${brl(proc.defaultPriceCents)}` : ''}`}>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  touched.current = true;
                  setAmount(e.target.value);
                }}
                placeholder="0,00"
              />
            </Field>
            {canPay && (
              <Field label="Pagamento">
                <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={received} onChange={(e) => setReceived(e.target.value as any)}>
                  <option value="none">Ainda não pagou (paga no dia)</option>
                  <option value="full">Pagou tudo</option>
                  <option value="partial">Pagou uma parte (sinal)</option>
                </select>
              </Field>
            )}
          </div>
          {received !== 'none' && (
            <div className="grid gap-3 sm:grid-cols-3">
              {received === 'partial' && (
                <Field label="Valor pago (R$)">
                  <Input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0,00" />
                </Field>
              )}
              <PaymentFields method={method} setMethod={setMethod} installments={installments} setInstallments={setInstallments} />
              <Field label="Pago em">
                <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </Field>
            </div>
          )}
          {amountCents > 0 && (
            <p className="text-xs text-muted-foreground">
              Vai para o Financeiro como venda de {brl(amountCents)}
              {paidCents > 0 ? `, com ${brl(paidCents)} recebido` : ''}
              {amountCents - paidCents > 0 ? `; saldo de ${brl(amountCents - paidCents)} a receber no dia do horário.` : '.'}
            </p>
          )}
        </div>
      )}
      {mode === 'none' && <p className="text-xs text-muted-foreground">Ex.: avaliação. Dá para lançar o valor depois, pelo próprio agendamento.</p>}
    </div>
  );
}
