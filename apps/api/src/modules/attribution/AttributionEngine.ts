import { CONFIDENCE_RANK, type AttributionConfidence, type Lead, type LeadStage } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import { DAY_MS, type Clock, maxDate, minDate } from '../../shared/ids.js';
import { recordMessage, resolveContact } from '../messaging/MessageLog.js';
import type { InboundMessageEvent } from '../whatsapp/events.js';

export interface AttributionTraceStep {
  step: number;
  label: string;
  detail: string;
}

export interface AttributionResult {
  duplicate: boolean;
  contactId: string;
  isNewContact: boolean;
  messageId: string | null;
  leadId: string | null;
  leadCreated: boolean;
  confidence: AttributionConfidence;
  adMetaId: string | null;
  adSetMetaId: string | null;
  campaignMetaId: string | null;
  adFoundLocally: boolean;
  evidenceId: string | null;
  trace: AttributionTraceStep[];
}

export interface AttributionEngineOptions {
  /** Contato antigo sem lead aberto gera novo lead após N dias do último fechamento. */
  reopenAfterDays: number;
}

/**
 * Motor de atribuição.
 *
 * Princípio: atribuição só existe com evidência. As únicas fontes aceitas são
 *   - OFFICIAL_REFERRAL: objeto `referral` com source_type = "ad" no webhook oficial;
 *   - MANUAL: informada por um usuário, com registro de autoria (FunnelService).
 * Nunca se presume atribuição pelo anúncio mais recente, por horário de clique
 * ou por semelhança de texto. Sem evidência, a origem fica UNKNOWN.
 *
 * Em caso de várias referências oficiais no mesmo lead, vale a de ocorrência
 * mais antiga (primeiro toque), independentemente da ordem de chegada.
 * Todas as evidências ficam registradas.
 */
