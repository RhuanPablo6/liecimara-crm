import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HeonImportService } from '../src/modules/imports/HeonImportService.js';
import { parseHeonPatients, phoneToWaId, prettyName, suggestProcedure, validCpf } from '../src/modules/imports/heon.js';
import { PatientsService } from '../src/modules/patients/PatientsService.js';
import { RecallService } from '../src/modules/recalls/RecallService.js';
import { buildWorld, range, seedProcedure } from './helpers.js';

const HEAD =
  'uid;field_nome;email;field_telefone_celular;field_telefone_fixo;field_cpf;field_rg;field_data_de_nascimento;field_nome_do_responsavel;field_telefone_do_responsavel;field_rg_do_responsavel;field_cpf_do_responsavel;field_cep;field_endereco;field_cidade;field_numero;field_bairro;field_estado';
const row = (uid: string, nome: string, tel: string, nasc = '', extra: Partial<{ email: string; cpf: string; cep: string; rua: string; cidade: string; uf: string }> = {}) =>
  `${uid};"${nome}";${extra.email ?? ''};"${tel}";;${extra.cpf ?? ''};;"${nasc}";;;;;${extra.cep ?? ''};"${extra.rua ?? ''}";${extra.cidade ?? ''};;;${extra.uf ?? ''}`;

const PATIENTS = [
  '﻿' + HEAD,
  ';;;;;;;;;;;;;;;;;',
  row('1', 'MARIA DE FÃ¡TIMA', '(11) 98888-1111', '1980-05-10 00:00:00', { email: 'maria.fatima.1@heon.com.br', cpf: '529.982.247-25', cep: '13.207-492', rua: 'Travessa Augusta', cidade: 'Jundiaí', uf: 'SP' }),
  row('2', 'Ana Souza', '(11) 97777-2222', '1970-01-01 00:00:00', { email: 'ana@gmail.com' }),
  row('3', 'Ana Souza', '(11) 97777-2222', '1991-02-03 00:00:00'), // cadastro duplicado
  row('4', 'Bia Souza', '(11) 97777-2222'), // filha com o número da mãe
  row('5', 'Carla Lima', '(11) 9999-3333'), // celular antigo sem o 9
  row('6', 'Débora', '(11) 96666-4444'),
].join('\r\n');

const AGENDA = [
  'data;codigo;horario;procedimento;paciente;confirmacao;anotacoes',
  '02/08/2026;3373567;10:30 as 11:00;Botox terco superior completo;MARIA DE FÃ¡TIMA;Confirmado;',
  '20/08/2026;3373567;14:30 as 15:00;Retorno;MARIA DE FÃ¡TIMA;Aguardando;tudo ok',
  '21/08/2026;3388189;18:30 as 19:30;Preenchimento Labial;Ana Souza;Cancelado;',
  '22/08/2026;3388190;09:00 as 13:15;Retorno;AGENDA FECHADA;Aguardando;',
  '10/09/2026;3388191;10:00 as 10:30;—;Fulana Desconhecida;Confirmado;',
  '30/12/2026;3388192;10:00 as 10:30;Botox;Débora;Confirmado;',
].join('\n');

