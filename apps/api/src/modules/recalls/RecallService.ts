// Retornos e reativação: quem está na hora de voltar, quem sumiu, quem confirmar amanhã e
// quem atendemos ontem (pós-procedimento). Tudo calculado com o que já está no CRM.
//
// Retorno: última vez que a paciente fez/comprou o procedimento + intervalo de retorno do procedimento.
// Some da lista quando há agendamento futuro, quando foi marcado "contatado"/"adiado" (até a data) ou
// "não quer" (só para aquele ciclo: uma compra nova abre um ciclo novo).

import type { Contact, Lead, RecallAction } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import { addDays, daysBetween, spDay } from '../../shared/days.js';

export const REACTIVATION_DAYS = 180;
const WIDE = { from: new Date('2000-01-01T00:00:00Z'), to: new Date('2999-12-31T00:00:00Z') };

export type RecallStatus = 'UPCOMING' | 'DUE' | 'LATE';

interface Base {
  contactId: string;
  leadId: string | null;
  name: string | null;
  firstName: string | null;
  waId: string | null;
  lastContactedAt: Date | null;
}

const firstNameOf = (name: string | null) => (name ? (name.trim().split(/\s+/)[0] ?? null) : null);

/** Ação vale para o ciclo enquanto não venceu (adiado/contatado) ou para sempre no ciclo (não quer). */
export function isHidden(actions: RecallAction[], dueKey: string, now: Date) {
  return actions.some((a) => a.dueKey === dueKey && (a.kind === 'DISMISSED' || (a.until && a.until > now)));
}

export class RecallService {
  constructor(private readonly repos: Repos) {}

