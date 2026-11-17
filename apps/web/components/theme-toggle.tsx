'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyTheme, readTheme, saveTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Automático (segue o aparelho)', icon: Monitor },
];

/** Escolha do tema no rodapé do menu. */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('light');
  useEffect(() => {
    const m = readTheme();
    setMode(m);
    applyTheme(m);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => readTheme() === 'system' && applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return (
    <div className="inline-flex rounded-md bg-white/5 p-0.5" role="radiogroup" aria-label="Aparência">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          title={label}
          onClick={() => {
            setMode(value);
            saveTheme(value);
          }}
          className={cn('rounded px-2 py-1 text-navy-200 transition-colors hover:text-white', mode === value && 'bg-gold-400/15 text-gold-300')}
        >
          <Icon className="size-3.5" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
