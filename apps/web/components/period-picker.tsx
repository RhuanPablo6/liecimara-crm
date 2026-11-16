'use client';

import { cn } from '@/lib/utils';

export type Preset = 'today' | '7d' | '30d' | '90d' | 'month' | 'custom';

/** Datas do período personalizado (AAAA-MM-DD, dias de São Paulo). */
export interface CustomRange {
  from: string;
  to: string;
}

const OPTIONS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: '90d', label: '90 dias' },
  { value: 'custom', label: 'Personalizado' },
];

export const spToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export function defaultCustom(): CustomRange {
  const to = spToday();
  const from = new Date(new Date(`${to}T12:00:00Z`).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export function PeriodPicker({
  value,
  onChange,
  custom,
  onCustomChange,
}: {
  value: Preset;
  onChange: (v: Preset) => void;
  custom?: CustomRange;
  onCustomChange?: (c: CustomRange) => void;
}) {
  const options = onCustomChange ? OPTIONS : OPTIONS.filter((o) => o.value !== 'custom');
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="inline-flex flex-wrap rounded-lg bg-secondary p-1">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition-colors',
              value === o.value ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground hover:text-navy-700',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value === 'custom' && custom && onCustomChange && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">De</span>
          <input
            type="date"
            className="h-8 rounded-md border bg-background px-2"
            value={custom.from}
            max={custom.to}
            onChange={(e) => e.target.value && onCustomChange({ ...custom, from: e.target.value })}
          />
          <span className="text-muted-foreground">até</span>
          <input
            type="date"
            className="h-8 rounded-md border bg-background px-2"
            value={custom.to}
            min={custom.from}
            max={spToday()}
            onChange={(e) => e.target.value && onCustomChange({ ...custom, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
