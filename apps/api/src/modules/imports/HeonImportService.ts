// Importação do Heon: cadastro de pacientes (+ histórico de agendamentos) para dentro do CRM.
//
// Idempotente: pode rodar de novo com o mesmo arquivo (ou um mais novo) sem duplicar.
// - Paciente: procura por "heon:<uid>" e pelo WhatsApp (com e sem o 9). Nunca troca um nome já
//   corrigido no CRM; só completa o que está vazio.
// - Agenda: só agendamentos passados (os futuros continuam sendo marcados no CRM). Ficam num
//   atendimento "importado" por paciente, fora do funil e dos relatórios de leads. Quem já tem
//   agendamento no CRM no mesmo dia não recebe outro.
// - Agendamento compareceu + procedimento vinculado = procedimento realizado (alimenta os retornos).

import type { Appointment, Contact, Lead } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import { dayStart, spDay } from '../../shared/days.js';
import {
  type HeonAppointment,
  type HeonPatient,
  type HeonPatientGroup,
  parseHeonAgenda,
  parseHeonPatients,
  suggestProcedure,
  waIdVariants,
} from './heon.js';

export interface HeonFiles {
  patientsCsv: string;
  agendaCsv?: string | null;
}

const extId = (uid: string) => `heon:${uid}`;

export class HeonImportService {
  constructor(private readonly repos: Repos) {}

  private parse(files: HeonFiles, now: Date) {
    const patients = parseHeonPatients(files.patientsCsv, now);
    const agenda = files.agendaCsv ? parseHeonAgenda(files.agendaCsv) : [];
    // Nome → grupos com esse nome (para ligar a agenda ao cadastro).
    const byKey = new Map<string, HeonPatientGroup[]>();
    for (const g of patients.groups)
      for (const p of [g.primary, ...g.duplicates]) {
        const arr = byKey.get(p.key) ?? [];
        if (!arr.includes(g)) arr.push(g);
        byKey.set(p.key, arr);
      }
    const today = spDay(now);
    const matched = new Map<HeonPatientGroup, HeonAppointment[]>();
    const unmatched = new Set<string>();
    const ambiguous = new Set<string>();
    let blocks = 0;
    let future = 0;
    for (const a of agenda) {
      if (a.block) {
        blocks++;
        continue;
      }
      if (a.day >= today) {
        future++;
        continue;
      }
      const gs = byKey.get(a.patientKey) ?? [];
      if (gs.length === 1) matched.set(gs[0]!, [...(matched.get(gs[0]!) ?? []), a]);
      else (gs.length ? ambiguous : unmatched).add(a.patientName);
    }
    return { patients, agenda, matched, unmatched, ambiguous, blocks, future };
  }

