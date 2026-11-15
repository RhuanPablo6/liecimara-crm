// Origem do paciente: anúncio (atribuição) ou outras (indicação, Instagram, retorno...).
import type { Lead } from './types.js';

export const ORGANIC_ORIGINS = {
  REFERRAL: 'Indicação',
  INSTAGRAM: 'Instagram (orgânico)',
  GOOGLE: 'Google',
  RETURNING: 'Paciente que retornou',
  WALK_IN: 'Passou na clínica',
  OTHER: 'Outro',
} as const;

export type OrganicOrigin = keyof typeof ORGANIC_ORIGINS;
export type OriginType = 'AD' | OrganicOrigin | 'UNKNOWN';

export const ORIGIN_LABELS: Record<OriginType, string> = { AD: 'Anúncio', ...ORGANIC_ORIGINS, UNKNOWN: 'Não informada' };
export const ORGANIC_KEYS = Object.keys(ORGANIC_ORIGINS) as OrganicOrigin[];

/** Origem efetiva: anúncio quando há atribuição; senão a origem informada; senão desconhecida. */
export function originOf(lead: Pick<Lead, 'adMetaId'> & { originType?: string | null }): OriginType {
  if (lead.adMetaId) return 'AD';
  if (lead.originType && lead.originType in ORGANIC_ORIGINS) return lead.originType as OrganicOrigin;
  return 'UNKNOWN';
}