  async board(now = new Date(), opts: { horizonDays?: number } = {}) {
    const today = spDay(now);
    const horizon = addDays(today, opts.horizonDays ?? 14);
    const [contacts, leads, sales, appointments, procedures, actions, performed] = await Promise.all([
      this.repos.contacts.list(),
      this.repos.leads.list({ limit: 1_000_000 }),
      this.repos.sales.listSoldIn(WIDE),
      this.repos.appointments.listScheduledBetween(WIDE),
      this.repos.procedures.list(),
      this.repos.recalls.list(),
      this.repos.performed.listPerformedIn(WIDE),
    ]);

    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const proc = new Map(procedures.map((p) => [p.id, p]));
    const leadsBy = new Map<string, Lead[]>();
    for (const l of leads) leadsBy.set(l.contactId, [...(leadsBy.get(l.contactId) ?? []), l]);
    const contactOf = new Map(leads.map((l) => [l.id, l.contactId]));
    const actionsBy = new Map<string, RecallAction[]>();
    for (const a of actions) actionsBy.set(a.contactId, [...(actionsBy.get(a.contactId) ?? []), a]);

    const base = (c: Contact): Base => {
      const ls = (leadsBy.get(c.id) ?? []).sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      const contacted = (actionsBy.get(c.id) ?? []).filter((a) => a.kind === 'CONTACTED').at(-1);
      const name = c.name ?? c.profileName ?? null;
      return { contactId: c.id, leadId: ls[0]?.id ?? null, name, firstName: firstNameOf(name), waId: c.waId, lastContactedAt: contacted?.createdAt ?? null };
    };

    // Última vez de cada procedimento por paciente (compra ativa ou procedimento realizado).
    const last = new Map<string, Map<string, Date>>();
    const lastActivity = new Map<string, Date>();
    const bump = (cid: string | undefined, pid: string, at: Date) => {
      if (!cid) return;
      const m = last.get(cid) ?? new Map<string, Date>();
      if (!m.has(pid) || m.get(pid)! < at) m.set(pid, at);
      last.set(cid, m);
      if (!lastActivity.has(cid) || lastActivity.get(cid)! < at) lastActivity.set(cid, at);
    };
    for (const s of sales) if (s.status === 'ACTIVE') bump(contactOf.get(s.leadId), s.procedureId, s.soldAt);
    for (const p of performed) bump(contactOf.get(p.leadId), p.procedureId, p.performedAt);
    for (const a of appointments) {
      if (a.status !== 'ATTENDED') continue;
      const cid = contactOf.get(a.leadId);
      if (cid && (!lastActivity.has(cid) || lastActivity.get(cid)! < a.scheduledFor)) lastActivity.set(cid, a.scheduledFor);
    }
    const futureAppt = new Set(
      appointments
        .filter((a) => (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && a.scheduledFor > now)
        .map((a) => contactOf.get(a.leadId))
        .filter(Boolean) as string[],
    );

    // ── Retornos ──
    const returns = [];
    for (const [cid, byProc] of last) {
      const c = contactById.get(cid);
      if (!c || futureAppt.has(cid)) continue;
      for (const [pid, at] of byProc) {
        const p = proc.get(pid);
        if (!p?.returnDays) continue;
        const lastDay = spDay(at);
        const dueDay = addDays(lastDay, p.returnDays);
        if (dueDay > horizon) continue;
        const dueKey = `${pid}:${lastDay}`;
        if (isHidden(actionsBy.get(cid) ?? [], dueKey, now)) continue;
        const late = daysBetween(dueDay, today);
        returns.push({
          ...base(c),
          dueKey,
          procedureId: pid,
          procedureName: p.name,
          lastDay,
          dueDay,
          daysLate: late,
          status: (late < 0 ? 'UPCOMING' : late <= 30 ? 'DUE' : 'LATE') as RecallStatus,
        });
      }
    }
    returns.sort((a, b) => a.dueDay.localeCompare(b.dueDay));

    // ── Reativação: sem vir há 6 meses ou mais, sem agendamento e fora da lista de retornos ──
    const inReturns = new Set(returns.map((r) => r.contactId));
    const reactivation = [];
    for (const [cid, at] of lastActivity) {
      const c = contactById.get(cid);
      if (!c || futureAppt.has(cid) || inReturns.has(cid)) continue;
      const days = daysBetween(spDay(at), today);
      if (days < REACTIVATION_DAYS) continue;
      const dueKey = `reactivation:${spDay(at)}`;
      if (isHidden(actionsBy.get(cid) ?? [], dueKey, now)) continue;
      const procs = [...(last.get(cid)?.entries() ?? [])].sort((a, b) => b[1].getTime() - a[1].getTime());
      const lastProc = procs[0] ? proc.get(procs[0][0])?.name ?? null : null;
      reactivation.push({ ...base(c), dueKey, lastDay: spDay(at), daysSince: days, procedureName: lastProc });
    }
    reactivation.sort((a, b) => a.daysSince - b.daysSince);

    // ── Confirmar amanhã e pós-procedimento (ontem e hoje) ──
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);
    const apptRow = (a: (typeof appointments)[number]) => {
      const cid = contactOf.get(a.leadId);
      const c = cid ? contactById.get(cid) : undefined;
      return c
        ? {
            ...base(c),
            leadId: a.leadId,
            appointmentId: a.id,
            scheduledFor: a.scheduledFor,
            status: a.status,
            procedureId: a.procedureId,
            procedureName: a.procedureId ? (proc.get(a.procedureId)?.name ?? null) : null,
          }
        : null;
    };
    const confirmTomorrow = appointments
      .filter((a) => (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && spDay(a.scheduledFor) === tomorrow)
      .map(apptRow)
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
    const postCare = appointments
      .filter((a) => a.status === 'ATTENDED' && [yesterday, today].includes(spDay(a.scheduledFor)))
      .map(apptRow)
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime());

    return {
      today,
      horizon,
      returns,
      reactivation,
      confirmTomorrow,
      postCare,
      summary: {
        returnsDue: returns.filter((r) => r.status !== 'UPCOMING').length,
        returnsUpcoming: returns.filter((r) => r.status === 'UPCOMING').length,
        reactivation: reactivation.length,
        confirmTomorrow: confirmTomorrow.filter((a) => a.status === 'SCHEDULED').length,
        postCare: postCare.length,
      },
    };
  }

