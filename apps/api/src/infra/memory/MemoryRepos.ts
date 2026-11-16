// Implementação em memória das portas de persistência.
// Usada nos testes automatizados e em demonstrações sem banco.
// `tx` faz snapshot e restaura o estado em caso de erro (semântica de rollback).

import { DomainError, NotFoundError } from '../../domain/errors.js';
import type {
  Ad,
  AdAccountInfo,
  AdInsightDaily,
  AdSet,
  Appointment,
  AttributionEvidence,
  AuditEntry,
  Campaign,
  Contact,
  Conversation,
  Expense,
  InboundEvent,
  IntegrationConnection,
  IntegrationError,
  Lead,
  LeadStageHistory,
  Message,
  Payment,
  Procedure,
  ProcedurePerformed,
  RecallAction,
  AgendaBlock,
  Reminder,
  Sale,
  SupplyPurchase,
  User,
} from '../../domain/types.js';
import { OPEN_STAGES } from '../../domain/types.js';
import type { DateRange, LeadFilter, Repos } from '../../ports/repositories.js';
import { newId } from '../../shared/ids.js';

interface State {
  users: Map<string, User>;
  contacts: Map<string, Contact>;
  conversations: Map<string, Conversation>;
  messages: Map<string, Message>;
  leads: Map<string, Lead>;
  evidence: Map<string, AttributionEvidence>;
  stageHistory: Map<string, LeadStageHistory>;
  campaigns: Map<string, Campaign>;
  adSets: Map<string, AdSet>;
  ads: Map<string, Ad>;
  adAccounts: Map<string, AdAccountInfo>;
  insights: Map<string, AdInsightDaily>;
  procedures: Map<string, Procedure>;
  appointments: Map<string, Appointment>;
  sales: Map<string, Sale>;
  payments: Map<string, Payment>;
  purchases: Map<string, SupplyPurchase>;
  expenses: Map<string, Expense>;
  settings: Map<string, unknown>;
  recalls: Map<string, RecallAction>;
  agendaBlocks: Map<string, AgendaBlock>;
  performed: Map<string, ProcedurePerformed>;
  reminders: Map<string, Reminder>;
  connections: Map<string, IntegrationConnection>;
  integrationErrors: IntegrationError[];
  events: Map<string, InboundEvent>;
  audit: (AuditEntry & { id: string; createdAt: Date })[];
}

const emptyState = (): State => ({
  users: new Map(),
  contacts: new Map(),
  conversations: new Map(),
  messages: new Map(),
  leads: new Map(),
  evidence: new Map(),
  stageHistory: new Map(),
  campaigns: new Map(),
  adSets: new Map(),
  ads: new Map(),
  adAccounts: new Map(),
  insights: new Map(),
  procedures: new Map(),
  appointments: new Map(),
  sales: new Map(),
  payments: new Map(),
  purchases: new Map(),
  expenses: new Map(),
  settings: new Map(),
  recalls: new Map(),
  agendaBlocks: new Map(),
  performed: new Map(),
  reminders: new Map(),
  connections: new Map(),
  integrationErrors: [],
  events: new Map(),
  audit: [],
});

const inRange = (d: Date, r: DateRange) => d >= r.from && d < r.to;
const clone = <T>(v: T): T => structuredClone(v);

function insert<T extends { id: string }>(map: Map<string, T>, data: Omit<T, 'id'> & { id?: string }, prefix: string): T {
  const row = { ...data, id: data.id ?? newId(prefix) } as T;
  map.set(row.id, row);
  return clone(row);
}

function patch<T extends { id: string }>(map: Map<string, T>, id: string, data: Partial<T>): T {
  const cur = map.get(id);
  if (!cur) throw new Error(`registro ${id} inexistente`);
  const next = { ...cur, ...data, id };
  map.set(id, next);
  return clone(next);
}

export class MemoryRepos implements Repos {
  s: State = emptyState();
  private txDepth = 0;

  /** Injeção de falhas para testes: chamada no início de cada transação. */
  faultInjector: (() => void) | null = null;