describe('Importação do Heon', () => {
  it('limpa nomes, telefones, CPF e datas de preenchimento', () => {
    assert.equal(prettyName('MARIA DE FÃ¡TIMA'), 'Maria de Fátima');
    assert.equal(prettyName('Thaís Forti'), 'Thaís Forti');
    assert.equal(phoneToWaId('(11) 9999-3333').waId, '5511999993333');
    assert.equal(phoneToWaId('(11) 3333-4444').kind, 'LANDLINE');
    assert.equal(phoneToWaId('123').waId, null);
    assert.equal(validCpf('52998224725'), '529.982.247-25');
    assert.equal(validCpf('11111111111'), null);

    const p = parseHeonPatients(PATIENTS, new Date('2026-11-24T12:00:00Z'));
    assert.equal(p.total, 6);
    assert.equal(p.groups.length, 5, 'Ana duplicada vira uma só');
    assert.equal(p.sharedPhone, 1);
    const ana = p.groups.find((g) => g.primary.name === 'Ana Souza')!;
    assert.equal(ana.primary.birthDate, '1991-02-03', '1970-01-01 é descartada e a do duplicado completa');
    assert.equal(ana.primary.email, 'ana@gmail.com');
    const maria = p.groups.find((g) => g.primary.uid === '1')!.primary;
    assert.equal(maria.email, null, 'e-mail gerado pelo Heon não entra');
    assert.equal(maria.address?.cep, '13207-492');
    assert.equal(p.groups.find((g) => g.primary.name === 'Bia Souza')!.primary.waId, null);
  });

  it('sugere o procedimento do CRM e não liga consulta/retorno', () => {
    const procs = [
      { id: 'b', name: 'Botox' },
      { id: 'l', name: 'Preenchimento labial' },
      { id: 'f', name: 'Preenchimento facial' },
    ];
    assert.equal(suggestProcedure('Botox terco superior completo', procs), 'b');
    assert.equal(suggestProcedure('Preenchimento Labial', procs), 'l');
    assert.equal(suggestProcedure('Retorno', procs), null);
    assert.equal(suggestProcedure('', procs), null);
  });

  it('importa pacientes e histórico sem duplicar, fora do funil, e alimenta os retornos', async () => {
    const w = buildWorld('2026-11-24T15:00:00.000Z');
    const now = w.clock.now();
    const botox = await seedProcedure(w, 'Botox');
    await w.repos.procedures.update(botox.id, { returnDays: 120 });
    // Paciente que já falou pelo WhatsApp (número salvo sem o 9) com apelido.
    await w.repos.contacts.create({ waId: '551199993333', bsuid: null, name: null, profileName: '🌸', preExisting: true, firstSeenAt: now, lastMessageAt: now, removedFromAppAt: null });
    const svc = new HeonImportService(w.repos);
    const files = { patientsCsv: PATIENTS, agendaCsv: AGENDA };

    const pv = await svc.preview(files, now);
    assert.equal(pv.patients.people, 5);
    assert.equal(pv.patients.alreadyInCrm, 1);
    assert.equal(pv.agenda.blocks, 1);
    assert.equal(pv.agenda.future, 1);
    assert.equal(pv.agenda.toImport, 3);
    assert.deepEqual(pv.agenda.unmatched, ['Fulana Desconhecida']);
    assert.equal(pv.procedures.find((x) => x.name === 'Botox terco superior completo')?.suggestedId, botox.id);

    const r1 = await svc.importPatients(files, { offset: 0, limit: 3, includeSensitive: true }, now);
    assert.equal(r1.next, 3);
    const r2 = await svc.importPatients(files, { offset: 3, limit: 3, includeSensitive: true }, now);
    assert.equal(r2.next, null);
    assert.equal(r1.created + r2.created, 4);
    assert.equal(r1.updated + r2.updated, 1);
    const carla = await w.repos.contacts.findByWaId('551199993333');
    assert.equal(carla?.name, 'Carla Lima', 'apelido de emoji ganha o nome do cadastro');
    const maria = await w.repos.contacts.findByExternalId('heon:1');
    assert.equal(maria?.name, 'Maria de Fátima');
    assert.equal(maria?.cpf, '529.982.247-25');

    const mapping = { 'Botox terco superior completo': botox.id, Retorno: null };
    const a1 = await svc.importAgenda(files, { offset: 0, limit: 10, mapping, userId: null }, now);
    assert.equal(a1.created, 3);
    assert.equal(a1.performed, 1);
    const again = await svc.importAgenda(files, { offset: 0, limit: 10, mapping, userId: null }, now);
    assert.equal(again.created, 0, 'rodar de novo não duplica');
    await svc.importPatients(files, { offset: 0, limit: 10, includeSensitive: true }, now);
    assert.equal((await w.repos.contacts.list()).length, 5);

    // Fora do funil e dos relatórios de leads.
    assert.equal((await w.repos.leads.list({ excludeImported: true, limit: 100 })).length, 0);

    // Pacientes: todas aparecem, como "da carteira", com histórico.
    const patients = new PatientsService(w.repos);
    const list = await patients.list({ sort: 'recent', limit: 100 });
    assert.equal(list.total, 5);
    assert.ok(list.rows.every((r) => r.tag === 'WALLET'));
    const d = await patients.detail(maria!.id, now);
    assert.equal(d?.contact.birthDate, '1980-05-10');
    assert.equal(d?.summary?.attended, 2);

    // Valor de tabela no histórico: compra paga, importada, sem saldo e fora do Financeiro.
    const pp = await svc.pricesPreview();
    assert.equal(pp.ready, 1);
    assert.equal(pp.totalCents, 120000);
    const ap = await svc.applyPrices({ limit: 50, userId: null }, now);
    assert.equal(ap.created, 1);
    assert.equal((await svc.applyPrices({ limit: 50, userId: null }, now)).created, 0, 'não lança duas vezes');
    const d2 = await patients.detail(maria!.id, now);
    assert.equal(d2?.summary?.spentCents, 120000);
    assert.equal(d2?.summary?.balanceCents, 0);
    const sales = await w.repos.sales.listSoldIn({ from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') });
    assert.ok(sales.every((x) => x.imported));
    const fin = await w.metrics.summary(range('2026-08-01T00:00:00Z', '2026-12-01T00:00:00Z'));
    assert.ok(!JSON.stringify(fin).includes('120000'), 'fora do Painel');

    // Botox em 02/08 + 120 dias → retorno no começo de dezembro.
    const board = await new RecallService(w.repos).board(now, { horizonDays: 14 });
    assert.ok(JSON.stringify(board).includes(maria!.id));
  });

  it('não duplica dia que já tem agendamento feito no CRM', async () => {
    const w = buildWorld('2026-11-24T15:00:00.000Z');
    const now = w.clock.now();
    const svc = new HeonImportService(w.repos);
    const files = { patientsCsv: PATIENTS, agendaCsv: AGENDA };
    await svc.importPatients(files, { offset: 0, limit: 10, includeSensitive: false }, now);
    const maria = (await w.repos.contacts.findByExternalId('heon:1'))!;
    assert.equal(maria.cpf ?? null, null, 'sem dados sensíveis quando não pedido');
    const lead = await w.repos.leads.create({
      contactId: maria.id, stage: 'SCHEDULED', procedureInterestId: null, ownerId: null, attributionConfidence: 'UNKNOWN', adMetaId: null, adSetMetaId: null,
      campaignMetaId: null, attributionEvidenceId: null, lostReason: null, lostNote: null, openedAt: now, firstResponseAt: null, closedAt: null, lastActivityAt: now, createdAt: now,
    });
    await w.repos.appointments.create({ leadId: lead.id, procedureId: null, scheduledFor: new Date('2026-08-02T16:00:00Z'), status: 'ATTENDED', cancelReason: null, createdById: null, createdAt: now });
    const r = await svc.importAgenda(files, { offset: 0, limit: 10, mapping: {}, userId: null }, now);
    assert.equal(r.created, 2);
    assert.equal(r.skipped, 1);
  });
});
