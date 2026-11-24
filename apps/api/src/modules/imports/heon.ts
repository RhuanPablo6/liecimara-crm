// Leitura e limpeza dos arquivos exportados do Heon (sistema de agenda usado antes do CRM).
//
// - Cadastro de pacientes: CSV separado por ";" (uid;field_nome;email;field_telefone_celular;...).
// - Agenda: CSV separado por ";" (data;codigo;horario;procedimento;paciente;confirmacao;anotacoes),
//   gerado a partir da "Página de imprimir" da agenda do Heon.
//
// Tudo aqui é puro (sem banco): o serviço de importação usa estes resultados.

export interface HeonPatient {
  uid: string;
  name: string;
  /** Nome normalizado (sem acento, minúsculo) para cruzar com a agenda. */
  key: string;
  /** Número no formato do WhatsApp (55 + DDD + número) ou null se inválido. */
  waId: string | null;
  phoneKind: 'MOBILE' | 'LANDLINE' | 'INVALID';
  email: string | null;
  cpf: string | null;
  birthDate: string | null; // AAAA-MM-DD
  address: { cep: string | null; street: string | null; number: string | null; district: string | null; city: string | null; state: string | null } | null;
  nameFixed: boolean;
}

export interface HeonPatientGroup {
  /** Paciente principal (dona do número). */
  primary: HeonPatient;
  /** Cadastros duplicados da mesma pessoa (mesmo número e mesmo nome): somados à principal. */
  duplicates: HeonPatient[];
}

export interface HeonParsedPatients {
  groups: HeonPatientGroup[];
  /** Pessoas diferentes que dividem o número com outra (mãe e filha...): entram sem WhatsApp. */
  sharedPhone: number;
  discardedBirthDates: number;
  fakeEmails: number;
  invalidCpf: number;
  total: number;
}

export interface HeonAppointment {
  /** Id estável (Heon) para não importar duas vezes. */
  externalId: string;
  day: string; // AAAA-MM-DD
  time: string; // HH:MM
  durationMin: number;
  procedure: string; // nome no Heon ('' quando não informado)
  patientName: string;
  patientKey: string;
  confirmation: string;
  notes: string;
  canceled: boolean;
  /** Linha de bloqueio da agenda ("AGENDA FECHADA"). */
  block: boolean;
}

// ── utilidades ───────────────────────────────────────────────

/** CSV com ";" (ou ","), aspas e quebras de linha dentro de aspas. Remove BOM. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.slice(0, t.indexOf('\n') === -1 ? undefined : t.indexOf('\n'));
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function records(text: string): Record<string, string>[] {
  const [head, ...rest] = parseCsv(text);
  if (!head) return [];
  const cols = head.map((h) => h.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

/** "FÃ¡TIMA" → "FáTIMA" (texto UTF-8 lido como Latin-1 em algum momento). */
export function fixMojibake(s: string): string {
  if (!/[ÃÂ][\u0080-ÿ]/.test(s)) return s;
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed.includes('�') ? s : fixed;
}

export const normName = (s: string) =>
  fixMojibake(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const LOWER_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Corrige acentos e troca TUDO MAIÚSCULO por "Maria de Fátima". */
export function prettyName(raw: string): string {
  const s = fixMojibake(raw).replace(/\s+/g, ' ').trim();
  const letters = s.replace(/[^\p{L}]/gu, '');
  const lower = s.toLocaleLowerCase('pt-BR');
  // Tudo maiúsculo (ou quase: "FáTIMA" vira tudo maiúsculo depois da correção) → nome próprio.
  const upper = letters.length > 1 && letters.replace(/\p{Lu}/gu, '').length <= Math.max(1, letters.length * 0.15);
  if (!upper) return s;
  return lower
    .split(' ')
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1)))
    .join(' ');
}

/** Telefone brasileiro → número do WhatsApp. Celular antigo sem o 9 ganha o 9. */
export function phoneToWaId(raw: string): { waId: string | null; kind: HeonPatient['phoneKind'] } {
  let d = raw.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 11 && d[2] === '9') return { waId: `55${d}`, kind: 'MOBILE' };
  if (d.length === 10 && /[6-9]/.test(d[2]!)) return { waId: `55${d.slice(0, 2)}9${d.slice(2)}`, kind: 'MOBILE' };
  if (d.length === 10 && /[2-5]/.test(d[2]!)) return { waId: `55${d}`, kind: 'LANDLINE' };
  return { waId: null, kind: 'INVALID' };
}

