// Importação de pacientes e histórico da agenda do Heon (só administradores).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { DomainError } from '../../domain/errors.js';
import type { Guard } from '../server.js';

const files = {
  patientsCsv: z.string().min(10, 'Envie o arquivo de pacientes').max(5_000_000),
  agendaCsv: z.string().max(5_000_000).nullish(),
};

/** Erros de leitura do arquivo viram mensagem para a tela. */
async function readable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && !(e instanceof DomainError) && /Arquivo/.test(e.message)) throw new DomainError('VALIDATION', e.message);
    throw e;
  }
}

export function registerImportRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.post('/imports/heon/preview', { preHandler: guard('users:manage') }, async (req) => {
    const b = z.object(files).parse(req.body);
    return readable(() => c.heonImport.preview(b));
  });

  app.post('/imports/heon/patients', { preHandler: guard('users:manage') }, async (req) => {
    const b = z
      .object({ ...files, offset: z.number().int().min(0), limit: z.number().int().min(1).max(300).default(150), includeSensitive: z.boolean().default(false) })
      .parse(req.body);
    const r = await readable(() => c.heonImport.importPatients(b, b));
    if (b.offset === 0)
      await c.audit.record({ userId: req.user!.sub, action: 'import.heon.patients', entityType: 'Contact', entityId: null, before: null, after: { total: r.total, includeSensitive: b.includeSensitive }, ip: req.ip });
    return r;
  });

  app.post('/imports/heon/agenda', { preHandler: guard('users:manage') }, async (req) => {
    const b = z
      .object({ ...files, offset: z.number().int().min(0), limit: z.number().int().min(1).max(100).default(40), mapping: z.record(z.string(), z.string().nullable()).default({}) })
      .parse(req.body);
    const r = await readable(() => c.heonImport.importAgenda(b, { ...b, userId: req.user!.sub }));
    if (b.offset === 0)
      await c.audit.record({ userId: req.user!.sub, action: 'import.heon.agenda', entityType: 'Appointment', entityId: null, before: null, after: { patients: r.total, mapping: b.mapping }, ip: req.ip });
    return r;
  });
}
