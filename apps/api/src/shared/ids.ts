import { randomBytes } from 'node:crypto';

/** ID ordenável por tempo (compatível com colunas String @id do Prisma). */
export function newId(prefix = ''): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rnd = randomBytes(8).toString('hex');
  return `${prefix}${ts}${rnd}`;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(d: Date | string): void {
    this.current = new Date(d);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const minDate = (a: Date | null, b: Date): Date => (!a || b < a ? b : a);
export const maxDate = (a: Date | null, b: Date): Date => (!a || b > a ? b : a);

export const DAY_MS = 24 * 60 * 60 * 1000;
