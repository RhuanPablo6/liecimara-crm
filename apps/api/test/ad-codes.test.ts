// Códigos de anúncio na mensagem pronta + cadastro rápido de lead com origem.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextFreeCodes, normalizeAdCode, suggestedMessage } from '../src/modules/ads/adCodes.js';
import { actor, buildWorld, seedAd } from './helpers.js';

describe('Códigos de anúncio', () => {
  it('normaliza e valida', () => {
    assert.equal(normalizeAdCode(' u1 '), 'U1');
    assert.equal(normalizeAdCode('(p2)'), 'P2');
    assert.throws(() => normalizeAdCode('U 1'), /inválido/);
    assert.throws(() => normalizeAdCode(''), /inválido/);
    assert.throws(() => normalizeAdCode('ABCDEFGHIJK'), /inválido/);
    assert.deepEqual(nextFreeCodes(['A1', 'A3'], 3), ['A2', 'A4', 'A5']);
    assert.match(suggestedMessage('U1'), /\(U1\)$/);
  });

  it('código é único entre anúncios', async () => {
    const w = buildWorld();
    await seedAd(w);
    await w.repos.ads.upsertAds([{ metaId: 'AD-200', adSetMetaId: 'SET-1', campaignMetaId: 'CMP-1', name: 'Outro', status: 'ACTIVE' }]);
    await w.repos.ads.setAdCode('AD-100', 'U1');
    await assert.rejects(() => w.repos.ads.setAdCode('AD-200', 'U1'), /já está em uso/);
    assert.equal((await w.repos.ads.findAdByCode('U1'))!.metaId, 'AD-100');
  });

  it('sincronizar a Meta de novo não apaga o código', async () => {
    const w = buildWorld();
    await seedAd(w);
    await w.repos.ads.setAdCode('AD-100', 'U1');
    await w.repos.ads.upsertAds([{ metaId: 'AD-100', adSetMetaId: 'SET-1', campaignMetaId: 'CMP-1', name: 'Botox (novo nome)', status: 'PAUSED' }]);
    const ad = await w.repos.ads.findAd('AD-100');
    assert.equal(ad!.code, 'U1');
    assert.equal(ad!.name, 'Botox (novo nome)');
  });

  it('lead criado com a origem: atribuição MANUAL, evidência registrada', async () => {
    const w = buildWorld();
    await seedAd(w);
    const lead = await w.funnel.createLeadManually(
      { waId: '5511977776666', name: 'Paciente', attribution: { adMetaId: 'AD-100', note: 'Código do anúncio na mensagem do paciente: U1' } },
      actor,
    );
    assert.equal(lead.attributionConfidence, 'MANUAL');
    assert.equal(lead.adMetaId, 'AD-100');
    assert.equal(lead.campaignMetaId, 'CMP-1');
    const ev = [...w.repos.s.evidence.values()].find((e) => e.leadId === lead.id)!;
    assert.equal(ev.kind, 'MANUAL');
    assert.match(ev.note!, /U1/);
  });

  it('anúncio inexistente: nada é criado (transação desfeita)', async () => {
    const w = buildWorld();
    await assert.rejects(() =>
      w.funnel.createLeadManually({ waId: '5511955554444', attribution: { adMetaId: 'NAO-EXISTE', note: 'x' } }, actor),
    );
    assert.equal(w.repos.s.leads.size, 0);
  });
});
