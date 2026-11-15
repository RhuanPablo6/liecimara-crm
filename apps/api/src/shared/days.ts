// Dias civis de São Paulo (AAAA-MM-DD). O Brasil não tem horário de verão desde 2019: UTC-3 fixo.

const SP_OFFSET_MS = 3 * 3_600_000;

export const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());

/** Dia civil em São Paulo de um instante. */
export const spDay = (d: Date) => new Date(d.getTime() - SP_OFFSET_MS).toISOString().slice(0, 10);

/** Meia-noite de São Paulo do dia, como instante. */
export const dayStart = (day: string) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + SP_OFFSET_MS);

/** Meio-dia de São Paulo do dia: guarda datas "sem hora" sem risco de mudar de dia. */
export const dayToDate = (day: string) => new Date(`${day}T15:00:00.000Z`);

export const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Segunda-feira da semana do dia. */
export const mondayOf = (day: string) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
};

export const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

/** Intervalo [início do dia `from`, fim do dia `to`] em São Paulo. */
export const dayRange = (from: string, to: string) => ({ from: dayStart(from), to: dayStart(addDays(to, 1)) });
