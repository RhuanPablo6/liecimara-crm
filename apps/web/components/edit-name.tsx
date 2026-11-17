'use client';

// Corrigir o nome da paciente (ex.: veio do WhatsApp como 🌸 ou apelido). Vale para todas as telas.
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input } from '@/components/ui/form';
import { useMe } from '@/components/access';
import { api, useAction } from '@/lib/api';

export function EditNameButton({ contactId, name, onSaved }: { contactId: string; name: string | null; onSaved: () => void }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const { busy, error, run } = useAction();
  if (!me?.permissions.includes('leads:write')) return null;
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-navy-700"
        title="Editar nome"
        onClick={() => {
          // Nome com só emoji/símbolos: abre vazio para digitar o nome certo.
          setValue(name && /\p{L}/u.test(name) ? name : '');
          setOpen(true);
        }}
      >
        <Pencil className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar nome</DialogTitle>
            <DialogDescription>O nome muda em todo o CRM: lead, agenda, financeiro, orçamentos e relatórios. O nome do WhatsApp dela não muda.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api(`/contacts/${contactId}`, { method: 'PATCH', body: { name: value.trim() } }))) {
                setOpen(false);
                onSaved();
              }
            }}
          >
            <Field label="Nome completo">
              <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={name ?? ''} maxLength={120} />
            </Field>
            <ErrorText>{error}</ErrorText>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || value.trim().length < 2}>
                Salvar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
