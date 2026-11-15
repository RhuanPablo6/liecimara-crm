// Códigos curtos de anúncio (ex.: "U1"), usados na mensagem pronta do anúncio
// para a recepção identificar a origem do contato.

/** Normaliza para MAIÚSCULAS sem espaços; aceita 1 a 10 letras/números. */
export function normalizeAdCode(input: string): string {
  const code = input.trim().toUpperCase().replace(/^[([{]+|[)\]}]+$/g, '');
  if (!/^[A-Z0-9]{1,10}$/.test(code)) {
    throw new Error('Código inválido: use de 1 a 10 letras ou números, sem espaços (ex.: U1)');
  }
  return code;
}

/** Próximos códigos livres na sequência A1, A2, ... (pula os já usados). */
export function nextFreeCodes(used: Iterable<string>, count: number, prefix = 'A'): string[] {
  const taken = new Set(used);
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) {
    const c = `${prefix}${n}`;
    if (!taken.has(c)) out.push(c);
  }
  return out;
}

/** Mensagem sugerida para o campo "mensagem pronta" do anúncio de WhatsApp. */
export function suggestedMessage(code: string): string {
  return `Olá! Vi o anúncio e gostaria de mais informações (${code})`;
}
