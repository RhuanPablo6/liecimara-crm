'use client';

import { Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ErrorText, Input } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { parseBRL } from '@/lib/format';

const SUGGESTIONS = ['Toxina botulínica', 'Preenchimento', 'Bioestimulador', 'Ultraformer', 'Lavieen', 'Skinbooster', 'Fios de PDO'];

function Row({ p, onSaved }: { p: any; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(p.defaultPriceCents ? (p.defaultPriceCents / 100).toFixed(2).replace('.', ',') : '');
  const { busy, error, run } = useAction();
  const save = (body: Record<string, unknown>) =>
    run(async () => {
      await api(`/procedures/${p.id}`, { method: 'PATCH', body });
      await onSaved();
    });
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
        <Input
          aria-label="Nome do procedimento"
          value={name}
          disabled={busy}
          className={p.active ? '' : 'text-muted-foreground line-through'}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== p.name && save({ name: name.trim() })}
        />
        <Input
          aria-label="Preço sugerido"
          inputMode="decimal"
          placeholder="Preço R$"
          value={price}
          disabled={busy}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => {
            const cents = price.trim() ? parseBRL(price) : null;
            if (cents !== (p.defaultPriceCents ?? null)) save({ defaultPriceCents: cents });
          }}
        />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => save({ active: !p.active })}>
          {p.active ? 'Desativar' : 'Reativar'}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Cadastro de procedimentos (toxina, preenchimento...): base do financeiro por procedimento. */
export function ProceduresDialog({ onChanged }: { onChanged?: () => void }) {
  const { data: procedures, reload } = useApi<any[]>('/procedures');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const { busy, error, run } = useAction();
  const refresh = async () => {
    await reload();
    onChanged?.();
  };
  const create = (n: string, cents: number | null) =>
    run(async () => {
      await api('/procedures', { method: 'POST', body: { name: n, defaultPriceCents: cents } });
      setName('');
      setPrice('');
      await refresh();
    });
  const names = (procedures ?? []).map((p) => p.name.toLowerCase());
  const missing = SUGGESTIONS.filter((s) => !names.some((n) => n.includes(s.toLowerCase())));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 /> Procedimentos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Procedimentos</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Os procedimentos ligam compras de material, anúncios e vendas. O preço é só uma sugestão: na venda você digita o valor real (promoções,
          pacotes…).
        </p>
        <div className="space-y-2">
          {(procedures ?? []).map((p) => (
            <Row key={`${p.id}:${p.name}:${p.defaultPriceCents}:${p.active}`} p={p} onSaved={refresh} />
          ))}
          {procedures && procedures.length === 0 && <p className="text-sm text-muted-foreground">Nenhum procedimento cadastrado ainda.</p>}
        </div>
        <div className="grid grid-cols-[1fr_7rem_auto] gap-2 border-t pt-4">
          <Input placeholder="Novo procedimento" value={name} onChange={(e) => setName(e.target.value)} />
          <Input inputMode="decimal" placeholder="Preço R$" value={price} onChange={(e) => setPrice(e.target.value)} />
          <Button disabled={busy || name.trim().length < 2} onClick={() => create(name.trim(), price.trim() ? parseBRL(price) : null)}>
            <Plus /> Adicionar
          </Button>
        </div>
        {missing.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sugestões:</span>
            {missing.map((s) => (
              <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => create(s, null)}>
                <Plus /> {s}
              </Button>
            ))}
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </DialogContent>
    </Dialog>
  );
}
