// Anúncios para escolher a origem manualmente: só os que estão rodando no Gerenciador.
// Opcional: pausados que ainda rodaram nos últimos 30 dias (lead que demorou a chamar).
const recentCut = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

export function pickableAds<T extends { metaId: string; active?: boolean; lastDeliveryDay?: string | null; code?: string | null; name: string }>(
  ads: T[] | null | undefined,
  opts: { includeRecent?: boolean; keep?: string | null } = {},
): T[] {
  const cut = recentCut();
  return (ads ?? [])
    .filter((a) => a.active || a.metaId === opts.keep || (opts.includeRecent && !!a.lastDeliveryDay && a.lastDeliveryDay >= cut))
    .sort((a, b) => Number(!!b.active) - Number(!!a.active) || `${a.code ?? '~'}|${a.name}`.localeCompare(`${b.code ?? '~'}|${b.name}`, 'pt-BR'));
}

export const adLabel = (a: { code?: string | null; name: string; active?: boolean; lastDeliveryDay?: string | null; campaignName?: string | null }, withCampaign = false) =>
  `${a.code ? `[${a.code}] ` : ''}${a.name}${withCampaign && a.campaignName ? ` — ${a.campaignName}` : ''}${
    a.active ? '' : a.lastDeliveryDay ? ` (pausado, rodou até ${a.lastDeliveryDay.split('-').reverse().slice(0, 2).join('/')})` : ' (pausado)'
  }`;
