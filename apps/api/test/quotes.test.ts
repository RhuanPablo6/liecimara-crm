// Orçamentos: total com descontos, histórico por paciente, validade e conversão em vendas.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quoteToken, readQuoteToken } from '../src/modules/quotes/QuoteService.js';
import { actor, buildWorld, seedProcedure } from './helpers.js';

describe('Orçamentos', () => {
  it('calcula total, guarda no perfil e vira vendas com desconto rateado', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const preench = await seedProcedure(w, 'Preenchimento');
    const lead = await w.funnel.createLeadManually({ waId: '5511900000101', name: 'Ana Souza' }, actor);
    const q = await w.quotes.create(
      {
        contactId: lead.contactId,
        items: [
          { procedureId: botox.id, description: '', quantity: 1, unitPriceCents: 150000, discountCents: 0 },
          { procedureId: preench.id, description: 'Preenchimento labial', quantity: 2, unitPriceCents: 100000, discountCents: 20000 },
        ],
        discountCents: 30000,
        validUntil: new Date('2026-12-01T15:00:00Z'),
        paymentTerms: 'Pix ou 3x no cartão',
      },
      actor,
    );
    assert.equal(q.totalCents, 150000 + 180000 - 30000);
    assert.equal(q.items[0].description, 'Botox');
    assert.equal(q.leadId, lead.id);
    const hist = await w.quotes.list({ contactId: lead.contactId });
    assert.equal(hist.length, 1);
    assert.equal(hist[0].effectiveStatus, 'OPEN');

    const r = await w.quotes.convertToSales(q.id, actor);
    assert.equal(r.saleIds.length, 2);
    const sales = await Promise.all(r.saleIds.map((id) => w.repos.sales.findById(id)));
    assert.equal(sales.reduce((s, x) => s + x!.amountCents, 0), q.totalCents);
    assert.equal((await w.repos.leads.findById(lead.id))!.stage, 'WON');
    assert.equal((await w.repos.quotes.findById(q.id))!.status, 'APPROVED');
    await assert.rejects(() => w.quotes.convertToSales(q.id, actor), /já foram lançadas/);
    await assert.rejects(() => w.quotes.update(q.id, { items: q.items, validUntil: q.validUntil }, actor), /em aberto/);
    await assert.rejects(() => w.quotes.setStatus(q.id, 'OPEN', actor), /virou venda/);

    const del = await w.quotes.purge(q.id, actor);
    assert.equal(del.removedSales, 2);
    assert.equal(await w.repos.quotes.findById(q.id), null);
    assert.equal(await w.repos.sales.findById(r.saleIds[0]!), null);
    assert.notEqual((await w.repos.leads.findById(lead.id))!.stage, 'WON');
  });

  it('cria paciente nova, vence pela validade e valida o link público', async () => {
    const w = buildWorld('2026-11-16T15:00:00.000Z');
    const botox = await seedProcedure(w, 'Botox');
    const q = await w.quotes.create(
      {
        newPatient: { waId: '(11) 90000-0102', name: 'Bia' },
        items: [{ procedureId: botox.id, description: '', quantity: 1, unitPriceCents: 90000, discountCents: 0 }],
        validUntil: new Date('2026-11-15T15:00:00Z'),
      },
      actor,
    );
    assert.ok(q.leadId);
    assert.equal((await w.repos.contacts.findById(q.contactId))!.name, 'Bia');
    assert.equal((await w.quotes.list({ status: 'EXPIRED' })).length, 1);
    await assert.rejects(
      () => w.quotes.create({ contactId: q.contactId, items: [{ procedureId: botox.id, description: '', quantity: 1, unitPriceCents: 1000, discountCents: 0 }], discountCents: 1000, validUntil: new Date() }, actor),
      /desconto/,
    );
    const t = quoteToken(q.id, 'segredo');
    assert.equal(readQuoteToken(t, 'segredo'), q.id);
    assert.equal(readQuoteToken(t, 'outro'), null);
    await w.quotes.setStatus(q.id, 'REJECTED', actor);
    await assert.rejects(() => w.quotes.convertToSales(q.id, actor), /recusado/);
  });
});
