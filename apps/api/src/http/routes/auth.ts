import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../domain/errors.js';
import type { User } from '../../domain/types.js';
import { hashPassword, verifyPassword } from '../../modules/auth/auth.js';
import { SCREEN_KEYS, SCREEN_PRESETS, SCREENS, effectivePermissions, effectiveScreens } from '../../modules/auth/screens.js';
import type { Guard } from '../server.js';

const password = z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(200);
const screens = z.array(z.enum(SCREEN_KEYS as [string, ...string[]])).max(SCREEN_KEYS.length);

function safeUser(u: User) {
  const { passwordHash: _p, ...rest } = u;
  return {
    ...rest,
    isAdmin: u.role === 'ADMIN',
    screens: Array.isArray(u.screens) ? u.screens : null,
    effectiveScreens: effectiveScreens(u),
  };
}

export function registerAuthRoutes(app: FastifyInstance, c: Container, guard: Guard) {
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const res = await c.auth.login(body.email, body.password);
    await c.repos.users.update(res.user.id, { lastLoginAt: new Date() });
    await c.audit.record({ userId: res.user.id, action: 'auth.login', entityType: 'User', entityId: res.user.id, ip: req.ip });
    return { ...res, permissions: effectivePermissions(res.user) };
  });

  app.get('/auth/me', { preHandler: guard('app:use') }, async (req) => {
    const user = (await c.repos.users.findById(req.user!.sub))!;
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isAdmin: user.role === 'ADMIN' },
      permissions: effectivePermissions(user),
      screens: effectiveScreens(user),
      catalog: SCREENS.map(({ key, label, path, group }) => ({ key, label, path, group })),
    };
  });

  /** O próprio usuário troca a senha (pede a atual). */
  app.post('/auth/password', { preHandler: guard('app:use'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ current: z.string().min(1), next: password }).parse(req.body);
    const user = (await c.repos.users.findById(req.user!.sub))!;
    if (!(await verifyPassword(body.current, user.passwordHash))) throw new DomainError('INVALID_PASSWORD', 'Senha atual incorreta', 422);
    await c.repos.users.update(user.id, { passwordHash: await hashPassword(body.next) });
    await c.audit.record({ userId: user.id, action: 'user.password.change', entityType: 'User', entityId: user.id, ip: req.ip });
    return { ok: true };
  });

  // ---------- Administração de usuários ----------

  app.get('/users', { preHandler: guard('users:manage') }, async () => ({
    users: (await c.repos.users.list()).map(safeUser),
    catalog: SCREENS.map(({ key, label, path, group }) => ({ key, label, path, group })),
    presets: SCREEN_PRESETS,
  }));

  app.post('/users', { preHandler: guard('users:manage') }, async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(2, 'Informe o nome'),
        email: z.string().trim().email('E-mail inválido'),
        password,
        admin: z.boolean().default(false),
        screens: screens.default([]),
      })
      .parse(req.body);
    const email = body.email.toLowerCase();
    if (await c.repos.users.findByEmail(email)) throw new ConflictError('Já existe um usuário com este e-mail');
    if (!body.admin && body.screens.length === 0) throw new DomainError('VALIDATION', 'Marque ao menos uma tela', 422);
    const user = await c.repos.users.create({
      name: body.name,
      email,
      passwordHash: await hashPassword(body.password),
      role: body.admin ? 'ADMIN' : 'RECEPTIONIST',
      screens: body.admin ? null : body.screens,
      active: true,
    });
    await c.audit.record({
      userId: req.user!.sub, action: 'user.create', entityType: 'User', entityId: user.id,
      after: { email, admin: body.admin, screens: user.screens ?? null }, ip: req.ip,
    });
    return safeUser(user);
  });

  app.patch('/users/:id', { preHandler: guard('users:manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().trim().min(2).optional(),
        email: z.string().trim().email('E-mail inválido').optional(),
        admin: z.boolean().optional(),
        screens: screens.optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const user = await c.repos.users.findById(id);
    if (!user) throw new NotFoundError('Usuário', id);

    const wasAdmin = user.role === 'ADMIN';
    const willBeAdmin = body.admin ?? wasAdmin;
    const willBeActive = body.active ?? user.active;
    if (id === req.user!.sub && (!willBeActive || !willBeAdmin)) {
      throw new ForbiddenError('Você não pode desativar nem tirar o acesso de administrador da sua própria conta');
    }
    if (wasAdmin && user.active && (!willBeAdmin || !willBeActive)) {
      const admins = (await c.repos.users.list()).filter((u) => u.role === 'ADMIN' && u.active);
      if (admins.length <= 1) throw new ForbiddenError('É preciso manter ao menos um administrador ativo');
    }

    const patch: Partial<User> = {};
    if (body.name) patch.name = body.name;
    if (body.email && body.email.toLowerCase() !== user.email) {
      const email = body.email.toLowerCase();
      if (await c.repos.users.findByEmail(email)) throw new ConflictError('Já existe um usuário com este e-mail');
      patch.email = email;
    }
    if (body.active !== undefined) patch.active = body.active;
    if (willBeAdmin) {
      patch.role = 'ADMIN';
      patch.screens = null;
    } else {
      const next = body.screens ?? (Array.isArray(user.screens) ? user.screens : effectiveScreens(user));
      if (next.length === 0) throw new DomainError('VALIDATION', 'Marque ao menos uma tela', 422);
      patch.role = wasAdmin || user.role === 'RECEPTIONIST' ? 'RECEPTIONIST' : user.role;
      patch.screens = next;
    }
    const updated = await c.repos.users.update(id, patch);
    await c.audit.record({
      userId: req.user!.sub, action: 'user.update', entityType: 'User', entityId: id,
      before: { email: user.email, role: user.role, screens: user.screens ?? null, active: user.active },
      after: { email: updated.email, role: updated.role, screens: updated.screens ?? null, active: updated.active },
      ip: req.ip,
    });
    return safeUser(updated);
  });

  /** Administrador define uma nova senha (ex.: colaboradora esqueceu). */
  app.post('/users/:id/password', { preHandler: guard('users:manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ password }).parse(req.body);
    const user = await c.repos.users.findById(id);
    if (!user) throw new NotFoundError('Usuário', id);
    await c.repos.users.update(id, { passwordHash: await hashPassword(body.password) });
    await c.audit.record({ userId: req.user!.sub, action: 'user.password.reset', entityType: 'User', entityId: id, ip: req.ip });
    return { ok: true };
  });
}
