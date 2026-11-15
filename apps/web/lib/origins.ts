// Origem do paciente (mesmas chaves da API: domain/origin.ts).
export const ORGANIC_ORIGINS: [string, string][] = [
  ['REFERRAL', 'Indicação'],
  ['INSTAGRAM', 'Instagram (orgânico)'],
  ['GOOGLE', 'Google'],
  ['RETURNING', 'Paciente que retornou'],
  ['WALK_IN', 'Passou na clínica'],
  ['OTHER', 'Outro'],
];

export const ORIGIN_LABEL: Record<string, string> = {
  AD: 'Anúncio',
  ...Object.fromEntries(ORGANIC_ORIGINS),
  UNKNOWN: 'Não informada',
};

/** Dica do campo de detalhe para cada origem. */
export const ORIGIN_NOTE_HINT: Record<string, string> = {
  REFERRAL: 'Indicada por quem? (ex.: Maria Souza)',
  INSTAGRAM: 'Qual post ou perfil? (opcional)',
  GOOGLE: 'Pesquisou o quê? (opcional)',
  RETURNING: 'Última vez na clínica (opcional)',
  WALK_IN: 'Detalhe (opcional)',
  OTHER: 'Qual? (ex.: evento, parceria)',
};
