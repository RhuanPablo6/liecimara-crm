// Orçamentos: montados na consulta, mostrados/enviados à paciente e guardados no perfil dela.
// Aprovado, vira venda(s) no funil (uma por procedimento), mantendo o vínculo para o histórico.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError, NotFoundError } from '../../domain/errors.js';
import type { Quote, QuoteItem } from '../../domain/types.js';
import type { Clock } from '../../shared/ids.js';
import type { Repos } from '../../ports/repositories.js';
import type { Actor, FunnelService } from '../funnel/FunnelService.js';

export type QuoteStatusView = Quote['status'] | 'EXPIRED';

export interface QuoteInput {
  contactId?: string | null;
  /** Paciente nova: cria o contato/lead pelo WhatsApp. */
  newPatient?: { waId: string; name: string } | null;
  items: QuoteItem[];
  discountCents?: number;
  validUntil: Date;
  paymentTerms?: string | null;
  notes?: string | null;
}

const sign = (id: string, secret: string) => createHmac('sha256', `${secret}:quote-link`).update(id).digest('base64url').slice(0, 22);
export const quoteToken = (id: string, secret: string) => `${id}.${sign(id, secret)}`;
export function readQuoteToken(token: string, secret: string): string | null {
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[\w-]{6,64}$/.test(id)) return null;
  const expected = Buffer.from(sign(id, secret));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null;
}

export const itemTotal = (i: QuoteItem) => i.quantity * i.unitPriceCents - i.discountCents;

export class QuoteService {
  constructor(
    private readonly repos: Repos,
    private readonly funnel: FunnelService,
    private readonly clock: Clock,
  ) {}

  effectiveStatus(q: Quote): QuoteStatusView {
    if (q.status === 'OPEN' && q.validUntil.getTime() < this.clock.now().getTime()) return 'EXPIRED';
    return q.status;
  }

  private async normalize(items: QuoteItem[], discountCents = 0) {
    if (!items.length) throw new DomainError('VALIDATION', 'Inclua ao menos um tratamento no orçamento');
    const clean: QuoteItem[] = [];
    for (const i of items) {
      const proc = await this.repos.procedures.findById(i.procedureId);
      if (!proc) throw new NotFoundError('Procedimento', i.procedureId);
      const it: QuoteItem = {
        procedureId: i.procedureId,
        description: (i.description || proc.name).trim().slice(0, 200),
        quantity: Math.max(1, Math.floor(i.quantity || 1)),
        unitPriceCents: Math.max(0, Math.round(i.unitPriceCents)),
        discountCents: Math.max(0, Math.round(i.discountCents || 0)),
      };
      if (itemTotal(it) <= 0) throw new DomainError('VALIDATION', `O valor de "${it.description}" precisa ser maior que zero`);
      clean.push(it);
    }
    const subtotal = clean.reduce((s, i) => s + itemTotal(i), 0);
    const discount = Math.max(0, Math.round(discountCents));
    if (discount >= subtotal) throw new DomainError('VALIDATION', 'O desconto não pode ser maior ou igual ao total');
    return { items: clean, discountCents: discount, totalCents: subtotal - discount };
  }

  async create(input: QuoteInput, actor: Actor): Promise<Quote> {
    let contactId = input.contactId ?? null;
    let leadId: string | null = null;
    if (!contactId) {
      if (!input.newPatient) throw new DomainError('VALIDATION', 'Escolha a paciente');
      const waId = input.newPatient.waId.replace(/\D/g, '');
      const existing = await this.repos.contacts.findByWaId(waId);
      if (existing) contactId = existing.id;
      else {
        const lead = await this.funnel.createLeadManually({ waId, name: input.newPatient.name, origin: null }, actor);
        contactId = lead.contactId;
        leadId = lead.id;
      }
    }
    const contact = await this.repos.contacts.findById(contactId!);
    if (!contact) throw new NotFoundError('Paciente', contactId);
    if (!leadId) leadId = (await this.repos.leads.findOpenByContact(contact.id))?.id ?? (await this.repos.leads.findLatestByContact(contact.id))?.id ?? null;
    const n = await this.normalize(input.items, input.discountCents);
    const q = await this.repos.quotes.create({
      contactId: contact.id,
      leadId,
      status: 'OPEN',
      ...n,
      validUntil: input.validUntil,
      paymentTerms: input.paymentTerms?.trim() || null,
      notes: input.notes?.trim() || null,
      saleIds: null,
      decidedAt: null,
      createdById: actor.id,
    });
    await this.repos.audit.log({ userId: actor.id, action: 'quote.create', entityType: 'Quote', entityId: q.id, after: q, ip: actor.ip });
    return q;
  }

  private async get(id: string) {
    const q = await this.repos.quotes.findById(id);
    if (!q) throw new NotFoundError('Orçamento', id);
    return q;
  }

