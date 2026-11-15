import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { UnauthorizedError } from '../../domain/errors.js';
import type { Role, User } from '../../domain/types.js';
import type { UserRepo } from '../../ports/repositories.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// ── Senhas (scrypt) ──────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

// ── JWT HS256 (sem dependências externas) ────────────────────

export interface TokenClaims {
  sub: string;
  role: Role;
  name: string;
  iat: number;
  exp: number;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signToken(claims: Omit<TokenClaims, 'iat' | 'exp'>, secret: string, ttlSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorizedError('Token inválido');
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new UnauthorizedError('Assinatura do token inválida');
  }
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenClaims;
  if (claims.exp * 1000 < now) throw new UnauthorizedError('Sessão expirada');
  return claims;
}

export class AuthService {
  constructor(
    private readonly users: UserRepo,
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {
    if (secret.length < 32) throw new Error('JWT_SECRET deve ter ao menos 32 caracteres');
  }

  async login(email: string, password: string): Promise<{ token: string; user: Omit<User, 'passwordHash'> }> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    // Mesma mensagem para usuário inexistente e senha errada.
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedError('E-mail ou senha inválidos');
    }
    const token = signToken({ sub: user.id, role: user.role, name: user.name }, this.secret, this.ttlSeconds);
    const { passwordHash: _omit, ...safe } = user;
    return { token, user: safe };
  }

  authenticate(token: string): TokenClaims {
    return verifyToken(token, this.secret);
  }
}
