'use client';

import { Landmark, Percent, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { brl, parseBRL } from '@/lib/format';

const METHODS: Record<string, string> = {
  PIX: 'Pix',
  DEBIT_CARD: 'Débito',
  CREDIT_CARD: 'Crédito',
  CASH: 'Dinheiro',
  BANK_TRANSFER: 'Transferência',
  OTHER: 'Outro',
};

interface Rule {
  method: string;
  minInstallments: number;
  maxInstallments: number;
  feePct: number;
  receiveDays: number;
  anticipated: boolean;
}

type FormRule = { method: string; min: string; max: string; fee: string; days: string; anticipated: boolean };

const toForm = (r: Rule): FormRule => ({
  method: r.method,
  min: String(r.minInstallments),
  max: String(r.maxInstallments),
  fee: String(r.feePct).replace('.', ','),
  days: String(r.receiveDays),
  anticipated: r.anticipated,
});

const num = (v: string) => Number.parseFloat(v.replace(',', '.'));

function RulesEditor({ initial, defaults, onDone }: { initial: Rule[]; defaults: Rule[]; onDone: () => void }) {
  const [rows, setRows] = useState<FormRule[]>(initial.map(toForm));
  const { busy, error, run } = useAction();
  const set = (i: number, patch: Partial<FormRule>) => setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const parsed = rows.map((r) => ({
    method: r.method,
    minInstallments: r.method === 'CREDIT_CARD' ? Number.parseInt(r.min, 10) : 1,
    maxInstallments: r.method === 'CREDIT_CARD' ? Number.parseInt(r.max, 10) : 1,
    feePct: num(r.fee || '0'),
    receiveDays: Number.parseInt(r.days || '0', 10),
    anticipated: r.method === 'CREDIT_CARD' ? r.anticipated : false,
  }));
  const valid = parsed.every(
    (r) =>
      Number.isFinite(r.feePct) && r.feePct >= 0 && r.feePct <= 30 && Number.isInteger(r.receiveDays) && r.receiveDays >= 0 &&
      r.minInstallments >= 1 && r.maxInstallments >= r.minInstallments && r.maxInstallments <= 24,
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Copie da sua maquininha (ou do contrato com a adquirente) a taxa de cada forma de pagamento e em quantos dias o dinheiro cai na conta. No
        crédito parcelado sem antecipação, cada parcela cai 30 dias depois da anterior.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-2 font-medium">Forma</th>
              <th className="pb-2 pr-2 font-medium">Parcelas</th>
              <th className="pb-2 pr-2 font-medium">Taxa %</th>
              <th className="pb-2 pr-2 font-medium">Cai em (dias)</th>
              <th className="pb-2 pr-2 font-medium">Antecipa</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-middle">
                <td className="py-1 pr-2">
                  <NativeSelect className="w-36" value={r.method} onChange={(e) => set(i, { method: e.target.value })}>
                    {Object.entries(METHODS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="py-1 pr-2">
                  {r.method === 'CREDIT_CARD' ? (
                    <div className="flex items-center gap-1">
                      <Input aria-label="De" className="w-14" inputMode="numeric" value={r.min} onChange={(e) => set(i, { min: e.target.value })} />
                      <span className="text-muted-foreground">a</span>
                      <Input aria-label="Até" className="w-14" inputMode="numeric" value={r.max} onChange={(e) => set(i, { max: e.target.value })} />
                      <span className="text-muted-foreground">x</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label="Taxa" className="w-20" inputMode="decimal" value={r.fee} onChange={(e) => set(i, { fee: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label="Dias" className="w-20" inputMode="numeric" value={r.days} onChange={(e) => set(i, { days: e.target.value })} />
                </td>
                <td className="py-1 pr-2 text-center">
                  {r.method === 'CREDIT_CARD' ? (
                    <input
                      type="checkbox"
                      aria-label="Antecipação"
                      className="size-4 accent-navy-700"
                      checked={r.anticipated}
                      onChange={(e) => set(i, { anticipated: e.target.checked })}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-1">
                  <Button size="icon" variant="ghost" aria-label="Remover" onClick={() => setRows((cur) => cur.filter((_, idx) => idx !== i))}>
                    <X />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRows((cur) => [...cur, { method: 'CREDIT_CARD', min: '2', max: '12', fee: '0', days: '30', anticipated: false }])}
        >
          <Plus /> Adicionar faixa
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRows(defaults.map(toForm))}>
          Restaurar padrão (sem taxa)
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button
        disabled={busy || !valid}
        onClick={() =>
          run(async () => {
            await api('/finance/settings/fees', { method: 'PUT', body: { rules: parsed } });
            onDone();
          })
        }
      >
        Salvar taxas
      </Button>
    </div>
  );
}

/** Taxas da maquininha e prazos de recebimento. */
export function FeesDialog({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<any>(open ? '/finance/settings' : null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Percent /> Taxas e prazos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Taxas da maquininha e prazos</DialogTitle>
        </DialogHeader>
        {!data && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {data && (
          <RulesEditor
            initial={data.feeRules}
            defaults={data.defaultFeeRules}
            onDone={async () => {
              await reload();
              setOpen(false);
              onSaved?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Saldo atual em conta: ponto de partida do fluxo de caixa projetado. */
export function CashBalanceDialog({ current, onSaved }: { current: { amountCents: number; asOf: string } | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(today());
  const { busy, error, run } = useAction();
  const negative = amount.trim().startsWith('-');
  const raw = amount.replace('-', '').trim();
  const cents = /^0+([.,]0+)?$/.test(raw) ? 0 : parseBRL(raw);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setAmount(current ? (current.amountCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
          setAsOf(today());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Landmark /> Saldo em conta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Saldo atual em conta</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Some o saldo das contas da clínica (banco + maquininha). É o ponto de partida da projeção; atualize sempre que conferir o extrato.
          {current && ` Último informado: ${brl(current.amountCents)} em ${current.asOf.split('-').reverse().join('/')}.`}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Saldo (R$)">
            <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Conferido em">
            <Input type="date" max={today()} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button
          disabled={busy || cents == null}
          onClick={() =>
            run(async () => {
              await api('/finance/settings/cash', { method: 'PUT', body: { amountCents: negative ? -cents! : cents, asOf } });
              setOpen(false);
              onSaved();
            })
          }
        >
          Salvar saldo
        </Button>
      </DialogContent>
    </Dialog>
  );
}
