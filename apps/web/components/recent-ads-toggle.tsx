'use client';

/** "Mostrar pausados recentes" abaixo da lista de anúncios. */
export function RecentAdsToggle({ value, onChange, count }: { value: boolean; onChange: (v: boolean) => void; count: number }) {
  return (
    <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Incluir anúncios pausados que rodaram nos últimos 30 dias{count ? ` (${count})` : ''}
    </label>
  );
}
