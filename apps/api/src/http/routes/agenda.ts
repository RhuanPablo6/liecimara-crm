// Agenda de pacientes: listar o período, buscar paciente, marcar, remarcar.
// Confirmar / compareceu / faltou / cancelar usam as rotas de agendamento já existentes.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { ORGANIC_KEYS } from '../../domain/origin.js';
import type { Lead } from '../../domain/types.js';
import { appointmentToken } from '../../modules/agenda/appointmentLink.js';
import type { Guard } from '../server.js';

const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });
const duration = z.number().int().min(15).max(600);
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido');
/** Dia/hora de São Paulo (UTC−3 fixo) → instante. */
const spInstant = (day: string, time = '00:00') => new Date(`${day}T${time}:00-03:00`);
const nextDay = (day: string) => new Date(spInstant(day).getTime() + 86_400_000);

/** Motivos prontos (texto livre também é aceito). */
export const BLOCK_REASONS = ['Férias', 'Congresso / curso', 'Compromisso pessoal', 'Consulta médica', 'Feriado', 'Outro'];

export function registerAgendaRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  /** Recusa horário em período fechado, salvo se a recepção confirmou o encaixe. */
  async function assertOpen(start: Date, durationMin: number, ignoreBlock?: boolean | null) {
    if (ignoreBlock) return;
    const end = new Date(start.getTime() + durationMin * 60_000);
    const [blk] = await c.repos.agendaBlocks.listBetween(start, end);
    if (blk) {
      throw new DomainError('AGENDA_CLOSED', `A agenda está fechada neste horário (${blk.reason}${blk.note ? `: ${blk.note}` : ''}).`, 409);
    }
  }

  // ---------- Agenda fechada ----------

  app.get('/agenda/blocks', { preHandler: guard('leads:read') }, async (req) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    if (q.to <= q.from) throw new DomainError('VALIDATION', 'Período inválido');
    return c.repos.agendaBlocks.listBetween(q.from, q.to);
  });

  /** Próximos períodos fechados (para a lista na tela). */
  app.get('/agenda/blocks/upcoming', { preHandler: guard('leads:read') }, async () => {
    const now = new Date();
    return c.repos.agendaBlocks.listBetween(now, new Date(now.getTime() + 366 * 86_400_000));
  });

  app.post('/agenda/blocks', { preHandler: guard('leads:write') }, async (req) => {
    const b = z
      .object({
        allDay: z.boolean().default(true),
        startDay: dayStr,
        endDay: dayStr.nullish(),
        startTime: timeStr.nullish(),
        endTime: timeStr.nullish(),
        reason: z.string().trim().min(2, 'Informe o motivo').max(80),
        note: z.string().trim().max(300).nullish(),
      })
      .parse(req.body);
    let startAt: Date;
    let endAt: Date;
    if (b.allDay) {
      const endDay = b.endDay ?? b.startDay;
      if (endDay < b.startDay) throw new DomainError('VALIDATION', 'A data final é antes da inicial');
      startAt = spInstant(b.startDay);
      endAt = nextDay(endDay);
      if (endAt.getTime() - startAt.getTime() > 120 * 86_400_000) throw new DomainError('VALIDATION', 'Período longo demais (até 120 dias)');
    } else {
      if (!b.startTime || !b.endTime) throw new DomainError('VALIDATION', 'Informe o horário de início e de fim');
      if (b.endTime <= b.startTime) throw new DomainError('VALIDATION', 'O horário final deve ser depois do inicial');
      startAt = spInstant(b.startDay, b.startTime);
      endAt = spInstant(b.startDay, b.endTime);
    }
    const block = await c.repos.agendaBlocks.create({
      startAt,
      endAt,
      allDay: b.allDay,
      reason: b.reason,
      note: b.note || null,
      createdById: req.user!.sub,
    });
    await c.audit.record({ userId: req.user!.sub, action: 'agenda.block.create', entityType: 'AgendaBlock', entityId: block.id, after: block, ip: req.ip });
    // Pacientes já marcadas dentro do período: a tela avisa para remarcar.
    const affected = [];
    for (const a of await c.repos.appointments.listScheduledBetween({ from: new Date(startAt.getTime() - 12 * 3_600_000), to: endAt })) {
      const aEnd = a.scheduledFor.getTime() + (a.durationMin ?? 60) * 60_000;
      if (a.status !== 'SCHEDULED' && a.status !== 'CONFIRMED') continue;
      if (!(a.scheduledFor < endAt && aEnd > startAt.getTime())) continue;
      const lead = await c.repos.leads.findById(a.leadId);
      const contact = lead ? await c.repos.contacts.findById(lead.contactId) : null;
      affected.push({ id: a.id, scheduledFor: a.scheduledFor, name: contact?.name ?? contact?.profileName ?? null, waId: contact?.waId ?? null });
    }
    return { block, affected };
  });

  app.delete('/agenda/blocks/:id', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const block = await c.repos.agendaBlocks.findById(id);
    if (!block) throw new DomainError('NOT_FOUND', 'Bloqueio não encontrado', 404);
    await c.repos.agendaBlocks.delete(id);
    await c.audit.record({ userId: req.user!.sub, action: 'agenda.block.delete', entityType: 'AgendaBlock', entityId: id, before: block, ip: req.ip });
    return { ok: true };
  });

  app.get('/agenda', { preHandler: guard('leads:read') }, async (req) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    if (q.to <= q.from || q.to.getTime() - q.from.getTime() > 62 * 86_400_000) throw new DomainError('VALIDATION', 'Período inválido (até 2 meses)');
    const [appts, procedures] = await Promise.all([c.repos.appointments.listScheduledBetween({ from: q.from, to: q.to }), c.repos.procedures.list()]);
    const procName = new Map(procedures.map((p) => [p.id, p.name]));
    const out = [];
    const leadCache = new Map<string, Lead | null>();
    for (const a of appts) {
      if (!leadCache.has(a.leadId)) leadCache.set(a.leadId, await c.repos.leads.findById(a.leadId));
      const lead = leadCache.get(a.leadId);
      const contact = lead ? await c.repos.contacts.findById(lead.contactId) : null;
      out.push({
        id: a.id,
        leadId: a.leadId,
        contactId: contact?.id ?? null,
        name: contact?.name ?? contact?.profileName ?? null,
        waId: contact?.waId ?? null,
        procedureId: a.procedureId,
        procedureName: a.procedureId ? (procName.get(a.procedureId) ?? null) : null,
        scheduledFor: a.scheduledFor,
        durationMin: a.durationMin ?? 60,
        notes: a.notes ?? null,
        status: a.status,
        cancelReason: a.cancelReason,
        patientResponse: a.patientResponse ?? null,
        patientResponseAt: a.patientResponseAt ?? null,
        patientNote: a.patientNote ?? null,
      });
    }
    return out.sort((x, y) => x.scheduledFor.getTime() - y.scheduledFor.getTime());
  });

  /** Busca rápida de paciente pelo nome ou telefone, para marcar horário. */
  app.get('/agenda/patients', { preHandler: guard('leads:read') }, async (req) => {
    const q = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query);
    const term = q.q.toLowerCase();
    const digits = q.q.replace(/\D/g, '');
    const contacts = (await c.repos.contacts.list()).filter(
      (ct) => (ct.name ?? ct.profileName ?? '').toLowerCase().includes(term) || (digits.length >= 4 && (ct.waId ?? '').includes(digits)),
    );
    const out = [];
    for (const ct of contacts.slice(0, 12)) {
      const lead = (await c.repos.leads.findOpenByContact(ct.id)) ?? (await c.repos.leads.findLatestByContact(ct.id));
      out.push({ contactId: ct.id, name: ct.name ?? ct.profileName ?? null, waId: ct.waId, leadId: lead?.id ?? null, procedureInterestId: lead?.procedureInterestId ?? null });
    }
    return out;
  });

  app.post('/agenda/appointments', { preHandler: guard('leads:write') }, async (req) => {
    const b = z
      .object({
        leadId: z.string().min(1).nullish(),
        // Paciente nova (ou só o telefone): cria/acha o contato
        waId: z.string().transform((v) => v.replace(/\D/g, '')).nullish(),
        name: z.string().trim().max(120).nullish(),
        origin: z.object({ type: z.enum(ORGANIC_KEYS as [string, ...string[]]), note: z.string().max(200).nullish() }).nullish(),
        procedureId: z.string().min(1).nullish(),
        scheduledFor: z.coerce.date(),
        durationMin: duration.default(60),
        notes: z.string().max(500).nullish(),
        ignoreBlock: z.boolean().nullish(),
      })
      .parse(req.body);
    await assertOpen(b.scheduledFor, b.durationMin, b.ignoreBlock);
    const actor = actorOf(req);
    let leadId = b.leadId ?? null;
    if (!leadId) {
      if (!b.waId || b.waId.length < 10) throw new DomainError('VALIDATION', 'Escolha a paciente ou informe o WhatsApp (DDI + DDD + número)');
      const contact = await c.repos.contacts.findByWaId(b.waId);
      const lead = contact ? ((await c.repos.leads.findOpenByContact(contact.id)) ?? (await c.repos.leads.findLatestByContact(contact.id))) : null;
      if (lead && lead.stage !== 'LOST') leadId = lead.id;
      else {
        const created = await c.funnel.createLeadManually(
          { waId: b.waId, name: b.name ?? undefined, procedureInterestId: b.procedureId ?? null, origin: (b.origin as any) ?? null },
          actor,
        );
        leadId = created.id;
      }
    } else {
      const lead = await c.repos.leads.findById(leadId);
      if (!lead) throw new DomainError('NOT_FOUND', 'Paciente não encontrada', 404);
      if (lead.stage === 'LOST') {
        // Lead perdido: abre um novo atendimento para a mesma paciente.
        const contact = await c.repos.contacts.findById(lead.contactId);
        const created = await c.funnel.createLeadManually({ waId: contact!.waId!, procedureInterestId: b.procedureId ?? null }, actor);
        leadId = created.id;
      }
    }
    const created = await c.funnel.scheduleAppointment(leadId, { scheduledFor: b.scheduledFor, procedureId: b.procedureId ?? null, durationMin: b.durationMin, notes: b.notes ?? null }, actor);
    // Novo horário para quem tinha pedido remarcação: o pedido sai da lista.
    for (const old of await c.repos.appointments.listByLead(leadId)) {
      if (old.patientResponse === 'RESCHEDULE' && !old.rescheduleHandled) await c.repos.appointments.update(old.id, { rescheduleHandled: true });
    }
    return created;
  });

  /** Link pessoal da paciente (para a mensagem de confirmação). */
  app.get('/appointments/:id/link', { preHandler: guard('leads:read') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    if (!(await c.repos.appointments.findById(id))) throw new DomainError('NOT_FOUND', 'Agendamento não encontrado', 404);
    return { token: appointmentToken(id, c.env.JWT_SECRET) };
  });

  /** Respostas das pacientes pelo link (últimos 3 dias) e pedidos de remarcação em aberto. */
  app.get('/agenda/responses', { preHandler: guard('leads:read') }, async () => {
    const since = Date.now() - 3 * 86_400_000;
    const all = await c.repos.appointments.listScheduledBetween({ from: new Date(Date.now() - 120 * 86_400_000), to: new Date(Date.now() + 365 * 86_400_000) });
    const procedures = new Map((await c.repos.procedures.list()).map((p) => [p.id, p.name]));
    const rows = [];
    for (const a of all) {
      if (!a.patientResponse) continue;
      const pending = a.patientResponse === 'RESCHEDULE' && !a.rescheduleHandled;
      if (!pending && (!a.patientResponseAt || a.patientResponseAt.getTime() < since)) continue;
      const lead = await c.repos.leads.findById(a.leadId);
      const contact = lead ? await c.repos.contacts.findById(lead.contactId) : null;
      rows.push({
        id: a.id,
        leadId: a.leadId,
        contactId: contact?.id ?? null,
        name: contact?.name ?? contact?.profileName ?? null,
        waId: contact?.waId ?? null,
        procedureName: a.procedureId ? (procedures.get(a.procedureId) ?? null) : null,
        scheduledFor: a.scheduledFor,
        response: a.patientResponse,
        respondedAt: a.patientResponseAt,
        note: a.patientNote ?? null,
        pending,
      });
    }
    return rows.sort((x, y) => Number(y.pending) - Number(x.pending) || (y.respondedAt?.getTime() ?? 0) - (x.respondedAt?.getTime() ?? 0));
  });

  app.post('/appointments/:id/reschedule-handled', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await c.repos.appointments.update(id, { rescheduleHandled: true });
    return { ok: true };
  });

  app.patch('/appointments/:id', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = z
      .object({
        scheduledFor: z.coerce.date().optional(),
        durationMin: duration.optional(),
        procedureId: z.string().min(1).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        ignoreBlock: z.boolean().nullish(),
      })
      .parse(req.body);
    const { ignoreBlock, ...patch } = b;
    if (patch.scheduledFor || patch.durationMin) {
      const current = await c.repos.appointments.findById(id);
      if (current) await assertOpen(patch.scheduledFor ?? current.scheduledFor, patch.durationMin ?? current.durationMin ?? 60, ignoreBlock);
    }
    return c.funnel.updateAppointment(id, patch, actorOf(req));
  });
}
