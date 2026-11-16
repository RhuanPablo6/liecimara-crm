// Agenda fechada: bloqueios que encostam no período consultado.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryRepos } from '../src/infra/memory/MemoryRepos.js';

const at = (s: string) => new Date(s);

describe('agenda fechada', () => {
  it('lista só os bloqueios que cruzam o intervalo', async () => {
    const r = new MemoryRepos();
    const ferias = await r.agendaBlocks.create({ startAt: at('2026-12-20T03:00:00Z'), endAt: at('2026-12-31T03:00:00Z'), allDay: true, reason: 'Férias', note: null, createdById: null });
    await r.agendaBlocks.create({ startAt: at('2026-11-18T16:00:00Z'), endAt: at('2026-11-18T20:00:00Z'), allDay: false, reason: 'Consulta médica', note: null, createdById: null });

    // Horário dentro das férias
    assert.deepEqual((await r.agendaBlocks.listBetween(at('2026-12-22T13:00:00Z'), at('2026-12-22T14:00:00Z'))).map((b) => b.id), [ferias.id]);
    // Termina exatamente quando o bloqueio começa: livre
    assert.equal((await r.agendaBlocks.listBetween(at('2026-11-18T15:00:00Z'), at('2026-11-18T16:00:00Z'))).length, 0);
    // Começa exatamente quando o bloqueio termina: livre
    assert.equal((await r.agendaBlocks.listBetween(at('2026-11-18T20:00:00Z'), at('2026-11-18T21:00:00Z'))).length, 0);
    // Encosta 15 minutos: bloqueado
    assert.equal((await r.agendaBlocks.listBetween(at('2026-11-18T15:30:00Z'), at('2026-11-18T16:15:00Z'))).length, 1);

    await r.agendaBlocks.delete(ferias.id);
    assert.equal((await r.agendaBlocks.listBetween(at('2026-12-22T13:00:00Z'), at('2026-12-22T14:00:00Z'))).length, 0);
  });
});
