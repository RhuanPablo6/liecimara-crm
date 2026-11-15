// Gerenciador de anúncios: status, orçamento e janelas de orçamento, sempre via Meta.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateWindow } from '../src/modules/meta/AdsManagerService.js';
import { actor, buildWorld } from './helpers.js';

/** Meta fictícia com estado: campanha CBO (orçamento na campanha) e campanha ABO (orçamento no conjunto). */
function fakeMeta(w: ReturnType<typeof buildWorld>, opts: { deny?: boolean } = {}) {
  const state: Record<string, any> = {
    'CMP-1': { id: 'CMP-1', name: 'Botox CBO', status: 'ACTIVE', effective_status: 'ACTIVE', account_id: '111', daily_budget: '5000' },
    'CMP-2': { id: 'CMP-2', name: 'Lavieen ABO', status: 'ACTIVE', effective_status: 'ACTIVE', account_id: '111' },
    'SET-1': { id: 'SET-1', name: 'Mulheres 30+', status: 'ACTIVE', effective_status: 'ACTIVE', campaign_id: 'CMP-1' },
    'SET-2': { id: 'SET-2', name: 'SP 25-45', status: 'ACTIVE', effective_status: 'ACTIVE', campaign_id: 'CMP-2', daily_budget: '3000' },
    'AD-1': { id: 'AD-1', name: 'Vídeo', status: 'ACTIVE', effective_status: 'ACTIVE', adset_id: 'SET-1', campaign_id: 'CMP-1' },
    'AD-2': { id: 'AD-2', name: 'Carrossel', status: 'ACTIVE', effective_status: 'ACTIVE', adset_id: 'SET-2', campaign_id: 'CMP-2' },
  };
  const schedules: Record<string, any[]> = {};
  let seq = 0;
  w.http.handler = (url) => {
    const req = w.http.requests.at(-1)!;
    const method = req.init?.method ?? 'GET';
    const path = new URL(url).pathname.replace(/^\/v[\d.]+\//, '');
    if (opts.deny && method !== 'GET') return { status: 403, json: { error: { message: '(#200) Requires ads_management permission', code: 200 } } };
    if (path === 'me/adaccounts') return { status: 200, json: { data: [{ id: 'act_111', account_id: '111', name: 'Clínica', currency: 'BRL' }] } };
    if (path.endsWith('/insights')) return { status: 200, json: { data: [{ ad_id: 'AD-1', date_start: '2026-11-10', spend: '40.00', impressions: '2000', clicks: '50', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '8' }] }] } };
    if (path === 'act_111/campaigns') return { status: 200, json: { data: [state['CMP-1'], state['CMP-2']] } };
    if (path === 'act_111/adsets') return { status: 200, json: { data: [state['SET-1'], state['SET-2']] } };
    if (path === 'act_111/ads') return { status: 200, json: { data: [state['AD-1'], state['AD-2']] } };
    const [id, edge] = path.split('/');
    if (edge === 'adsets') return { status: 200, json: { data: Object.values(state).filter((x) => x.id.startsWith('SET') && x.campaign_id === id) } };
    if (edge === 'ads') return { status: 200, json: { data: Object.values(state).filter((x) => x.id.startsWith('AD') && x.campaign_id === id) } };
    if (edge === 'budget_schedules') {
      if (method === 'POST') {
        const s = { id: `HDP-${++seq}`, ...(req.init!.body as object) };
        (schedules[id!] ??= []).push(s);
        return { status: 200, json: { id: s.id } };
      }
      return { status: 200, json: { data: schedules[id!] ?? [] } };
    }
    if (method === 'DELETE') {
      for (const k of Object.keys(schedules)) schedules[k] = schedules[k]!.filter((s) => s.id !== id);
      return { status: 200, json: { success: true } };
    }
    if (method === 'POST') {
      const body = req.init!.body as Record<string, unknown>;
      Object.assign(state[id!], Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])));
      if (body.status) {
        state[id!].effective_status = body.status;
        // Campanha pausada: conjuntos e anúncios dela ficam "CAMPAIGN_PAUSED" (como na Meta).
        for (const x of Object.values(state)) if (x.campaign_id === id && x.status === 'ACTIVE') x.effective_status = body.status === 'PAUSED' ? 'CAMPAIGN_PAUSED' : 'ACTIVE';
      }
      return { status: 200, json: { success: true } };
    }
    return { status: 200, json: state[id!] };
  };
  return { state, schedules };
}

async function world(opts: { deny?: boolean } = {}) {
  const w = buildWorld('2026-11-15T15:00:00.000Z');
  await w.integrations.configureMeta({ adAccountIds: '', accessToken: 'token-de-teste-123456789' }, { id: 'u', role: 'ADMIN' });
  const meta = fakeMeta(w, opts);
  await w.metaSync.sync();
  return { w, ...meta };
}

