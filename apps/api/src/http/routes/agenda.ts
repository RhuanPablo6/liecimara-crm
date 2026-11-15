// Agenda de pacientes: listar o período, buscar paciente, marcar, remarcar.
// Confirmar / compareceu / faltou / cancelar usam as rotas de agendamento já existentes.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { ORGANIC_KEYS } from '../../domain/origin.js';
import type { Lead } from '../../domain/types.js';
import type { Guard } from '../server.js';

const actorOf = (req: { user?: { sub: string }; ip: string }) => ({ id: req.user!.sub, ip: req.ip });
const duration = z.number().int().min(15).max(600);

export function registerAgendaRoutes(app: FastifyInstance, c: Container, guard: Guard) {
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
      })
      .parse(req.body);
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
    return c.funnel.scheduleAppointment(leadId, { scheduledFor: b.scheduledFor, procedureId: b.procedureId ?? null, durationMin: b.durationMin, notes: b.notes ?? null }, actor);
  });

  app.patch('/appointments/:id', { preHandler: guard('leads:write') }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const b = z
      .object({ scheduledFor: z.coerce.date().optional(), durationMin: duration.optional(), procedureId: z.string().min(1).nullable().optional(), notes: z.string().max(500).nullable().optional() })
      .parse(req.body);
    return c.funnel.updateAppointment(id, b, actorOf(req));
  });
}
