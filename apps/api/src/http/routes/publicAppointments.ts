// Página pública da paciente (link da mensagem): ver o horário e confirmar, desmarcar ou pedir remarcação.
// Sem login: o acesso é pelo token assinado do agendamento. Mostra só o primeiro nome e o procedimento.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import { readAppointmentToken } from '../../modules/agenda/appointmentLink.js';
import { DEFAULT_TEMPLATES, TEMPLATES_KEY, type TemplatesSettings } from '../../modules/recalls/RecallService.js';

const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

export function registerPublicAppointmentRoutes(app: FastifyInstance, c: Container) {
  const load = async (token: string) => {
    const id = readAppointmentToken(token, c.env.JWT_SECRET);
    if (!id) throw new DomainError('NOT_FOUND', 'Link inválido', 404);
    const a = await c.repos.appointments.findById(id);
    if (!a) throw new DomainError('NOT_FOUND', 'Agendamento não encontrado', 404);
    return a;
  };

  const view = async (token: string) => {
    const a = await load(token);
    const lead = await c.repos.leads.findById(a.leadId);
    const contact = lead ? await c.repos.contacts.findById(lead.contactId) : null;
    const proc = a.procedureId ? await c.repos.procedures.findById(a.procedureId) : null;
    const settings = (await c.repos.settings.get<TemplatesSettings>(TEMPLATES_KEY)) ?? DEFAULT_TEMPLATES;
    const name = contact?.name ?? contact?.profileName ?? '';
    const past = a.scheduledFor.getTime() < Date.now();
    return {
      firstName: name.trim().split(/\s+/)[0] || null,
      procedureName: proc?.name ?? null,
      scheduledFor: a.scheduledFor,
      durationMin: a.durationMin ?? 60,
      status: a.status,
      patientResponse: a.patientResponse ?? null,
      clinicName: settings.clinicName,
      clinicWhatsapp: settings.clinicWhatsapp ?? DEFAULT_TEMPLATES.clinicWhatsapp ?? null,
      canAnswer: !past && (a.status === 'SCHEDULED' || a.status === 'CONFIRMED'),
    };
  };

  app.get('/public/appointments/:token', limit, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(120) }).parse(req.params);
    return view(token);
  });

  app.post('/public/appointments/:token', limit, async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(120) }).parse(req.params);
    const b = z.object({ action: z.enum(['CONFIRM', 'CANCEL', 'RESCHEDULE']), note: z.string().max(500).nullish() }).parse(req.body);
    const a = await load(token);
    await c.funnel.patientRespond(a.id, b.action, b.note ?? null);
    await c.audit.record({ userId: null, action: `appointment.patient.${b.action.toLowerCase()}`, entityType: 'Appointment', entityId: a.id, after: { note: b.note ?? null }, ip: req.ip });
    return view(token);
  });
}