  async tx<T>(fn: (r: Repos) => Promise<T>): Promise<T> {
    if (this.txDepth > 0) return fn(this);
    const snapshot = clone(this.s);
    this.txDepth++;
    try {
      this.faultInjector?.();
      return await fn(this);
    } catch (e) {
      this.s = snapshot;
      throw e;
    } finally {
      this.txDepth--;
    }
  }

  users = {
    findById: async (id: string) => clone(this.s.users.get(id) ?? null),
    findByEmail: async (email: string) => clone([...this.s.users.values()].find((u) => u.email === email) ?? null),
    create: async (d: Omit<User, 'id'>) => insert(this.s.users, d, 'usr_'),
    list: async () => clone([...this.s.users.values()]),
    update: async (id: string, d: Partial<User>) => patch(this.s.users, id, d),
  };

  contacts = {
    findById: async (id: string) => clone(this.s.contacts.get(id) ?? null),
    findByWaId: async (waId: string) => clone([...this.s.contacts.values()].find((c) => c.waId === waId) ?? null),
    findByBsuid: async (b: string) => clone([...this.s.contacts.values()].find((c) => c.bsuid === b) ?? null),
    list: async () => clone([...this.s.contacts.values()]),
    create: async (d: Omit<Contact, 'id'>) => insert(this.s.contacts, d, 'ctc_'),
    update: async (id: string, d: Partial<Contact>) => patch(this.s.contacts, id, d),
  };

