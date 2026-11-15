import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { hashPassword } from '../../modules/auth/auth.js';
import { permissionsOf } from '../../modules/auth/rbac.js';
import type { Guard } from '../server.js';

export function registerAuthRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const res = await c.auth.login(body.email, body.password);
    await c.audit.record({ userId: res.user.id, action: 'auth.login', entityType: 'User', entityId: res.user.id, ip: req.ip });
    return { ...res, permissions: permissionsOf(res.user.role) };
  });

  app.get('/auth/me', { preHandler: guard('leads:read') }, async (req) => ({
    user: req.user,
    permissions: permissionsOf(req.user!.role),
  }));

  app.get('/users', { preHandler: guard('users:manage') }, async () =>
    (await c.repos.users.list()).map(({ passwordHash: _p, ...u }) => u),
  );

  app.post('/users', { preHandler: guard('users:manage') }, async (req) => {
    const body = z
      .object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(10, 'Senha deve ter ao menos 10 caracteres'),
        role: z.enum(['ADMIN', 'MANAGER', 'RECEPTIONIST', 'VIEWER']),
      })
      .parse(req.body);
    const user = await c.repos.users.create({
      name: body.name,
      email: body.email.toLowerCase(),
      passwordHash: await hashPassword(body.password),
      role: body.role,
      active: true,
    });
    await c.audit.record({ userId: req.user!.sub, action: 'user.create', entityType: 'User', entityId: user.id, after: { email: user.email, role: user.role }, ip: req.ip });
    const { passwordHash: _p, ...safe } = user;
    return safe;
  });
}