export class AttributionEngine {
  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
    private readonly opts: AttributionEngineOptions = { reopenAfterDays: 30 },
  ) {}

  async processInboundMessage(evt: InboundMessageEvent): Promise<AttributionResult> {
    return this.repos.tx(async (r) => {
      const trace: AttributionTraceStep[] = [];
      const at = new Date(evt.occurredAt);
      const now = this.clock.now();

      // 1. Identificar o contato
      trace.push({ step: 1, label: 'Identificar contato', detail: `wa_id=${evt.fromWaId ?? '-'} bsuid=${evt.fromBsuid ?? '-'}` });

      // 2. Verificar se já existe cadastro
      const { contact, isNew } = await resolveContact(
        r,
        { waId: evt.fromWaId, bsuid: evt.fromBsuid, profileName: evt.profileName },
        at,
      );
      trace.push({ step: 2, label: 'Verificar cadastro', detail: isNew ? 'novo contato' : `contato existente ${contact.id}` });

      // 3. Identificar se existe referência a anúncio
      const ref = evt.referral;
      const isAdReferral = ref?.sourceType === 'ad' && !!ref.sourceId;
      trace.push({
        step: 3,
        label: 'Referência a anúncio',
        detail: ref ? `referral source_type=${ref.sourceType}` : 'sem referral',
      });

      // 4. Extrair identificador de origem
      const adMetaId = isAdReferral ? ref!.sourceId : null;
      trace.push({ step: 4, label: 'Identificador de origem', detail: adMetaId ?? 'indisponível' });

      // Mensagem (idempotente). Duplicado → nada mais a fazer.
      const rec = await recordMessage(r, {
        waMessageId: evt.waMessageId,
        contactId: contact.id,
        direction: 'INBOUND',
        source: 'CUSTOMER',
        type: evt.type,
        body: evt.text,
        occurredAt: at,
        receivedAt: now,
        adReferralMetaId: adMetaId,
        hasAdReferral: isAdReferral,
      });
      if (rec.duplicate) {
        return {
          duplicate: true,
          contactId: contact.id,
          isNewContact: false,
          messageId: rec.message.id,
          leadId: null,
          leadCreated: false,
          confidence: 'UNKNOWN',
          adMetaId: null,
          adSetMetaId: null,
          campaignMetaId: null,
          adFoundLocally: false,
          evidenceId: null,
          trace: [...trace, { step: 0, label: 'Duplicado', detail: `mensagem ${evt.waMessageId} já processada` }],
        };
      }

      // 5. Localizar o anúncio correspondente
      const ad = adMetaId ? await r.ads.findAd(adMetaId) : null;
      trace.push({
        step: 5,
        label: 'Localizar anúncio',
        detail: !adMetaId ? 'não aplicável' : ad ? `${ad.name}` : 'anúncio ainda não sincronizado da Meta (será resolvido na próxima sincronização)',
      });

      // 6. Associar campanha e conjunto
      const adSetMetaId = ad?.adSetMetaId ?? null;
      const campaignMetaId = ad?.campaignMetaId ?? null;
      trace.push({
        step: 6,
        label: 'Campanha e conjunto',
        detail: ad ? `campanha=${campaignMetaId} conjunto=${adSetMetaId}` : 'pendente',
      });

      // 8 (decisão do lead) vem antes do 7 para a evidência apontar para o lead correto.
      let lead = await r.leads.findOpenByContact(contact.id);
      let leadCreated = false;
      if (!lead) {
        const latest = await r.leads.findLatestByContact(contact.id);
        const reopenWindowPassed =
          !!latest?.closedAt && at.getTime() - latest.closedAt.getTime() > this.opts.reopenAfterDays * DAY_MS;
        const shouldCreate = isAdReferral || (!latest && !contact.preExisting) || reopenWindowPassed;

        if (shouldCreate) {
          lead = await r.leads.create({
            contactId: contact.id,
            stage: 'NEW',
            procedureInterestId: null,
            ownerId: null,
            attributionConfidence: 'UNKNOWN',
            adMetaId: null,
            adSetMetaId: null,
            campaignMetaId: null,
            attributionEvidenceId: null,
            // Paciente do cadastro anterior (Heon) voltando a falar com a clínica.
            ...(contact.externalId ? { originType: 'RETURNING' } : {}),
            lostReason: null,
            lostNote: null,
            openedAt: at,
            firstResponseAt: null,
            closedAt: null,
            lastActivityAt: at,
            createdAt: now,
          });
          leadCreated = true;
          await r.stageHistory.create({ leadId: lead.id, fromStage: null, toStage: 'NEW', userId: null, reason: 'mensagem recebida', at: now });

          // Evento de resposta pode ter chegado antes (fora de ordem).
          const reply = await r.messages.firstOutboundAfter(contact.id, at);
          if (reply && reply.source !== 'HISTORY') {
            lead = await this.advanceToContacted(r, lead, reply.occurredAt, 'resposta já registrada');
          }
        }
      } else {
        lead = await r.leads.update(lead.id, {
          openedAt: minDate(lead.openedAt, at),
          lastActivityAt: maxDate(lead.lastActivityAt, at),
        });
      }

      // 7. Registrar a evidência da atribuição
      let evidenceId: string | null = null;
      if (ref && lead) {
        const ev = await r.evidence.create({
          leadId: lead.id,
          contactId: contact.id,
          messageId: evt.waMessageId,
          kind: 'OFFICIAL_REFERRAL',
          sourceType: ref.sourceType,
          sourceId: ref.sourceId,
          sourceUrl: ref.sourceUrl,
          ctwaClid: ref.ctwaClid,
          headline: ref.headline,
          adMetaId,
          occurredAt: at,
          recordedById: null,
          note: isAdReferral ? null : 'Referência oficial de publicação (não é anúncio)',
          raw: ref,
          createdAt: now,
        });
        evidenceId = ev.id;
      }
      trace.push({
        step: 7,
        label: 'Registrar evidência',
        detail: evidenceId ? `evidência ${evidenceId}` : ref ? 'sem lead associado' : 'sem evidência — origem desconhecida',
      });

      // 8. Atualizar o lead e o funil
      if (lead && isAdReferral && evidenceId) {
        if (await this.shouldAdopt(r, lead, at)) {
          lead = await r.leads.update(lead.id, {
            attributionConfidence: 'OFFICIAL_REFERRAL',
            adMetaId,
            adSetMetaId,
            campaignMetaId,
            attributionEvidenceId: evidenceId,
          });
          await r.audit.log({
            userId: null,
            action: 'attribution.official',
            entityType: 'Lead',
            entityId: lead.id,
            after: { adMetaId, evidenceId },
          });
        }
      }
      trace.push({
        step: 8,
        label: 'Atualizar lead e funil',
        detail: lead ? `${leadCreated ? 'lead criado' : 'lead existente'} ${lead.id} (${lead.attributionConfidence})` : 'nenhum lead (contato pré-existente sem nova oportunidade)',
      });

      // 9. Disponibilizar no dashboard: os dados já estão persistidos; o dashboard lê
      // diretamente das tabelas. Nenhum cache a invalidar.
      trace.push({ step: 9, label: 'Disponível no dashboard', detail: 'persistido' });

      return {
        duplicate: false,
        contactId: contact.id,
        isNewContact: isNew,
        messageId: rec.message.id,
        leadId: lead?.id ?? null,
        leadCreated,
        confidence: lead?.attributionConfidence ?? 'UNKNOWN',
        adMetaId: lead?.adMetaId ?? null,
        adSetMetaId: lead?.adSetMetaId ?? null,
        campaignMetaId: lead?.campaignMetaId ?? null,
        adFoundLocally: !!ad,
        evidenceId,
        trace,
      };
    });
  }

  /** Nova referência oficial substitui a atual? */
  private async shouldAdopt(r: Repos, lead: Lead, evidenceAt: Date): Promise<boolean> {
    if (CONFIDENCE_RANK[lead.attributionConfidence] < CONFIDENCE_RANK.OFFICIAL_REFERRAL) return true;
    if (!lead.attributionEvidenceId) return true;
    const current = await r.evidence.findById(lead.attributionEvidenceId);
    // Primeiro toque por horário de ocorrência (tolera eventos fora de ordem).
    return !current || evidenceAt < current.occurredAt;
  }

  async advanceToContacted(r: Repos, lead: Lead, replyAt: Date, reason: string): Promise<Lead> {
    const patch: Partial<Lead> = {
      firstResponseAt: minDate(lead.firstResponseAt, replyAt),
      lastActivityAt: maxDate(lead.lastActivityAt, replyAt),
    };
    const from: LeadStage = lead.stage;
    if (from === 'NEW') patch.stage = 'CONTACTED';
    const updated = await r.leads.update(lead.id, patch);
    if (from === 'NEW') {
      await r.stageHistory.create({ leadId: lead.id, fromStage: from, toStage: 'CONTACTED', userId: null, reason, at: this.clock.now() });
    }
    return updated;
  }

  /**
   * Após sincronizar anúncios da Meta, completa campanha/conjunto de leads e
   * vendas que chegaram com referência a um anúncio ainda desconhecido.
   */
  async resolvePendingHierarchy(): Promise<number> {
    return this.repos.tx(async (r) => {
      let fixed = 0;
      for (const lead of await r.leads.listMissingHierarchy()) {
        const ad = lead.adMetaId ? await r.ads.findAd(lead.adMetaId) : null;
        if (!ad) continue;
        await r.leads.update(lead.id, { adSetMetaId: ad.adSetMetaId, campaignMetaId: ad.campaignMetaId });
        for (const sale of await r.sales.listByLead(lead.id)) {
          if (sale.adMetaId === ad.metaId && !sale.campaignMetaId) {
            await r.sales.update(sale.id, { campaignMetaId: ad.campaignMetaId });
          }
        }
        fixed++;
      }
      return fixed;
    });
  }
}
