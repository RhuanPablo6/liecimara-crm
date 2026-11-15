const TZ = 'America/Sao_Paulo';

export const brl = (cents: number | null | undefined) =>
  cents == null ? '—' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR'));

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

export const roas = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`);

export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—';

export const date = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ }) : '—';

export const phone = (waId: string | null | undefined) => {
  if (!waId) return '—';
  const m = waId.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${waId}`;
};

/** Converte "1.234,56" ou "1234.56" para centavos. */
export const parseBRL = (v: string): number | null => {
  const clean = v.replace(/[^\d,.-]/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

/** Período rápido → { from, to } em ISO. */
export function presetRange(preset: '7d' | '30d' | '90d' | 'month') {
  const to = new Date();
  const from = new Date(to);
  if (preset === 'month') from.setDate(1), from.setHours(0, 0, 0, 0);
  else from.setDate(to.getDate() - Number.parseInt(preset));
  return { from: from.toISOString(), to: to.toISOString() };
}