const range = { from: new Date('2026-11-01T03:00:00Z'), to: new Date('2026-12-01T03:00:00Z') };

describe('Gerenciador de anúncios', () => {
  it('importa orçamento e veiculação; soma métricas por campanha', async () => {
    const { w } = await world();
    const t = await w.adsManager.tree(range);
    const cbo = t.campaigns.find((c) => c.id === 'CMP-1')!;
    assert.equal(cbo.dailyBudgetCents, 5000);
    assert.equal(cbo.budgetLevel, 'campaign');
    assert.equal(cbo.spendCents, 4000);
    assert.equal(cbo.conversations, 8);
    assert.equal(cbo.costPerConversationCents, 500);
    assert.equal(t.campaigns.find((c) => c.id === 'CMP-2')!.budgetLevel, 'adset');
    assert.equal(t.adSets.find((s) => s.id === 'SET-1')!.usesCampaignBudget, true);
    assert.equal(t.accounts[0]!.name, 'Clínica');
  });

  it('pausar campanha reflete na hora (inclusive nos anúncios)', async () => {
    const { w, state } = await world();
    await w.adsManager.setStatus('campaign', 'CMP-1', 'PAUSED', actor);
    assert.equal(state['CMP-1'].status, 'PAUSED');
    const t = await w.adsManager.tree(range);
    assert.equal(t.campaigns.find((c) => c.id === 'CMP-1')!.effectiveStatus, 'PAUSED');
    assert.equal(t.ads.find((a) => a.id === 'AD-1')!.effectiveStatus, 'CAMPAIGN_PAUSED');
  });

  it('orçamento: no nível certo, em centavos; recusa nível sem orçamento', async () => {
    const { w, state } = await world();
    await w.adsManager.setBudget('campaign', 'CMP-1', 'daily', 6500, actor);
    assert.equal(state['CMP-1'].daily_budget, '6500');
    assert.equal((await w.repos.ads.listCampaigns()).find((c) => c.metaId === 'CMP-1')!.dailyBudgetCents, 6500);
    await assert.rejects(() => w.adsManager.setBudget('campaign', 'CMP-2', 'daily', 6500, actor), /orçamento fica em cada conjunto/);
    await w.adsManager.setBudget('adset', 'SET-2', 'daily', 4000, actor);
    assert.equal(state['SET-2'].daily_budget, '4000');
  });

  it('sem permissão de gestão: mensagem clara', async () => {
    const { w } = await world({ deny: true });
    await assert.rejects(() => w.adsManager.setStatus('ad', 'AD-1', 'PAUSED', actor), /ads_management/);
  });

  it('janelas: regras da Meta, criação em reais inteiros e exclusão', async () => {
    const now = new Date('2026-11-15T15:00:00Z');
    const start = new Date('2026-11-21T12:00:00Z');
    const ok = { start, end: new Date('2026-11-21T18:00:00Z'), increaseCents: 5000 };
    assert.equal(validateWindow(ok, 5000, now), null);
    assert.match(validateWindow({ ...ok, end: new Date('2026-11-21T14:00:00Z') }, 5000, now)!, /3 horas/);
    assert.match(validateWindow({ ...ok, start: new Date('2026-11-21T12:10:00Z') }, 5000, now)!, /15 em 15/);
    assert.match(validateWindow({ ...ok, increaseCents: 40000 }, 5000, now)!, /8×/);
    assert.match(validateWindow(ok, null, now)!, /orçamento diário/);

    const { w, schedules } = await world();
    const r = await w.adsManager.createSchedules('campaign', 'CMP-1', [ok, { ...ok, start: new Date('2026-11-28T12:00:00Z'), end: new Date('2026-11-28T18:00:00Z') }], actor, now);
    assert.equal(r.created, 2);
    assert.equal(schedules['CMP-1']![0].budget_value, 50); // R$ 50 em unidades inteiras
    assert.equal(schedules['CMP-1']![0].budget_value_type, 'ABSOLUTE');
    assert.equal(schedules['CMP-1']![0].time_start, Math.floor(start.getTime() / 1000));
    const list = await w.adsManager.schedules('campaign', 'CMP-1');
    assert.equal(list!.length, 2);
    await w.adsManager.deleteSchedule('campaign', 'CMP-1', list![0]!.id, actor);
    assert.equal((await w.adsManager.schedules('campaign', 'CMP-1'))!.length, 1);
    await assert.rejects(() => w.adsManager.createSchedules('campaign', 'CMP-2', [ok], actor, now), /orçamento diário/);
  });
});