  /** Resumo antes de importar: o que entra, o que é descartado e a ligação dos procedimentos. */
  async preview(files: HeonFiles, now = new Date()) {
    const p = this.parse(files, now);
    const [contacts, procedures] = await Promise.all([this.repos.contacts.list(), this.repos.procedures.list()]);
    const known = new Set(contacts.flatMap((c) => [c.waId, c.externalId].filter(Boolean) as string[]));
    const groups = p.patients.groups;
    const inCrm = groups.filter((g) => known.has(extId(g.primary.uid)) || (g.primary.waId && waIdVariants(g.primary.waId).some((w) => known.has(w)))).length;

    const procCount = new Map<string, number>();
    for (const list of p.matched.values()) for (const a of list) procCount.set(a.procedure, (procCount.get(a.procedure) ?? 0) + 1);
    const active = procedures.filter((x) => x.active);

    const pastMatched = [...p.matched.values()].flat();
    return {
      patients: {
        rows: p.patients.total,
        people: groups.length,
        mergedDuplicates: p.patients.total - groups.length,
        withWhatsApp: groups.filter((g) => g.primary.phoneKind === 'MOBILE' && g.primary.waId).length,
        landline: groups.filter((g) => g.primary.phoneKind === 'LANDLINE' && g.primary.waId).length,
        noPhone: groups.filter((g) => !g.primary.waId).length,
        sharedPhone: p.patients.sharedPhone,
        alreadyInCrm: inCrm,
        newInCrm: groups.length - inCrm,
        fixedNames: groups.filter((g) => g.primary.nameFixed).length,
        birthDates: groups.filter((g) => g.primary.birthDate).length,
        discardedBirthDates: p.patients.discardedBirthDates,
        emails: groups.filter((g) => g.primary.email).length,
        fakeEmails: p.patients.fakeEmails,
        cpfs: groups.filter((g) => g.primary.cpf).length,
        invalidCpf: p.patients.invalidCpf,
        addresses: groups.filter((g) => g.primary.address).length,
      },
      agenda: {
        rows: p.agenda.length,
        from: p.agenda.reduce<string | null>((m, a) => (!m || a.day < m ? a.day : m), null),
        to: p.agenda.reduce<string | null>((m, a) => (!m || a.day > m ? a.day : m), null),
        blocks: p.blocks,
        future: p.future,
        toImport: pastMatched.length,
        canceled: pastMatched.filter((a) => a.canceled).length,
        patients: p.matched.size,
        unmatched: [...p.unmatched].sort(),
        ambiguous: [...p.ambiguous].sort(),
      },
      procedures: [...procCount]
        .map(([name, count]) => ({ name, count, suggestedId: suggestProcedure(name, active) }))
        .sort((a, b) => b.count - a.count),
      procedureOptions: active.map((x) => ({ id: x.id, name: x.name, returnDays: x.returnDays ?? null })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    };
  }

  /** Etapa 1: pacientes, em lotes (offset/limit sobre os grupos). */
  async importPatients(files: HeonFiles, opts: { offset: number; limit: number; includeSensitive: boolean }, now = new Date()) {
    const { patients, matched } = this.parse(files, now);
    const slice = patients.groups.slice(opts.offset, opts.offset + opts.limit);
    let created = 0;
    let updated = 0;
    for (const g of slice) {
      const firstVisit = (matched.get(g) ?? []).reduce<string | null>((m, a) => (!m || a.day < m ? a.day : m), null);
      const r = await this.upsertContact(g, opts.includeSensitive, firstVisit ? dayStart(firstVisit) : now, now);
      if (r === 'created') created++;
      else if (r === 'updated') updated++;
    }
    const next = opts.offset + slice.length;
    return { total: patients.groups.length, done: next, next: next < patients.groups.length ? next : null, created, updated };
  }

  /** Etapa 2: histórico da agenda, em lotes de pacientes (rodar depois da etapa 1). */
  async importAgenda(
    files: HeonFiles,
    opts: { offset: number; limit: number; mapping: Record<string, string | null>; userId: string | null },
    now = new Date(),
  ) {
    const { matched } = this.parse(files, now);
    const procIds = new Set((await this.repos.procedures.list()).map((p) => p.id));
    const leadsByContact = new Map<string, Lead[]>();
    for (const l of await this.repos.leads.list({ limit: 1_000_000 })) leadsByContact.set(l.contactId, [...(leadsByContact.get(l.contactId) ?? []), l]);
    const entries = [...matched.entries()];
    const slice = entries.slice(opts.offset, opts.offset + opts.limit);
    let created = 0;
    let skipped = 0;
    let performed = 0;
    for (const [g, appts] of slice) {
      const contact = await this.findContact(g);
      if (!contact) {
        skipped += appts.length;
        continue;
      }
      const r = await this.importAppointments(contact, leadsByContact.get(contact.id) ?? [], appts, opts.mapping, procIds, opts.userId, now);
      created += r.created;
      skipped += r.skipped;
      performed += r.performed;
    }
    const next = opts.offset + slice.length;
    return { total: entries.length, done: next, next: next < entries.length ? next : null, created, skipped, performed };
  }

  // ── internos ───────────────────────────────────────────────

  private async findContact(g: HeonPatientGroup): Promise<Contact | null> {
    for (const p of [g.primary, ...g.duplicates]) {
      const c = await this.repos.contacts.findByExternalId(extId(p.uid));
      if (c) return c;
    }
    if (g.primary.waId)
      for (const w of waIdVariants(g.primary.waId)) {
        const c = await this.repos.contacts.findByWaId(w);
        if (c) return c;
      }
    return null;
  }

  private async upsertContact(g: HeonPatientGroup, sensitive: boolean, firstSeenAt: Date, now: Date) {
    const p: HeonPatient = g.primary;
    const extra: Partial<Contact> = {
      email: p.email,
      birthDate: p.birthDate ? new Date(`${p.birthDate}T00:00:00Z`) : null,
      ...(sensitive
        ? {
            cpf: p.cpf,
            addressCep: p.address?.cep ?? null,
            addressStreet: p.address?.street ?? null,
            addressNumber: p.address?.number ?? null,
            addressDistrict: p.address?.district ?? null,
            addressCity: p.address?.city ?? null,
            addressState: p.address?.state ?? null,
          }
        : {}),
    };
    const existing = await this.findContact(g);
    if (!existing) {
      await this.repos.contacts.create({
        waId: p.waId,
        bsuid: null,
        name: p.name,
        profileName: null,
        preExisting: false,
        walletPatient: null,
        firstSeenAt,
        lastMessageAt: null,
        removedFromAppAt: null,
        externalId: extId(p.uid),
        importedAt: now,
        ...extra,
      });
      return 'created' as const;
    }
    // Só completa o que está vazio: nada do que a clínica já ajustou no CRM é sobrescrito.
    const patch: Partial<Contact> = {};
    if (!existing.name) patch.name = p.name;
    if (!existing.externalId) patch.externalId = extId(p.uid);
    if (!existing.importedAt) patch.importedAt = now;
    if (existing.firstSeenAt > firstSeenAt) patch.firstSeenAt = firstSeenAt;
    for (const [k, v] of Object.entries(extra) as [keyof Contact, unknown][]) if (v != null && existing[k] == null) (patch as any)[k] = v;
    if (!Object.keys(patch).length) return 'unchanged' as const;
    await this.repos.contacts.update(existing.id, patch);
    return 'updated' as const;
  }

  private async importAppointments(
    contact: Contact,
    contactLeads: Lead[],
    appts: HeonAppointment[],
    mapping: Record<string, string | null>,
    procIds: Set<string>,
    userId: string | null,
    now: Date,
  ) {
    let lead = await this.repos.leads.findImportedByContact(contact.id);
    // Dias que já têm agendamento feito no próprio CRM (não duplica).
    const crmDays = new Set<string>();
    for (const l of contactLeads.filter((l) => !l.imported))
      for (const a of await this.repos.appointments.listByLead(l.id)) if (!a.externalId) crmDays.add(spDay(a.scheduledFor));

    let created = 0;
    let skipped = 0;
    let performed = 0;
    for (const a of appts.sort((x, y) => (x.day + x.time).localeCompare(y.day + y.time))) {
      if (crmDays.has(a.day) || (await this.repos.appointments.findByExternalId(a.externalId))) {
        skipped++;
        continue;
      }
      const at = new Date(`${a.day}T${a.time}:00-03:00`);
      if (!lead) {
        lead = await this.repos.leads.create({
          contactId: contact.id,
          stage: 'WON',
          procedureInterestId: null,
          ownerId: null,
          attributionConfidence: 'UNKNOWN',
          adMetaId: null,
          adSetMetaId: null,
          campaignMetaId: null,
          attributionEvidenceId: null,
          originType: null,
          originNote: 'Histórico importado do Heon',
          lostReason: null,
          lostNote: null,
          openedAt: at,
          firstResponseAt: null,
          closedAt: at,
          lastActivityAt: at,
          imported: true,
          createdAt: now,
        });
      }
      const mapped = mapping[a.procedure];
      const procedureId = mapped && procIds.has(mapped) ? mapped : null;
      const notes = ['Importado do Heon', a.procedure || null, a.confirmation ? `confirmação: ${a.confirmation}` : null, a.notes || null].filter(Boolean).join(' · ');
      const appt: Omit<Appointment, 'id'> = {
        leadId: lead.id,
        procedureId,
        saleId: null,
        scheduledFor: at,
        durationMin: a.durationMin,
        notes: notes.slice(0, 1000),
        status: a.canceled ? 'CANCELED' : 'ATTENDED',
        cancelReason: a.canceled ? 'Cancelado no Heon' : null,
        externalId: a.externalId,
        rescheduleHandled: true,
        createdById: userId,
        createdAt: at,
      };
      await this.repos.appointments.create(appt);
      created++;
      if (!a.canceled && procedureId) {
        await this.repos.performed.create({ leadId: lead.id, saleId: null, procedureId, performedAt: at, createdById: userId });
        performed++;
      }
    }

    // Atendimento importado resume o histórico: aberto no primeiro, fechado no último.
    if (lead) {
      const all = await this.repos.appointments.listByLead(lead.id);
      const first = all.reduce((m, a) => (a.scheduledFor < m ? a.scheduledFor : m), all[0]?.scheduledFor ?? lead.openedAt);
      const last = all.reduce((m, a) => (a.scheduledFor > m ? a.scheduledFor : m), all[0]?.scheduledFor ?? lead.closedAt ?? lead.openedAt);
      const attended = all.some((a) => a.status === 'ATTENDED');
      await this.repos.leads.update(lead.id, {
        openedAt: first,
        closedAt: last,
        lastActivityAt: last,
        stage: attended ? 'WON' : 'LOST',
        lostReason: attended ? null : 'OTHER',
        lostNote: attended ? null : 'Histórico do Heon: só cancelamentos',
      });
      if (contact.firstSeenAt > first) await this.repos.contacts.update(contact.id, { firstSeenAt: first });
    }
    return { created, skipped, performed };
  }
}
