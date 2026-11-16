// Implementação das portas de persistência com Prisma/PostgreSQL.
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { DomainError, NotFoundError } from '../../domain/errors.js';
import type {
  Ad,
  AdAccountInfo,
  AdInsightDaily,
  AdSet,
  Campaign,
  AuditEntry,
  InboundEvent,
  IntegrationConnection,
  IntegrationEnvironment,
  IntegrationError,
  IntegrationProvider,
} from '../../domain/types.js';
import { OPEN_STAGES } from '../../domain/types.js';
import { newId } from '../../shared/ids.js';
import type { DateRange, LeadFilter, Repos } from '../../ports/repositories.js';

type Db = PrismaClient | Prisma.TransactionClient;
// Os tipos de domínio espelham o schema; a conversão é estrutural.
const as = <T>(v: unknown) => v as T;
const json = (v: unknown) => (v === undefined ? undefined : v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));
const inRange = (r: DateRange) => ({ gte: r.from, lt: r.to });
const BULK = 500;
const chunks = <T>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
/** Mantém a última ocorrência de cada chave (um INSERT ... ON CONFLICT não aceita a mesma chave duas vezes). */
const dedupeBy = <T>(arr: T[], key: (t: T) => string): T[] => [...new Map(arr.map((x) => [key(x), x])).values()];

export class PrismaRepos implements Repos {
  constructor(
    private readonly db: Db,
    private readonly root: PrismaClient | null = null,
  ) {}

  static create(prisma: PrismaClient): PrismaRepos {
    return new PrismaRepos(prisma, prisma);
  }

  async tx<T>(fn: (r: Repos) => Promise<T>): Promise<T> {
    if (!this.root) return fn(this); // já dentro de transação
    return this.root.$transaction((tx) => fn(new PrismaRepos(tx, null)), { timeout: 15_000 });
  }

  users = {
    findById: async (id: string) => as<any>(await this.db.user.findUnique({ where: { id } })),
    findByEmail: async (email: string) => as<any>(await this.db.user.findUnique({ where: { email } })),
    create: async (d: any) => as<any>(await this.db.user.create({ data: { ...d, screens: json(d.screens) } })),
    list: async () => as<any>(await this.db.user.findMany({ orderBy: { name: 'asc' } })),
    update: async (id: string, d: any) =>
      as<any>(await this.db.user.update({ where: { id }, data: 'screens' in d ? { ...d, screens: json(d.screens) } : d })),
  };

  contacts = {
    findById: async (id: string) => as<any>(await this.db.contact.findUnique({ where: { id } })),
    findByWaId: async (waId: string) => as<any>(await this.db.contact.findUnique({ where: { waId } })),
    findByBsuid: async (bsuid: string) => as<any>(await this.db.contact.findUnique({ where: { bsuid } })),
    list: async () => as<any>(await this.db.contact.findMany({ orderBy: { firstSeenAt: 'asc' } })),
    create: async (d: any) => as<any>(await this.db.contact.create({ data: d })),
    update: async (id: string, d: any) => as<any>(await this.db.contact.update({ where: { id }, data: d })),
  };

  conversations = {
    findCovering: async (contactId: string, at: Date, gapMs: number) =>
      as<any>(
        await this.db.conversation.findFirst({
          where: {
            contactId,
            startedAt: { lte: new Date(at.getTime() + gapMs) },
            lastMessageAt: { gte: new Date(at.getTime() - gapMs) },
          },
          orderBy: { lastMessageAt: 'desc' },
        }),
      ),
    create: async (d: any) => as<any>(await this.db.conversation.create({ data: d })),
    update: async (id: string, d: any) => as<any>(await this.db.conversation.update({ where: { id }, data: d })),
    countStartedIn: (r: DateRange) => this.db.conversation.count({ where: { startedAt: inRange(r) } }),
    countStartedByAdIn: async (r: DateRange) => {
      const rows = await this.db.conversation.groupBy({
        by: ['openedByAdMetaId'],
        where: { startedAt: inRange(r), openedByAdMetaId: { not: null } },
        _count: { _all: true },
      });
      return new Map(rows.map((x) => [x.openedByAdMetaId!, x._count._all]));
    },
  };

