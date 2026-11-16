'use client';

import { useCallback, useEffect, useState } from 'react';

/** Todas as chamadas passam pelo proxy do Next, que injeta o token do cookie httpOnly. */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy${path}`, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    // "Load failed" (Safari) / "Failed to fetch" (Chrome): a requisição nem chegou a ter resposta.
    throw new Error('Não foi possível falar com o servidor (internet instável ou a página ficou em segundo plano). Tente de novo.');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sessão expirada');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `Erro ${res.status}`);
  return data as T;
}

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Executa uma ação e mostra o erro em linha (sem bloquear a tela). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
