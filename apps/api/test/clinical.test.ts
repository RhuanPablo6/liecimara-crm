// Prontuário: anamnese com alertas, termo assinado (imutável, com hash), sessões com lote e fotos.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANAMNESIS_TEMPLATE } from '../src/modules/clinical/templates.js';
import { formToken } from '../src/modules/clinical/ClinicalService.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

const SIG = `data:image/png;base64,${'A'.repeat(2000)}`;
const allNo = () => {
  const a: Record<string, { a: string; detail?: string | null }> = {};
  for (const s of ANAMNESIS_TEMPLATE) for (const q of s.items) a[q.id] = { a: q.type === 'yesno' ? 'Não' : 'texto' };
  return a;
};

describe('Prontuário', () => {
  it('anamnese: paciente responde e assina pelo link; alertas aparecem no prontuário', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000201', name: 'Ana Lima' }, actor);
    const f = await w.clinical.createForm(lead.contactId, { kind: 'ANAMNESIS' }, actor);
    const token = formToken(f.id, 'segredo-teste');
    const v = await w.clinical.publicView(token);
    assert.equal(v.firstName, 'Ana');
    assert.ok(v.template);

    const partial = allNo();
    delete partial.allergy;
    await assert.rejects(() => w.clinical.publicSign(token, { signerName: 'Ana Lima', signature: SIG, answers: partial, accept: true }, { ip: '1.2.3.4', userAgent: 'x' }), /faltam 1/);

    const ans = allNo();
    ans.allergy = { a: 'Sim', detail: 'lidocaína' };
    await w.clinical.publicSign(token, { signerName: 'Ana Lima', signature: SIG, answers: ans, accept: true }, { ip: '1.2.3.4', userAgent: 'Safari' });
    const signed = await w.repos.clinical.findForm(f.id);
    assert.equal(signed!.status, 'SIGNED');
    assert.equal(signed!.signedIp, '1.2.3.4');
    assert.match(signed!.contentHash!, /^[0-9a-f]{64}$/);
    await assert.rejects(() => w.clinical.publicSign(token, { signerName: 'Ana Lima', signature: SIG, answers: ans, accept: true }, { ip: null, userAgent: null }), /já foi assinado/);
    await assert.rejects(() => w.clinical.fillAnamnesis(f.id, ans, actor), /já assinada/);

    const rec = await w.clinical.record(lead.contactId, actor);
    assert.equal(rec.alerts.length, 1);
    assert.equal(rec.alerts[0]!.detail, 'lidocaína');
    await assert.rejects(() => w.clinical.deleteForm(f.id, actor, { allowSigned: false }), /não pode ser excluído/);
    assert.equal(await w.clinical.publicView('xx.yyyyyyyyyy').catch((e) => e.message), 'Link inválido');
  });

  it('termo: modelo pelo procedimento, nome da paciente no texto e uso de imagem obrigatório', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000202', name: 'Bia Souza' }, actor);
    const f = await w.clinical.createForm(lead.contactId, { kind: 'CONSENT', procedureId: botox.id }, actor);
    assert.match(f.title, /toxina/);
    assert.match(f.content.text, /Eu, Bia Souza/);
    const token = formToken(f.id, 'segredo-teste');
    await assert.rejects(() => w.clinical.publicSign(token, { signerName: 'Bia Souza', signature: SIG, accept: true }, { ip: null, userAgent: null }), /uso das suas fotos/);
    await assert.rejects(() => w.clinical.publicSign(token, { signerName: 'Bia', signature: SIG, imageUse: 'NONE', accept: true }, { ip: null, userAgent: null }), /nome completo/);
    await w.clinical.publicSign(token, { signerName: 'Bia Souza', signerDocument: '123.456.789-00', signature: SIG, imageUse: 'MARKETING', accept: true }, { ip: null, userAgent: null });
    const rec = await w.clinical.record(lead.contactId, actor);
    assert.equal(rec.imageUse, 'MARKETING');
    assert.equal((await w.repos.clinical.findForm(f.id))!.signerDocument, '12345678900');
  });

  it('sessão com lote e fotos de antes/depois vinculadas', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000203', name: 'Carla' }, actor);
    const s = await w.clinical.saveSession(
      lead.contactId,
      { performedAt: new Date('2026-11-16T14:00:00Z'), products: [{ name: 'Toxina X', lot: 'L123', quantity: 50, unit: 'U' }, { name: ' ', lot: null, quantity: null, unit: null }], areas: 'Terço superior' },
      actor,
    );
    assert.equal(s.products.length, 1);
    const jpeg = Buffer.from('fake-jpeg-bytes'.repeat(20)).toString('base64');
    const p = await w.clinical.addPhoto(lead.contactId, { data: jpeg, thumb: jpeg, mime: 'image/jpeg', width: 1200, height: 1600, stage: 'BEFORE', sessionId: s.id }, actor);
    assert.equal((await w.clinical.photoBytes(p.id, 'full')).bytes.toString(), 'fake-jpeg-bytes'.repeat(20));
    await assert.rejects(() => w.clinical.addPhoto(lead.contactId, { data: jpeg, thumb: jpeg, mime: 'application/pdf', width: 1, height: 1, stage: 'AFTER' }, actor), /Formato/);
    await w.clinical.deleteSession(s.id, actor);
    assert.equal((await w.repos.clinical.findPhoto(p.id))!.sessionId, null);
    assert.ok((await w.clinical.storage()).photoBytes > 0);
  });
});