  async act(input: { contactId: string; dueKey: string; kind: RecallAction['kind']; days?: number | null; note?: string | null }, actorId: string, now = new Date()) {
    return this.repos.recalls.create({
      contactId: input.contactId,
      dueKey: input.dueKey,
      kind: input.kind,
      until: input.kind === 'DISMISSED' ? null : new Date(now.getTime() + (input.days ?? 7) * 86_400_000),
      note: input.note?.trim() || null,
      createdById: actorId,
    });
  }
}

// ── Mensagens prontas ─────────────────────────────────────────

export const TEMPLATES_KEY = 'messages.templates';

export interface MessageTemplate {
  id: string;
  name: string;
  /** Onde aparece primeiro: retorno, reativação, confirmação, pós, cobrança ou geral. */
  use: 'RETURN' | 'REACTIVATION' | 'CONFIRM' | 'POSTCARE' | 'CHARGE' | 'GENERAL';
  body: string;
}

export interface TemplatesSettings {
  clinicName: string;
  /** WhatsApp da clínica (para a paciente falar com a recepção a partir do link). */
  clinicWhatsapp?: string | null;
  templates: MessageTemplate[];
}

export const PLACEHOLDERS = ['{nome}', '{primeiro_nome}', '{procedimento}', '{data}', '{hora}', '{clinica}', '{valor}', '{ultima_vez}', '{link}'];

export const DEFAULT_TEMPLATES: TemplatesSettings = {
  clinicName: 'Clínica Dra. Liecimara Esteves',
  clinicWhatsapp: '5511959699628',
  templates: [
    {
      id: 'return',
      name: 'Retorno do procedimento',
      use: 'RETURN',
      body: 'Oi, {primeiro_nome}! Tudo bem? Aqui é da {clinica} 💛 Já está chegando a hora de renovar o seu {procedimento} (a última vez foi em {ultima_vez}). Quer que eu veja um horário para você esta semana?',
    },
    {
      id: 'reactivation',
      name: 'Saudade (reativação)',
      use: 'REACTIVATION',
      body: 'Oi, {primeiro_nome}! Que saudade de você aqui na {clinica} 💛 Faz um tempinho desde a sua última visita. Que tal agendar uma avaliação para ver como está a sua pele e o que podemos fazer agora?',
    },
    {
      id: 'confirm',
      name: 'Confirmação de agendamento',
      use: 'CONFIRM',
      body: 'Oi, {primeiro_nome}! Passando para lembrar do seu horário de {procedimento} no dia {data}, às {hora}, aqui na {clinica} 😊\n\nToque no link para confirmar, desmarcar ou remarcar: {link}',
    },
    {
      id: 'postcare',
      name: 'Pós-procedimento',
      use: 'POSTCARE',
      body: 'Oi, {primeiro_nome}! Como você está depois do {procedimento}? Qualquer dúvida sobre os cuidados ou se sentir algo diferente, é só chamar aqui. Um beijo da equipe {clinica} 💛',
    },
    {
      id: 'charge',
      name: 'Lembrete de pagamento',
      use: 'CHARGE',
      body: 'Oi, {primeiro_nome}! Tudo bem? Passando para lembrar do valor de {valor} referente ao {procedimento}. Se preferir, te envio a chave Pix por aqui. Obrigada! 💛',
    },
    {
      id: 'thanks',
      name: 'Agradecimento',
      use: 'GENERAL',
      body: 'Oi, {primeiro_nome}! Obrigada pela confiança na {clinica} 💛 Se puder, conta para a gente como foi a sua experiência. Isso nos ajuda muito!',
    },
  ],
};