  conversations = {
    findCovering: async (contactId: string, at: Date, gapMs: number) =>
      clone(
        [...this.s.conversations.values()]
          .filter(
            (c) =>
              c.contactId === contactId &&
              at.getTime() >= c.startedAt.getTime() - gapMs &&
              at.getTime() <= c.lastMessageAt.getTime() + gapMs,
          )
          .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())[0] ?? null,
      ),
    create: async (d: Omit<Conversation, 'id'>) => insert(this.s.conversations, d, 'cnv_'),
    update: async (id: string, d: Partial<Conversation>) => patch(this.s.conversations, id, d),
    countStartedIn: async (r: DateRange) => [...this.s.conversations.values()].filter((c) => inRange(c.startedAt, r)).length,
    countStartedByAdIn: async (r: DateRange) => {
      const m = new Map<string, number>();
      for (const c of this.s.conversations.values()) {
        if (c.openedByAdMetaId && inRange(c.startedAt, r)) m.set(c.openedByAdMetaId, (m.get(c.openedByAdMetaId) ?? 0) + 1);
      }
      return m;
    },
  };

  messages = {
    findByWaMessageId: async (w: string) => clone([...this.s.messages.values()].find((m) => m.waMessageId === w) ?? null),
    create: async (d: Omit<Message, 'id'>) => {
      if ([...this.s.messages.values()].some((m) => m.waMessageId === d.waMessageId)) {
        throw new Error('unique constraint: waMessageId');
      }
      return insert(this.s.messages, d, 'msg_');
    },
    update: async (id: string, d: Partial<Message>) => patch(this.s.messages, id, d),
    listByContact: async (contactId: string, limit = 200) =>
      clone(
        [...this.s.messages.values()]
          .filter((m) => m.contactId === contactId)
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
          .slice(-limit),
      ),
    countIn: async (r: DateRange) => {
      let inbound = 0;
      let outbound = 0;
      for (const m of this.s.messages.values()) {
        if (m.source === 'HISTORY' || !inRange(m.occurredAt, r)) continue;
        if (m.direction === 'INBOUND') inbound++;
        else outbound++;
      }
      return { inbound, outbound };
    },
    firstOutboundAfter: async (contactId: string, after: Date) =>
      clone(
        [...this.s.messages.values()]
          .filter((m) => m.contactId === contactId && m.direction === 'OUTBOUND' && m.occurredAt >= after)
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0] ?? null,
      ),
  };

  private filterLeads(f: LeadFilter): Lead[] {
    let rows = [...this.s.leads.values()];
    if (f.stage) rows = rows.filter((l) => l.stage === f.stage);
    if (f.open !== undefined) rows = rows.filter((l) => OPEN_STAGES.includes(l.stage) === f.open);
    if (f.adMetaId) rows = rows.filter((l) => l.adMetaId === f.adMetaId);
    if (f.campaignMetaId) rows = rows.filter((l) => l.campaignMetaId === f.campaignMetaId);
    if (f.confidence) rows = rows.filter((l) => l.attributionConfidence === f.confidence);
    if (f.openedIn) rows = rows.filter((l) => inRange(l.openedAt, f.openedIn!));
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter((l) => {
        const c = this.s.contacts.get(l.contactId);
        return [c?.name, c?.profileName, c?.waId].some((v) => v?.toLowerCase().includes(q));
      });
    }
    return rows.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }

  leads = {
    findById: async (id: string) => clone(this.s.leads.get(id) ?? null),
    findOpenByContact: async (contactId: string) =>
      clone(
        [...this.s.leads.values()]
          .filter((l) => l.contactId === contactId && OPEN_STAGES.includes(l.stage))
          .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())[0] ?? null,
      ),
    findLatestByContact: async (contactId: string) =>
      clone(
        [...this.s.leads.values()]
          .filter((l) => l.contactId === contactId)
          .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())[0] ?? null,
      ),
    create: async (d: Omit<Lead, 'id'>) => insert(this.s.leads, d, 'led_'),
    update: async (id: string, d: Partial<Lead>) => patch(this.s.leads, id, d),
    list: async (f: LeadFilter) => clone(this.filterLeads(f).slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 50))),
    count: async (f: LeadFilter) => this.filterLeads(f).length,
    listMissingHierarchy: async () =>
      clone([...this.s.leads.values()].filter((l) => l.adMetaId && (!l.campaignMetaId || !l.adSetMetaId))),
  };

  evidence = {
    create: async (d: Omit<AttributionEvidence, 'id'>) => insert(this.s.evidence, d, 'evd_'),
    findById: async (id: string) => clone(this.s.evidence.get(id) ?? null),
    listByLead: async (leadId: string) =>
      clone(
        [...this.s.evidence.values()]
          .filter((e) => e.leadId === leadId)
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
      ),
  };

  stageHistory = {
    create: async (d: Omit<LeadStageHistory, 'id'>) => insert(this.s.stageHistory, d, 'stg_'),
    listByLead: async (leadId: string) => clone([...this.s.stageHistory.values()].filter((h) => h.leadId === leadId)),
  };

  ads = {
    findAd: async (metaId: string) => clone(this.s.ads.get(metaId) ?? null),
    findAdByCode: async (code: string) => clone([...this.s.ads.values()].find((a) => a.code === code) ?? null),
    setAdCode: async (metaId: string, code: string | null) => {
      const ad = this.s.ads.get(metaId);
      if (!ad) throw new NotFoundError('Anúncio', metaId);
      if (code && [...this.s.ads.values()].some((a) => a.code === code && a.metaId !== metaId)) {
        throw new DomainError('AD_CODE_TAKEN', `O código ${code} já está em uso por outro anúncio`, 409);
      }
      this.s.ads.set(metaId, { ...ad, code });
      return clone({ ...ad, code });
    },
    upsertAdAccounts: async (rows: AdAccountInfo[]) => rows.forEach((a) => this.s.adAccounts.set(a.id, clone(a))),
    listAdAccounts: async () => clone([...this.s.adAccounts.values()]),
    patchCampaign: async (metaId: string, d: Partial<Campaign>) => void this.s.campaigns.set(metaId, { ...this.s.campaigns.get(metaId)!, ...d }),
    patchAdSet: async (metaId: string, d: Partial<AdSet>) => void this.s.adSets.set(metaId, { ...this.s.adSets.get(metaId)!, ...d }),
    patchAd: async (metaId: string, d: Partial<Ad>) => void this.s.ads.set(metaId, { ...this.s.ads.get(metaId)!, ...d }),
    setAdProcedure: async (metaId: string, procedureId: string | null) => {
      const ad = this.s.ads.get(metaId);
      if (!ad) throw new NotFoundError('Anúncio', metaId);
      this.s.ads.set(metaId, { ...ad, procedureId });
      return clone({ ...ad, procedureId });
    },
    upsertCampaign: async (c: Campaign) => void this.s.campaigns.set(c.metaId, clone(c)),
    upsertAdSet: async (a: AdSet) => void this.s.adSets.set(a.metaId, clone(a)),
    upsertAd: async (a: Ad) => void this.s.ads.set(a.metaId, clone({ ...a, code: a.code ?? this.s.ads.get(a.metaId)?.code ?? null, procedureId: a.procedureId ?? this.s.ads.get(a.metaId)?.procedureId ?? null })),
    upsertInsight: async (i: AdInsightDaily) => void this.s.insights.set(`${i.adMetaId}|${i.date}`, clone(i)),
    upsertCampaigns: async (rows: Campaign[]) => rows.forEach((c) => this.s.campaigns.set(c.metaId, clone(c))),
    upsertAdSets: async (rows: AdSet[]) => rows.forEach((a) => this.s.adSets.set(a.metaId, clone(a))),
    upsertAds: async (rows: Ad[]) =>
      rows.forEach((a) => this.s.ads.set(a.metaId, clone({ ...a, code: a.code ?? this.s.ads.get(a.metaId)?.code ?? null, procedureId: a.procedureId ?? this.s.ads.get(a.metaId)?.procedureId ?? null }))),
    upsertInsights: async (rows: AdInsightDaily[]) => rows.forEach((i) => this.s.insights.set(`${i.adMetaId}|${i.date}`, clone(i))),
    listAds: async () => clone([...this.s.ads.values()]),
    listCampaigns: async () => clone([...this.s.campaigns.values()]),
    listAdSets: async () => clone([...this.s.adSets.values()]),
    listInsights: async (r: DateRange) =>
      clone(
        [...this.s.insights.values()].filter((i) => {
          const d = new Date(`${i.date}T00:00:00.000Z`);
          return inRange(d, r);
        }),
      ),
  };

  procedures = {
    findById: async (id: string) => clone(this.s.procedures.get(id) ?? null),
    list: async () => clone([...this.s.procedures.values()]),
    create: async (d: Omit<Procedure, 'id'>) => insert(this.s.procedures, d, 'prc_'),
    update: async (id: string, d: Partial<Procedure>) => {
      if (!this.s.procedures.has(id)) throw new NotFoundError('Procedimento', id);
      if (d.name && [...this.s.procedures.values()].some((p) => p.name === d.name && p.id !== id)) {
        throw new DomainError('PROCEDURE_NAME_TAKEN', 'Já existe um procedimento com esse nome', 409);
      }
      return patch(this.s.procedures, id, d);
    },
  };

  appointments = {
    findById: async (id: string) => clone(this.s.appointments.get(id) ?? null),
    create: async (d: Omit<Appointment, 'id'>) => insert(this.s.appointments, d, 'apt_'),
    update: async (id: string, d: Partial<Appointment>) => patch(this.s.appointments, id, d),
    listByLead: async (leadId: string) => clone([...this.s.appointments.values()].filter((a) => a.leadId === leadId)),
    listCreatedIn: async (r: DateRange) => clone([...this.s.appointments.values()].filter((a) => inRange(a.createdAt, r))),
    listScheduledBetween: async (r: DateRange) =>
      clone([...this.s.appointments.values()].filter((a) => inRange(a.scheduledFor, r))),
  };

  sales = {
    findById: async (id: string) => clone(this.s.sales.get(id) ?? null),
    create: async (d: Omit<Sale, 'id'>) => insert(this.s.sales, d, 'sal_'),
    update: async (id: string, d: Partial<Sale>) => patch(this.s.sales, id, d),
    listByLead: async (leadId: string) => clone([...this.s.sales.values()].filter((s) => s.leadId === leadId)),
    listSoldIn: async (r: DateRange) => clone([...this.s.sales.values()].filter((s) => inRange(s.soldAt, r))),
  };

  payments = {
    create: async (d: Omit<Payment, 'id'>) => insert(this.s.payments, d, 'pay_'),
    listBySale: async (saleId: string) => clone([...this.s.payments.values()].filter((p) => p.saleId === saleId)),
    listPaidIn: async (r: DateRange) => clone([...this.s.payments.values()].filter((p) => inRange(p.paidAt, r))),
    findById: async (id: string) => clone(this.s.payments.get(id) ?? null),
    delete: async (id: string) => {
      if (!this.s.payments.delete(id)) throw new NotFoundError('Pagamento', id);
    },
  };

  purchases = {
    create: async (d: Omit<SupplyPurchase, 'id' | 'createdAt' | 'updatedAt' | 'kind'> & { kind?: SupplyPurchase['kind'] }) => {
      const now = new Date();
      return insert(
        this.s.purchases,
        { firstDueAt: null, paidInstallments: 0, ...d, kind: d.kind ?? 'SUPPLY', createdAt: now, updatedAt: now } as SupplyPurchase,
        'sup_',
      );
    },
    update: async (id: string, d: Partial<SupplyPurchase>) => {
      if (!this.s.purchases.has(id)) throw new NotFoundError('Registro de compra', id);
      return patch(this.s.purchases, id, { ...d, updatedAt: new Date() });
    },
    delete: async (id: string) => {
      if (!this.s.purchases.delete(id)) throw new NotFoundError('Registro de compra', id);
    },
    findById: async (id: string) => clone(this.s.purchases.get(id) ?? null),
    list: async (r?: DateRange) =>
      clone(
        [...this.s.purchases.values()]
          .filter((p) => !r || inRange(p.purchasedAt, r))
          .sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime()),
      ),
  };

  expenses = {
    create: async (d: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date();
      return insert(this.s.expenses, { ...d, createdAt: now, updatedAt: now }, 'exp_');
    },
    update: async (id: string, d: Partial<Expense>) => {
      if (!this.s.expenses.has(id)) throw new NotFoundError('Despesa', id);
      return patch(this.s.expenses, id, { ...d, updatedAt: new Date() });
    },
    delete: async (id: string) => {
      if (!this.s.expenses.delete(id)) throw new NotFoundError('Despesa', id);
    },
    findById: async (id: string) => clone(this.s.expenses.get(id) ?? null),
    list: async (r?: DateRange) =>
      clone(
        [...this.s.expenses.values()]
          .filter((e) => !r || inRange(e.date, r))
          .sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime()),
      ),
  };

  recalls = {
    create: async (d: Omit<RecallAction, 'id' | 'createdAt'>) => insert(this.s.recalls, { ...d, createdAt: new Date() }, 'rca_'),
    list: async () => clone([...this.s.recalls.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
  };

  agendaBlocks = {
    create: async (d: Omit<AgendaBlock, 'id' | 'createdAt'>) => insert(this.s.agendaBlocks, { ...d, createdAt: new Date() }, 'blk_'),
    listBetween: async (from: Date, to: Date) =>
      clone(
        [...this.s.agendaBlocks.values()]
          .filter((b) => b.startAt < to && b.endAt > from)
          .sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
      ),
    findById: async (id: string) => clone(this.s.agendaBlocks.get(id) ?? null),
    delete: async (id: string) => {
      if (!this.s.agendaBlocks.delete(id)) throw new NotFoundError('Bloqueio da agenda', id);
    },
  };

  settings = {
    get: async <T>(key: string) => clone((this.s.settings.get(key) as T | undefined) ?? null),
    set: async <T>(key: string, value: T) => void this.s.settings.set(key, clone(value)),
  };

  performed = {
    create: async (d: Omit<ProcedurePerformed, 'id'>) => insert(this.s.performed, d, 'prf_'),
    listByLead: async (leadId: string) => clone([...this.s.performed.values()].filter((p) => p.leadId === leadId)),
    listPerformedIn: async (r: DateRange) => clone([...this.s.performed.values()].filter((p) => inRange(p.performedAt, r))),
    findById: async (id: string) => clone(this.s.performed.get(id) ?? null),
    delete: async (id: string) => {
      if (!this.s.performed.delete(id)) throw new NotFoundError('Procedimento realizado', id);
    },
  };

  reminders = {
    create: async (d: Omit<Reminder, 'id'>) => insert(this.s.reminders, d, 'rem_'),
    update: async (id: string, d: Partial<Reminder>) => patch(this.s.reminders, id, d),
    findById: async (id: string) => clone(this.s.reminders.get(id) ?? null),
    listPending: async (until: Date, assignedToId?: string) =>
      clone(
        [...this.s.reminders.values()]
          .filter((r) => !r.doneAt && r.dueAt <= until && (!assignedToId || r.assignedToId === assignedToId))
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()),
      ),
    listByLead: async (leadId: string) => clone([...this.s.reminders.values()].filter((r) => r.leadId === leadId)),
  };

  connections = {
    find: async (p: IntegrationConnection['provider'], e: IntegrationConnection['environment']) =>
      clone([...this.s.connections.values()].find((c) => c.provider === p && c.environment === e) ?? null),
    findByPhoneNumberId: async (id: string) =>
      clone([...this.s.connections.values()].find((c) => c.phoneNumberId === id) ?? null),
    upsert: async (
      provider: IntegrationConnection['provider'],
      environment: IntegrationConnection['environment'],
      data: Partial<IntegrationConnection>,
    ) => {
      const cur = [...this.s.connections.values()].find((c) => c.provider === provider && c.environment === environment);
      const base: IntegrationConnection = cur ?? {
        id: newId('con_'),
        provider,
        environment,
        status: 'PENDING',
        label: null,
        wabaId: null,
        phoneNumberId: null,
        displayPhoneNumber: null,
        adAccountId: null,
        coexistence: false,
        encryptedCredentials: null,
        partnerConfig: null,
        webhookStatus: null,
        lastWebhookAt: null,
        lastSyncAt: null,
        permissionsDiagnostic: null,
        updatedAt: new Date(),
      };
      const next = { ...base, ...data, id: base.id, provider, environment, updatedAt: new Date() };
      this.s.connections.set(next.id, next);
      return clone(next);
    },
    list: async () => clone([...this.s.connections.values()]),
    addError: async (e: Omit<IntegrationError, 'id' | 'createdAt'>) => {
      this.s.integrationErrors.push({ ...e, id: newId('ier_'), createdAt: new Date() });
    },
    recentErrors: async (provider: IntegrationConnection['provider'], limit: number) =>
      clone(this.s.integrationErrors.filter((e) => e.provider === provider).slice(-limit).reverse()),
  };

  events = {
    insertIfNew: async (
      e: Omit<InboundEvent, 'id' | 'receivedAt' | 'status' | 'attempts' | 'lastError' | 'processedAt'>,
    ) => {
      if ([...this.s.events.values()].some((x) => x.dedupKey === e.dedupKey)) return null;
      return insert(
        this.s.events,
        { ...e, receivedAt: new Date(), status: 'RECEIVED', attempts: 0, lastError: null, processedAt: null },
        'evt_',
      );
    },
    findById: async (id: string) => clone(this.s.events.get(id) ?? null),
    update: async (id: string, d: Partial<InboundEvent>) => patch(this.s.events, id, d),
    list: async (f: { status?: InboundEvent['status']; limit?: number }) =>
      clone([...this.s.events.values()].filter((e) => !f.status || e.status === f.status).slice(0, f.limit ?? 100)),
    countByStatus: async () => {
      const out: Record<string, number> = {};
      for (const e of this.s.events.values()) out[e.status] = (out[e.status] ?? 0) + 1;
      return out;
    },
  };

  audit = {
    log: async (entry: AuditEntry) => {
      this.s.audit.push({ ...clone(entry), id: newId('aud_'), createdAt: new Date() });
    },
    list: async (f: { entityType?: string; entityId?: string; limit?: number }) =>
      clone(
        this.s.audit
          .filter((a) => (!f.entityType || a.entityType === f.entityType) && (!f.entityId || a.entityId === f.entityId))
          .slice(-(f.limit ?? 100))
          .reverse(),
      ),
  };
}