  messages = {
    findByWaMessageId: async (waMessageId: string) => as<any>(await this.db.message.findUnique({ where: { waMessageId } })),
    create: async (d: any) => as<any>(await this.db.message.create({ data: d })),
    update: async (id: string, d: any) => as<any>(await this.db.message.update({ where: { id }, data: d })),
    listByContact: async (contactId: string, limit = 200) =>
      as<any>((await this.db.message.findMany({ where: { contactId }, orderBy: { occurredAt: 'desc' }, take: limit })).reverse()),
    countIn: async (r: DateRange) => {
      const rows = await this.db.message.groupBy({
        by: ['direction'],
        where: { occurredAt: inRange(r), source: { not: 'HISTORY' } },
        _count: { _all: true },
      });
      const get = (d: string) => rows.find((x) => x.direction === d)?._count._all ?? 0;
      return { inbound: get('INBOUND'), outbound: get('OUTBOUND') };
    },
    firstOutboundAfter: async (contactId: string, after: Date) =>
      as<any>(
        await this.db.message.findFirst({
          where: { contactId, direction: 'OUTBOUND', occurredAt: { gte: after } },
          orderBy: { occurredAt: 'asc' },
        }),
      ),
  };

  private async leadWhere(f: LeadFilter): Promise<Prisma.LeadWhereInput> {
    const where: Prisma.LeadWhereInput = {};
    if (f.stage) where.stage = f.stage;
    if (f.open !== undefined) where.stage = f.open ? { in: [...OPEN_STAGES] } : { notIn: [...OPEN_STAGES] };
    if (f.adMetaId) where.adMetaId = f.adMetaId;
    if (f.campaignMetaId) where.campaignMetaId = f.campaignMetaId;
    if (f.confidence) where.attributionConfidence = f.confidence;
    if (f.openedIn) where.openedAt = inRange(f.openedIn);
    if (f.search) {
      const q = f.search.trim();
      const contacts = await this.db.contact.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { profileName: { contains: q, mode: 'insensitive' } },
            { waId: { contains: q.replace(/\D/g, '') || q } },
          ],
        },
        select: { id: true },
        take: 500,
      });
      where.contactId = { in: contacts.map((c) => c.id) };
    }
    return where;
  }

  leads = {
    findById: async (id: string) => as<any>(await this.db.lead.findUnique({ where: { id } })),
    findOpenByContact: async (contactId: string) =>
      as<any>(
        await this.db.lead.findFirst({
          where: { contactId, stage: { in: [...OPEN_STAGES] } },
          orderBy: { openedAt: 'desc' },
        }),
      ),
    findLatestByContact: async (contactId: string) =>
      as<any>(await this.db.lead.findFirst({ where: { contactId }, orderBy: { openedAt: 'desc' } })),
    create: async (d: any) => as<any>(await this.db.lead.create({ data: d })),
    update: async (id: string, d: any) => as<any>(await this.db.lead.update({ where: { id }, data: d })),
    list: async (f: LeadFilter) =>
      as<any>(
        await this.db.lead.findMany({
          where: await this.leadWhere(f),
          orderBy: { lastActivityAt: 'desc' },
          skip: f.offset ?? 0,
          take: f.limit ?? 50,
        }),
      ),
    count: async (f: LeadFilter) => this.db.lead.count({ where: await this.leadWhere(f) }),
    listMissingHierarchy: async () =>
      as<any>(
        await this.db.lead.findMany({
          where: { adMetaId: { not: null }, OR: [{ campaignMetaId: null }, { adSetMetaId: null }] },
          take: 1000,
        }),
      ),
  };

  evidence = {
    create: async (d: any) => as<any>(await this.db.attributionEvidence.create({ data: { ...d, raw: json(d.raw) } })),
    findById: async (id: string) => as<any>(await this.db.attributionEvidence.findUnique({ where: { id } })),
    listByLead: async (leadId: string) =>
      as<any>(await this.db.attributionEvidence.findMany({ where: { leadId }, orderBy: { occurredAt: 'asc' } })),
  };

  stageHistory = {
    create: async (d: any) => as<any>(await this.db.leadStageHistory.create({ data: d })),
    listByLead: async (leadId: string) => as<any>(await this.db.leadStageHistory.findMany({ where: { leadId }, orderBy: { at: 'asc' } })),
  };

  ads = {
    findAd: async (metaId: string) => as<any>(await this.db.ad.findUnique({ where: { metaId } })),
    findAdByCode: async (code: string) => as<any>(await this.db.ad.findUnique({ where: { code } })),
    setAdCode: async (metaId: string, code: string | null) => {
      try {
        return as<any>(await this.db.ad.update({ where: { metaId }, data: { code } }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new DomainError('AD_CODE_TAKEN', `O código ${code} já está em uso por outro anúncio`, 409);
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundError('Anúncio', metaId);
        throw err;
      }
    },
    upsertAdAccounts: async (rows: AdAccountInfo[]) => {
      for (const a of rows) {
        await this.db.adAccount.upsert({ where: { id: a.id }, create: a, update: a });
      }
    },
    listAdAccounts: async () => as<any>(await this.db.adAccount.findMany({ orderBy: { name: 'asc' } })),
    patchCampaign: async (metaId: string, d: Partial<Campaign>) => void (await this.db.campaign.update({ where: { metaId }, data: d as any })),
    patchAdSet: async (metaId: string, d: Partial<AdSet>) => void (await this.db.adSet.update({ where: { metaId }, data: d as any })),
    patchAd: async (metaId: string, d: Partial<Ad>) => void (await this.db.ad.update({ where: { metaId }, data: d as any })),
    setAdProcedure: async (metaId: string, procedureId: string | null) => {
      try {
        return as<any>(await this.db.ad.update({ where: { metaId }, data: { procedureId } }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundError('Anúncio', metaId);
        throw err;
      }
    },
    upsertCampaign: async (c: any) => void (await this.db.campaign.upsert({ where: { metaId: c.metaId }, create: c, update: c })),
    upsertAdSet: async (a: any) => void (await this.db.adSet.upsert({ where: { metaId: a.metaId }, create: a, update: a })),
    upsertAd: async (a: any) => void (await this.db.ad.upsert({ where: { metaId: a.metaId }, create: a, update: a })),
    upsertInsight: async (i: AdInsightDaily) => {
      const data = { ...i, date: new Date(`${i.date}T00:00:00.000Z`), syncedAt: new Date() };
      await this.db.adInsightDaily.upsert({
        where: { adMetaId_date: { adMetaId: i.adMetaId, date: data.date } },
        create: data,
        update: data,
      });
    },
    // Lotes: um INSERT ... ON CONFLICT por bloco de até 500 linhas (poucas idas ao banco,
    // sem transação longa, o que importa em serverless com o banco em outra região).
    upsertCampaigns: async (rows: Campaign[]) => {
      for (const chunk of chunks(dedupeBy(rows, (r) => r.metaId), BULK)) {
        await this.db.$executeRaw(Prisma.sql`
          INSERT INTO campaigns ("metaId", name, status, objective, "accountId", "effectiveStatus", "dailyBudgetCents", "lifetimeBudgetCents", "stopTime", "updatedAt")
          VALUES ${Prisma.join(
            chunk.map(
              (c) => Prisma.sql`(${c.metaId}, ${c.name}, ${c.status}, ${c.objective}, ${c.accountId ?? null}, ${c.effectiveStatus ?? null},
                ${c.dailyBudgetCents ?? null}::int, ${c.lifetimeBudgetCents ?? null}::int, ${c.stopTime ?? null}::timestamp, now())`,
            ),
          )}
          ON CONFLICT ("metaId") DO UPDATE SET
            name = EXCLUDED.name, status = EXCLUDED.status, objective = EXCLUDED.objective,
            "accountId" = COALESCE(EXCLUDED."accountId", campaigns."accountId"), "effectiveStatus" = EXCLUDED."effectiveStatus",
            "dailyBudgetCents" = EXCLUDED."dailyBudgetCents", "lifetimeBudgetCents" = EXCLUDED."lifetimeBudgetCents",
            "stopTime" = EXCLUDED."stopTime", "updatedAt" = now()`);
      }
    },
    upsertAdSets: async (rows: AdSet[]) => {
      for (const chunk of chunks(dedupeBy(rows, (r) => r.metaId), BULK)) {
        await this.db.$executeRaw(Prisma.sql`
          INSERT INTO ad_sets ("metaId", "campaignMetaId", name, status, "effectiveStatus", "dailyBudgetCents", "lifetimeBudgetCents", "updatedAt")
          VALUES ${Prisma.join(
            chunk.map(
              (a) => Prisma.sql`(${a.metaId}, ${a.campaignMetaId}, ${a.name}, ${a.status}, ${a.effectiveStatus ?? null},
                ${a.dailyBudgetCents ?? null}::int, ${a.lifetimeBudgetCents ?? null}::int, now())`,
            ),
          )}
          ON CONFLICT ("metaId") DO UPDATE SET
            "campaignMetaId" = EXCLUDED."campaignMetaId", name = EXCLUDED.name, status = EXCLUDED.status,
            "effectiveStatus" = EXCLUDED."effectiveStatus", "dailyBudgetCents" = EXCLUDED."dailyBudgetCents",
            "lifetimeBudgetCents" = EXCLUDED."lifetimeBudgetCents", "updatedAt" = now()`);
      }
    },
    upsertAds: async (rows: Ad[]) => {
      for (const chunk of chunks(dedupeBy(rows, (r) => r.metaId), BULK)) {
        await this.db.$executeRaw(Prisma.sql`
          INSERT INTO ads ("metaId", "adSetMetaId", "campaignMetaId", name, status, "effectiveStatus", "updatedAt")
          VALUES ${Prisma.join(
            chunk.map((a) => Prisma.sql`(${a.metaId}, ${a.adSetMetaId}, ${a.campaignMetaId}, ${a.name}, ${a.status}, ${a.effectiveStatus ?? null}, now())`),
          )}
          ON CONFLICT ("metaId") DO UPDATE SET
            "adSetMetaId" = EXCLUDED."adSetMetaId", "campaignMetaId" = EXCLUDED."campaignMetaId",
            name = EXCLUDED.name, status = EXCLUDED.status, "effectiveStatus" = EXCLUDED."effectiveStatus", "updatedAt" = now()`);
      }
    },
    upsertInsights: async (rows: AdInsightDaily[]) => {
      for (const chunk of chunks(dedupeBy(rows, (r) => `${r.adMetaId}|${r.date}`), BULK)) {
        await this.db.$executeRaw(Prisma.sql`
          INSERT INTO ad_insights_daily
            (id, "adMetaId", date, "spendCents", impressions, clicks, "metaMessagingConversationsStarted", currency, "syncedAt")
          VALUES ${Prisma.join(
            chunk.map(
              (i) => Prisma.sql`(${newId('ins_')}, ${i.adMetaId}, ${i.date}::date, ${i.spendCents}, ${i.impressions}, ${i.clicks},
                ${i.metaMessagingConversationsStarted}, ${i.currency}, now())`,
            ),
          )}
          ON CONFLICT ("adMetaId", date) DO UPDATE SET
            "spendCents" = EXCLUDED."spendCents", impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
            "metaMessagingConversationsStarted" = EXCLUDED."metaMessagingConversationsStarted",
            currency = EXCLUDED.currency, "syncedAt" = now()`);
      }
    },
    listAds: async () => as<any>(await this.db.ad.findMany()),
    listCampaigns: async () => as<any>(await this.db.campaign.findMany()),
    listAdSets: async () => as<any>(await this.db.adSet.findMany()),
    listInsights: async (r: DateRange) =>
      (await this.db.adInsightDaily.findMany({ where: { date: inRange(r) } })).map((x) => ({
        adMetaId: x.adMetaId,
        date: x.date.toISOString().slice(0, 10),
        spendCents: x.spendCents,
        impressions: x.impressions,
        clicks: x.clicks,
        metaMessagingConversationsStarted: x.metaMessagingConversationsStarted,
        currency: x.currency,
      })),
  };

  procedures = {
    findById: async (id: string) => as<any>(await this.db.procedure.findUnique({ where: { id } })),
    list: async () => as<any>(await this.db.procedure.findMany({ orderBy: { name: 'asc' } })),
    create: async (d: any) => {
      try {
        return as<any>(await this.db.procedure.create({ data: d }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new DomainError('PROCEDURE_NAME_TAKEN', 'Já existe um procedimento com esse nome', 409);
        }
        throw err;
      }
    },
    update: async (id: string, d: any) => {
      try {
        return as<any>(await this.db.procedure.update({ where: { id }, data: d }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundError('Procedimento', id);
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new DomainError('PROCEDURE_NAME_TAKEN', 'Já existe um procedimento com esse nome', 409);
        }
        throw err;
      }
    },
  };

  appointments = {
    findById: async (id: string) => as<any>(await this.db.appointment.findUnique({ where: { id } })),
    create: async (d: any) => as<any>(await this.db.appointment.create({ data: d })),
    update: async (id: string, d: any) => as<any>(await this.db.appointment.update({ where: { id }, data: d })),
    listByLead: async (leadId: string) => as<any>(await this.db.appointment.findMany({ where: { leadId }, orderBy: { scheduledFor: 'asc' } })),
    listCreatedIn: async (r: DateRange) => as<any>(await this.db.appointment.findMany({ where: { createdAt: inRange(r) } })),
    listScheduledBetween: async (r: DateRange) =>
      as<any>(await this.db.appointment.findMany({ where: { scheduledFor: inRange(r) }, orderBy: { scheduledFor: 'asc' } })),
  };

  sales = {
    findById: async (id: string) => as<any>(await this.db.sale.findUnique({ where: { id } })),
    create: async (d: any) => as<any>(await this.db.sale.create({ data: d })),
    update: async (id: string, d: any) => as<any>(await this.db.sale.update({ where: { id }, data: d })),
    listByLead: async (leadId: string) => as<any>(await this.db.sale.findMany({ where: { leadId }, orderBy: { soldAt: 'asc' } })),
    listSoldIn: async (r: DateRange) => as<any>(await this.db.sale.findMany({ where: { soldAt: inRange(r) } })),
  };

  payments = {
    create: async (d: any) => as<any>(await this.db.payment.create({ data: d })),
    listBySale: async (saleId: string) => as<any>(await this.db.payment.findMany({ where: { saleId }, orderBy: { paidAt: 'asc' } })),
    listPaidIn: async (r: DateRange) => as<any>(await this.db.payment.findMany({ where: { paidAt: inRange(r) } })),
  };

  purchases = {
    create: async (d: any) => as<any>(await this.db.supplyPurchase.create({ data: d })),
    update: async (id: string, d: any) => {
      try {
        return as<any>(await this.db.supplyPurchase.update({ where: { id }, data: d }));
      } catch (e: any) {
        if (e?.code === 'P2025') throw new NotFoundError('Registro de compra', id);
        throw e;
      }
    },
    delete: async (id: string) => {
      try {
        await this.db.supplyPurchase.delete({ where: { id } });
      } catch (e: any) {
        if (e?.code === 'P2025') throw new NotFoundError('Registro de compra', id);
        throw e;
      }
    },
    findById: async (id: string) => as<any>(await this.db.supplyPurchase.findUnique({ where: { id } })),
    list: async (r?: DateRange) =>
      as<any>(
        await this.db.supplyPurchase.findMany({
          where: r ? { purchasedAt: inRange(r) } : undefined,
          orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
        }),
      ),
  };

  expenses = {
    create: async (d: any) => as<any>(await this.db.expense.create({ data: d })),
    update: async (id: string, d: any) => {
      try {
        return as<any>(await this.db.expense.update({ where: { id }, data: d }));
      } catch (e: any) {
        if (e?.code === 'P2025') throw new NotFoundError('Despesa', id);
        throw e;
      }
    },
    delete: async (id: string) => {
      try {
        await this.db.expense.delete({ where: { id } });
      } catch (e: any) {
        if (e?.code === 'P2025') throw new NotFoundError('Despesa', id);
        throw e;
      }
    },
    findById: async (id: string) => as<any>(await this.db.expense.findUnique({ where: { id } })),
    list: async (r?: DateRange) =>
      as<any>(
        await this.db.expense.findMany({
          where: r ? { date: inRange(r) } : undefined,
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
      ),
  };

  agendaBlocks = {
    create: async (d: any) => as<any>(await this.db.agendaBlock.create({ data: d })),
    listBetween: async (from: Date, to: Date) =>
      as<any>(await this.db.agendaBlock.findMany({ where: { startAt: { lt: to }, endAt: { gt: from } }, orderBy: { startAt: 'asc' } })),
    findById: async (id: string) => as<any>(await this.db.agendaBlock.findUnique({ where: { id } })),
    delete: async (id: string) => void (await this.db.agendaBlock.delete({ where: { id } })),
  };

  recalls = {
    create: async (d: any) => as<any>(await this.db.recallAction.create({ data: d })),
    list: async () => as<any>(await this.db.recallAction.findMany({ orderBy: { createdAt: 'asc' } })),
  };

  settings = {
    get: async <T>(key: string) => ((await this.db.setting.findUnique({ where: { key } }))?.value as T | undefined) ?? null,
    set: async <T>(key: string, value: T) =>
      void (await this.db.setting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } })),
  };

  performed = {
    create: async (d: any) => as<any>(await this.db.procedurePerformed.create({ data: d })),
    listByLead: async (leadId: string) => as<any>(await this.db.procedurePerformed.findMany({ where: { leadId } })),
    listPerformedIn: async (r: DateRange) => as<any>(await this.db.procedurePerformed.findMany({ where: { performedAt: inRange(r) } })),
  };

  reminders = {
    create: async (d: any) => as<any>(await this.db.reminder.create({ data: d })),
    update: async (id: string, d: any) => as<any>(await this.db.reminder.update({ where: { id }, data: d })),
    findById: async (id: string) => as<any>(await this.db.reminder.findUnique({ where: { id } })),
    listPending: async (until: Date, assignedToId?: string) =>
      as<any>(
        await this.db.reminder.findMany({
          where: { doneAt: null, dueAt: { lte: until }, ...(assignedToId ? { assignedToId } : {}) },
          orderBy: { dueAt: 'asc' },
        }),
      ),
    listByLead: async (leadId: string) => as<any>(await this.db.reminder.findMany({ where: { leadId }, orderBy: { dueAt: 'asc' } })),
  };

  connections = {
    find: async (provider: IntegrationProvider, environment: IntegrationEnvironment) =>
      as<IntegrationConnection | null>(
        await this.db.integrationConnection.findUnique({ where: { provider_environment: { provider, environment } } }),
      ),
    findByPhoneNumberId: async (phoneNumberId: string) =>
      as<IntegrationConnection | null>(await this.db.integrationConnection.findFirst({ where: { phoneNumberId } })),
    upsert: async (provider: IntegrationProvider, environment: IntegrationEnvironment, data: Partial<IntegrationConnection>) => {
      const { id: _id, provider: _p, environment: _e, updatedAt: _u, partnerConfig, permissionsDiagnostic, ...rest } = data;
      const clean = {
        ...rest,
        ...(partnerConfig !== undefined ? { partnerConfig: json(partnerConfig) } : {}),
        ...(permissionsDiagnostic !== undefined ? { permissionsDiagnostic: json(permissionsDiagnostic) } : {}),
      } as any;
      return as<IntegrationConnection>(
        await this.db.integrationConnection.upsert({
          where: { provider_environment: { provider, environment } },
          create: { provider, environment, ...clean },
          update: clean,
        }),
      );
    },
    list: async () => as<IntegrationConnection[]>(await this.db.integrationConnection.findMany()),
    addError: async (e: Omit<IntegrationError, 'id' | 'createdAt'>) => {
      await this.db.integrationError.create({ data: { ...e, context: json(e.context) } as any });
    },
    recentErrors: async (provider: IntegrationProvider, limit: number) =>
      as<IntegrationError[]>(await this.db.integrationError.findMany({ where: { provider }, orderBy: { createdAt: 'desc' }, take: limit })),
  };

  events = {
    insertIfNew: async (e: Omit<InboundEvent, 'id' | 'receivedAt' | 'status' | 'attempts' | 'lastError' | 'processedAt'>) => {
      try {
        return as<InboundEvent>(await this.db.inboundEvent.create({ data: { ...e, payload: json(e.payload) } as any }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null; // dedupKey repetida
        throw err;
      }
    },
    findById: async (id: string) => as<InboundEvent | null>(await this.db.inboundEvent.findUnique({ where: { id } })),
    update: async (id: string, d: Partial<InboundEvent>) => {
      const { payload, ...rest } = d;
      return as<InboundEvent>(
        await this.db.inboundEvent.update({ where: { id }, data: { ...rest, ...(payload !== undefined ? { payload: json(payload) } : {}) } as any }),
      );
    },
    list: async (f: { status?: InboundEvent['status']; limit?: number }) =>
      as<InboundEvent[]>(
        await this.db.inboundEvent.findMany({
          where: f.status ? { status: f.status } : undefined,
          orderBy: { receivedAt: 'desc' },
          take: f.limit ?? 100,
        }),
      ),
    countByStatus: async () => {
      const rows = await this.db.inboundEvent.groupBy({ by: ['status'], _count: { _all: true } });
      return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    },
  };

  audit = {
    log: async (entry: AuditEntry) => {
      await this.db.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: json(entry.before),
          after: json(entry.after),
          ip: entry.ip ?? null,
        },
      });
    },
    list: async (f: { entityType?: string; entityId?: string; limit?: number }) =>
      as<any>(
        await this.db.auditLog.findMany({
          where: { ...(f.entityType ? { entityType: f.entityType } : {}), ...(f.entityId ? { entityId: f.entityId } : {}) },
          orderBy: { createdAt: 'desc' },
          take: f.limit ?? 100,
        }),
      ),
  };
}
