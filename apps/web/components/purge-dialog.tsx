'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/components/access';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input } from '@/components/ui/form';
import { api, useAction } from '@/lib/api';

/**
 * Exclusão definitiva (só administrador): pede para digitar APAGAR.
 * Para testes e lançamentos feitos por engano — some da agenda, do financeiro e dos relatórios.
 */
export function PurgeButton({
  endpoint,
  title,
  description,
  label,
  onDone,
  ...btn
}: {
  endpoint: string;
  title: string;
  description: React.ReactNode;
  label?: string;
  onDone: () => void;
} & Omit<ButtonProps, 'onClick'>) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  if (!me?.permissions.includes('records:delete')) return null;
  return (
    <>
      <Button variant="ghost" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" title={title} {...btn} onClick={() => (setText(''), setOpen(true))}>
        <Trash2 /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Não dá para desfazer. Use só para testes e lançamentos feitos por engano.</p>
          <Field label="Digite APAGAR para confirmar">
            <Input autoFocus value={text} onChange={(e) => setText(e.target.value.toUpperCase())} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button
            variant="destructive"
            disabled={busy || text !== 'APAGAR'}
            onClick={() =>
              run(async () => {
                await api(endpoint, { method: 'POST', body: { confirm: 'APAGAR' } });
                setOpen(false);
                onDone();
              })
            }
          >
            <Trash2 /> Apagar definitivamente
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
