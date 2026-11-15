// Contas de anúncios configuradas na integração Meta.
// Valor salvo em IntegrationConnection.adAccountId:
//   - "all"                → todas as contas a que o token tem acesso;
//   - "123,456" (sem act_) → somente essas contas.

export const ALL_AD_ACCOUNTS = 'all';

/** Normaliza o que o usuário digitou: vazio → "all"; lista → IDs sem "act_", sem repetição. */
export function normalizeAdAccountsInput(input: string | null | undefined): string {
  const ids = (input ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^act_/i, ''))
    .filter(Boolean);
  if (ids.length === 0) return ALL_AD_ACCOUNTS;
  const invalid = ids.filter((id) => !/^\d+$/.test(id));
  if (invalid.length) throw new Error(`ID de conta de anúncios inválido: ${invalid.join(', ')}`);
  return [...new Set(ids)].join(',');
}

/** Lista de IDs salvos (vazia quando o modo é "todas as contas"). */
export function parseAdAccounts(stored: string | null | undefined): string[] {
  if (!stored || stored === ALL_AD_ACCOUNTS) return [];
  return stored.split(',').filter(Boolean);
}