/** Formas em que o mesmo celular pode estar salvo no WhatsApp (com e sem o 9). */
export function waIdVariants(waId: string): string[] {
  const out = [waId];
  if (/^55\d{2}9\d{8}$/.test(waId)) out.push(waId.slice(0, 4) + waId.slice(5));
  if (/^55\d{2}[6-9]\d{7}$/.test(waId)) out.push(`${waId.slice(0, 4)}9${waId.slice(4)}`);
  return out;
}

export function validCpf(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return null;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  if (dv(9) !== Number(d[9]) || dv(10) !== Number(d[10])) return null;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const clean = (s: string | undefined) => {
  const v = fixMojibake(s ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
};

// ── cadastro de pacientes ────────────────────────────────────

export function parseHeonPatients(text: string, now = new Date()): HeonParsedPatients {
  const rows = records(text).filter((r) => (r['uid'] ?? '') !== '' && (r['field_nome'] ?? '').trim() !== '' && normName(r['field_nome']!) !== 'agenda fechada');
  if (rows.length && !('field_telefone_celular' in rows[0]!))
    throw new Error('Arquivo não parece ser o cadastro de pacientes do Heon (falta a coluna field_telefone_celular)');

  // Datas "de preenchimento": aparecem muitas vezes (01/01/1970, 02/02/2000...) ou fora da faixa possível.
  const birthCount = new Map<string, number>();
  for (const r of rows) {
    const b = (r['field_data_de_nascimento'] ?? '').slice(0, 10);
    birthCount.set(b, (birthCount.get(b) ?? 0) + 1);
  }
  const maxYear = now.getUTCFullYear() - 10;
  let discardedBirthDates = 0;
  let fakeEmails = 0;
  let invalidCpf = 0;

  const patients: HeonPatient[] = rows.map((r) => {
    const rawName = r['field_nome']!;
    const name = prettyName(rawName);
    const { waId, kind } = phoneToWaId(r['field_telefone_celular'] || r['field_telefone_fixo'] || '');

    const b = (r['field_data_de_nascimento'] ?? '').slice(0, 10);
    const y = Number(b.slice(0, 4));
    const okBirth = /^\d{4}-\d{2}-\d{2}$/.test(b) && y >= 1920 && y <= maxYear && (birthCount.get(b) ?? 0) < 3 && b !== '1970-01-01';
    if (b && !okBirth) discardedBirthDates++;

    const em = (r['email'] ?? '').toLowerCase();
    const okEmail = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(em) && !em.endsWith('@heon.com.br');
    if (em && !okEmail) fakeEmails++;

    const rawCpf = r['field_cpf'] ?? '';
    const cpf = rawCpf ? validCpf(rawCpf) : null;
    if (rawCpf && !cpf) invalidCpf++;

    const cepDigits = (r['field_cep'] ?? '').replace(/\D/g, '');
    const address = {
      cep: cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : null,
      street: clean(r['field_endereco']),
      number: clean(r['field_numero']),
      district: clean(r['field_bairro']),
      city: clean(r['field_cidade']),
      state: /^[a-z]{2}$/i.test(r['field_estado'] ?? '') ? r['field_estado']!.toUpperCase() : null,
    };
    return {
      uid: r['uid']!,
      name,
      key: normName(rawName),
      waId,
      phoneKind: kind,
      email: okEmail ? em : null,
      cpf,
      birthDate: okBirth ? b : null,
      address: Object.values(address).some(Boolean) ? address : null,
      nameFixed: name !== rawName.replace(/\s+/g, ' ').trim(),
    };
  });

  // Agrupa por número: mesmo nome = cadastro duplicado (junta); nome diferente = outra pessoa (fica sem WhatsApp).
  const groups: HeonPatientGroup[] = [];
  const byPhone = new Map<string, HeonPatientGroup[]>();
  let sharedPhone = 0;
  for (const p of patients) {
    if (!p.waId) {
      groups.push({ primary: p, duplicates: [] });
      continue;
    }
    const same = byPhone.get(p.waId);
    if (!same) {
      const g = { primary: p, duplicates: [] };
      byPhone.set(p.waId, [g]);
      groups.push(g);
      continue;
    }
    const dup = same.find((g) => samePerson(g.primary.key, p.key));
    if (dup) {
      dup.duplicates.push(p);
      // Fica o nome mais completo ("Jaqueline" + "Jaqueline Rodrigues" → "Jaqueline Rodrigues").
      if (p.key.split(' ').length > dup.primary.key.split(' ').length) {
        dup.duplicates.push({ ...dup.primary }); // o nome antigo continua valendo para achar na agenda
        dup.primary = { ...dup.primary, name: p.name, key: p.key, nameFixed: p.nameFixed };
      }
    }
    else {
      sharedPhone++;
      const g = { primary: { ...p, waId: null }, duplicates: [] };
      same.push(g);
      groups.push(g);
    }
  }
  // Duplicados completam o que falta na principal.
  for (const g of groups) {
    for (const d of g.duplicates) {
      g.primary.email ??= d.email;
      g.primary.cpf ??= d.cpf;
      g.primary.birthDate ??= d.birthDate;
      g.primary.address ??= d.address;
    }
  }
  return { groups, sharedPhone, discardedBirthDates, fakeEmails, invalidCpf, total: patients.length };
}

/** Mesmo número + mesmo nome, ou um nome contido no outro com o mesmo primeiro nome. */
export function samePerson(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = a.split(' ');
  const tb = b.split(' ');
  if (ta[0] !== tb[0]) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((w) => long.includes(w));
}

// ── agenda ───────────────────────────────────────────────────

export function parseHeonAgenda(text: string): HeonAppointment[] {
  const rows = records(text);
  if (rows.length && !('paciente' in rows[0]! && 'data' in rows[0]!))
    throw new Error('Arquivo de agenda inválido (colunas esperadas: data;codigo;horario;procedimento;paciente;confirmacao;anotacoes)');
  const out: HeonAppointment[] = [];
  for (const r of rows) {
    const m = (r['data'] ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const h = (r['horario'] ?? '').match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/);
    if (!m || !h || !r['paciente']) continue;
    const day = `${m[3]}-${m[2]}-${m[1]}`;
    const time = `${h[1]!.padStart(2, '0')}:${h[2]}`;
    const dur = Number(h[3]) * 60 + Number(h[4]) - (Number(h[1]) * 60 + Number(h[2]));
    const proc = (r['procedimento'] ?? '').replace(/^[—–-]+$/, '').trim();
    const key = normName(r['paciente']);
    const conf = r['confirmacao'] ?? '';
    out.push({
      externalId: `heon:${(r['codigo'] ?? '').replace(/\D/g, '') || key.replace(/ /g, '-')}:${day}T${time}`,
      day,
      time,
      durationMin: dur > 0 && dur <= 600 ? dur : 60,
      procedure: fixMojibake(proc),
      patientName: prettyName(r['paciente']),
      patientKey: key,
      confirmation: conf,
      notes: fixMojibake(r['anotacoes'] ?? '').trim(),
      canceled: /cancel/i.test(conf),
      block: key === 'agenda fechada',
    });
  }
  return out;
}

/** Sugere o procedimento do CRM para um nome do Heon (null = não vincular, ex.: consulta/retorno). */
export function suggestProcedure(heonName: string, procedures: { id: string; name: string }[]): string | null {
  const k = normName(heonName);
  if (!k || /^(retorno|consulta|avaliacao)\b/.test(k)) return null;
  const exact = procedures.find((p) => normName(p.name) === k);
  if (exact) return exact.id;
  const STOP = new Set(['e', 'de', 'da', 'do', 'com', 'avulso', 'completo', 'full', 'face', 'terco', 'superior']);
  const words = (s: string) =>
    normName(s)
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.startsWith('labi') ? 'labi' : w));
  // "bio" ≈ "bioestimulador", "labios" ≈ "labial"
  const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
  const mine = words(heonName);
  let best: { id: string; score: number; len: number } | null = null;
  for (const p of procedures) {
    const theirs = words(p.name);
    const score = theirs.filter((w) => mine.some((m) => same(m, w))).length;
    if (score > 0 && (!best || score > best.score || (score === best.score && p.name.length < best.len)))
      best = { id: p.id, score, len: p.name.length };
  }
  return best?.id ?? null;
}