  async update(id: string, input: Omit<QuoteInput, 'contactId' | 'newPatient'>, actor: Actor) {
    const q = await this.get(id);
    if (q.status !== 'OPEN') throw new DomainError('QUOTE_LOCKED', 'Só dá para editar orçamento em aberto. Reabra-o antes.');
    const n = await this.normalize(input.items, input.discountCents);
    const updated = await this.repos.quotes.update(id, {
      ...n,
      validUntil: input.validUntil,
      paymentTerms: input.paymentTerms?.trim() || null,
      notes: input.notes?.trim() || null,
    });
    await this.repos.audit.log({ userId: actor.id, action: 'quote.update', entityType: 'Quote', entityId: id, before: q, after: updated, ip: actor.ip });
    return updated;
  }

  async setStatus(id: string, status: 'OPEN' | 'REJECTED' | 'APPROVED', actor: Actor) {
    const q = await this.get(id);
    if (status === 'OPEN' && q.saleIds?.length) {
      throw new DomainError('QUOTE_HAS_SALES', 'Este orçamento já virou venda. Cancele as vendas no lead antes de reabrir.');
    }
    const updated = await this.repos.quotes.update(id, { status, decidedAt: status === 'OPEN' ? null : this.clock.now() });
    await this.repos.audit.log({ userId: actor.id, action: `quote.${status.toLowerCase()}`, entityType: 'Quote', entityId: id, ip: actor.ip });
    return updated;
  }

  /** Aprova e lança uma venda por tratamento (desconto geral rateado). */
  async convertToSales(id: string, actor: Actor) {
    const q = await this.get(id);
    if (q.saleIds?.length) throw new DomainError('QUOTE_HAS_SALES', 'As vendas deste orçamento já foram lançadas');
    if (q.status === 'REJECTED') throw new DomainError('QUOTE_REJECTED', 'Orçamento recusado. Reabra-o antes de aprovar.');
    let leadId = q.leadId;
    const open = await this.repos.leads.findOpenByContact(q.contactId);
    if (open) leadId = open.id;
    else if (!leadId || !(await this.repos.leads.findById(leadId))) {
      const latest = await this.repos.leads.findLatestByContact(q.contactId);
      if (latest) leadId = latest.id;
      else {
        const contact = await this.repos.contacts.findById(q.contactId);
        if (!contact?.waId) throw new DomainError('VALIDATION', 'Paciente sem telefone para abrir o lead');
        leadId = (await this.funnel.createLeadManually({ waId: contact.waId, name: contact.name ?? undefined, origin: null }, actor)).id;
      }
    }
    const subtotal = q.items.reduce((s, i) => s + itemTotal(i), 0);
    let left = q.discountCents;
    const now = this.clock.now();
    const saleIds: string[] = [];
    for (const [idx, it] of q.items.entries()) {
      const base = itemTotal(it);
      const share = idx === q.items.length - 1 ? left : Math.min(left, Math.round((q.discountCents * base) / subtotal));
      left -= share;
      const sale = await this.funnel.registerSale(leadId!, { procedureId: it.procedureId, amountCents: base - share, soldAt: now }, actor);
      saleIds.push(sale.id);
    }
    const updated = await this.repos.quotes.update(id, { status: 'APPROVED', decidedAt: now, saleIds, leadId });
    await this.repos.audit.log({ userId: actor.id, action: 'quote.convert', entityType: 'Quote', entityId: id, after: { saleIds }, ip: actor.ip });
    return { quote: updated, saleIds, leadId };
  }

  async view(q: Quote) {
    const contact = await this.repos.contacts.findById(q.contactId);
    const procs = new Map((await this.repos.procedures.list()).map((p) => [p.id, p.name]));
    const creator = q.createdById ? await this.repos.users.findById(q.createdById) : null;
    return {
      ...q,
      effectiveStatus: this.effectiveStatus(q),
      subtotalCents: q.items.reduce((s, i) => s + itemTotal(i), 0),
      items: q.items.map((i) => ({ ...i, procedureName: procs.get(i.procedureId) ?? null, totalCents: itemTotal(i) })),
      patient: contact ? { id: contact.id, name: contact.name ?? contact.profileName ?? null, waId: contact.waId } : null,
      createdByName: creator?.name ?? null,
    };
  }

  async list(f: { contactId?: string; from?: Date; to?: Date; status?: QuoteStatusView }) {
    const all = await this.repos.quotes.list(f);
    const contacts = new Map<string, { name: string | null; waId: string | null }>();
    for (const id of new Set(all.map((q) => q.contactId))) {
      const c = await this.repos.contacts.findById(id);
      contacts.set(id, { name: c?.name ?? c?.profileName ?? null, waId: c?.waId ?? null });
    }
    return all
      .map((q) => ({
        id: q.id,
        number: q.number,
        contactId: q.contactId,
        patientName: contacts.get(q.contactId)?.name ?? null,
        waId: contacts.get(q.contactId)?.waId ?? null,
        status: q.status,
        effectiveStatus: this.effectiveStatus(q),
        totalCents: q.totalCents,
        itemsCount: q.items.length,
        summary: q.items.map((i) => i.description).join(', '),
        validUntil: q.validUntil,
        createdAt: q.createdAt,
        decidedAt: q.decidedAt,
        converted: !!q.saleIds?.length,
      }))
      .filter((q) => !f.status || q.effectiveStatus === f.status);
  }
}
