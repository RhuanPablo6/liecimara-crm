// O cálculo de preço existe em dois lugares (API e tela). Garante que continuam iguais.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

it('lib/pricing.ts da tela é cópia exata do cálculo da API', () => {
  const api = readFileSync(new URL('../src/modules/pricing/pricing.ts', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../../web/lib/pricing.ts', import.meta.url), 'utf8').split('\n').slice(1).join('\n');
  assert.equal(web, api);
});
