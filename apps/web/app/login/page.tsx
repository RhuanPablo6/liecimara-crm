'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorText, Field, Input } from '@/components/ui/form';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? 'Não foi possível entrar');
      return;
    }
    window.location.href = '/';
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-800 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-gold.png" alt="Dra. Liecimara Esteves · Biomédica Esteta" className="mx-auto w-64" />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl bg-white p-6 shadow-xl">
          <Field label="E-mail">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="default" className="w-full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </div>
    </main>
  );
}
