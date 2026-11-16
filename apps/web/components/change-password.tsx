'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input } from '@/components/ui/form';
import { api, useAction } from '@/lib/api';

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run, setError } = useAction();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Alterar minha senha</DialogTitle>
          <DialogDescription>Use ao menos 8 caracteres.</DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Senha alterada.</p>
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          </>
        ) : (
          <>
            <Field label="Senha atual">
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="Nova senha">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Repita a nova senha">
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button
              disabled={busy || !current || next.length < 8}
              onClick={() => {
                if (next !== confirm) return setError('As senhas novas não conferem');
                void run(async () => {
                  await api('/auth/password', { method: 'POST', body: { current, next } });
                  setDone(true);
                });
              }}
            >
              Salvar nova senha
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
