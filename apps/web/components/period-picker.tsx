'use client';

import { cn } from '@/lib/utils';

export type Preset = '7d' | '30d' | '90d' | 'month';

const OPTIONS: { value: Preset; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: '90d', label: '90 dias' },
];

export function PeriodPicker({ value, onChange }: { value: Preset; onChange: (v: Preset) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-secondary p-1">
      {OPTIONS.map((o) => (
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
  );
}
