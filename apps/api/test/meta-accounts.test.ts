// Sincronização com várias contas de anúncios.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeAdAccountsInput, parseAdAccounts } from '../src/modules/meta/adAccounts.js';
import { buildWorld } from './helpers.js';

/** Meta fictícia: duas contas, cada uma com uma campanha/anúncio/insight. */
function fakeMeta(url: string, opts: { failAccount?: string } = {}) {
  if (url.includes('/me/adaccounts')) {
    return {
      status: 200,
      json: { data: [
        { id: 'act_111', account_id: '111', name: 'Conta A' },
        { id: 'act_222', account_id: '222', name: 'Conta B' },
      ] },
    };
  }
  const acc = url.match(/act_(\d+)\//)?.[1] ?? '';
  if (opts.failAccount && acc === opts.failAccount) {
    return { status: 400, json: { error: { message: 'Sem permissão na conta', code: 200 } } };
  }
  if (url.includes('/insights')) {
    return { status: 200, json: { data: [{ ad_id: `AD-${acc}`, date_start: '2026-11-01', spend: '10.00', impressions: '100', clicks: '5' }] } };
  }
  if (url.includes('/ads?')) return { status: 200, json: { data: [{ id: `AD-${acc}`, name: `Anúncio ${acc}`, adset_id: `SET-${acc}`, campaign_id: `CMP-${acc}` }] } };
  if (url.includes('/adsets')) return { status: 200, json: { data: [{ id: `SET-${acc}`, name: 'Conjunto', campaign_id: `CMP-${acc}` }] } };
  return { status: 200, json: { data: [{ id: `CMP-${acc}`, name: `Campanha ${acc}` }] } };
}

describe('Meta: várias contas de anúncios', () => {
  it('normaliza a entrada do usuário', () => {
    assert.equal(normalizeAdAccountsInput(''), 'all');
    assert.equal(normalizeAdAccountsInput('  '), 'all');
    assert.equal(normalizeAdAccountsInput('act_111, 222;act_111'), '111,222');
    assert.throws(() => normalizeAdAccountsInput('act_111, abc'), /inválido/);
    assert.deepEqual(parseAdAccounts('all'), []);
    assert.deepEqual(parseAdAccounts('111,222'), ['111', '222']);
    assert.deepEqual(parseAdAccounts('1491280766137342'), ['1491280766137342']); // valor salvo antes da mudança
  });

  it('modo "todas": descobre as contas do token e importa as duas', async () => {
    const w = buildWorld();
    await w.integrations.configureMeta({ adAccountIds: '', accessToken: 'token-de-teste-123456789' }, { id: 'u', role: 'ADMIN' });
    w.http.handler = (url) => fakeMeta(url);
    const r = await w.metaSync.sync();
    assert.equal(r.accounts, 2);
    assert.equal(r.ads, 2);
    assert.equal(r.insightRows, 2);
    const ads = await w.repos.ads.listAds();
    assert.deepEqual(ads.map((a) => a.metaId).sort(), ['AD-111', 'AD-222']);
    assert.equal((await w.repos.connections.find('META_MARKETING', 'HOMOLOG'))!.status, 'CONNECTED');
  });

  it('lista explícita: só as contas informadas', async () => {
    const w = buildWorld();
    await w.integrations.configureMeta({ adAccountIds: 'act_222', accessToken: 'token-de-teste-123456789' }, { id: 'u', role: 'ADMIN' });
    w.http.handler = (url) => fakeMeta(url);
    const r = await w.metaSync.sync();
    assert.equal(r.accounts, 1);
    assert.deepEqual((await w.repos.ads.listAds()).map((a) => a.metaId), ['AD-222']);
    // A lista de contas é consultada só para guardar nome/moeda; não amplia o que é importado.
    assert.ok(!w.http.calls.some((u) => u.includes('act_111/')), 'não importa contas fora da lista');
  });

  it('falha em uma conta não impede as outras; erro registrado e status com alerta', async () => {
    const w = buildWorld();
    await w.integrations.configureMeta({ adAccountIds: '', accessToken: 'token-de-teste-123456789' }, { id: 'u', role: 'ADMIN' });
    w.http.handler = (url) => fakeMeta(url, { failAccount: '222' });
    const r = await w.metaSync.sync();
    assert.deepEqual(r.failedAccounts, ['222']);
    assert.deepEqual((await w.repos.ads.listAds()).map((a) => a.metaId), ['AD-111']);
    assert.equal((await w.repos.connections.find('META_MARKETING', 'HOMOLOG'))!.status, 'DEGRADED');
    const errors = await w.repos.connections.recentErrors('META_MARKETING', 5);
    assert.match(errors[0]!.message, /act_222/);
  });

  it('trocar só as contas mantém o token salvo; sem token nenhum, recusa', async () => {
    const w = buildWorld();
    await assert.rejects(() => w.integrations.configureMeta({ adAccountIds: '' }, { id: 'u', role: 'ADMIN' }), /token/);
    await w.integrations.configureMeta({ adAccountIds: '111', accessToken: 'token-de-teste-123456789' }, { id: 'u', role: 'ADMIN' });
    await w.integrations.configureMeta({ adAccountIds: '' }, { id: 'u', role: 'ADMIN' });
    const conn = await w.repos.connections.find('META_MARKETING', 'HOMOLOG');
    assert.equal(conn!.adAccountId, 'all');
    assert.equal(w.vault.decrypt(conn!.encryptedCredentials!).accessToken, 'token-de-teste-123456789');
  });
});
