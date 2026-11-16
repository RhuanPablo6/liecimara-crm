// Prontuário estético: anamnese, termos assinados no celular, registro de sessões (com lote) e fotos.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError, NotFoundError } from '../../domain/errors.js';
import type { ClinicalForm, ClinicalPhoto, ClinicalProduct } from '../../domain/types.js';
import type { Repos } from '../../ports/repositories.js';
import type { Clock } from '../../shared/ids.js';
import { DEFAULT_TEMPLATES, TEMPLATES_KEY, type TemplatesSettings } from '../recalls/RecallService.js';
import { ANAMNESIS_TEMPLATE, type ConsentTemplate, DEFAULT_CONSENTS, IMAGE_USE_LABELS, suggestConsentKey } from './templates.js';

export const CONSENTS_KEY = 'clinical.consentTemplates';
type Actor = { id: string; ip?: string };

const sign = (id: string, secret: string) => createHmac('sha256', `${secret}:clinical-form`).update(id).digest('base64url').slice(0, 22);
export const formToken = (id: string, secret: string) => `${id}.${sign(id, secret)}`;
export function readFormToken(token: string, secret: string): string | null {
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[\w-]{6,64}$/.test(id)) return null;
  const a = Buffer.from(sign(id, secret));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export type AnswerMap = Record<string, { a: string; detail?: string | null }>;

/** Monta a "foto" das respostas com as perguntas da época (o histórico não muda se o modelo mudar). */
export function snapshotAnamnesis(answers: AnswerMap) {
  const missing: string[] = [];
  const sections = ANAMNESIS_TEMPLATE.map((s) => ({
    title: s.title,
    items: s.items.map((q) => {
      const ans = answers[q.id];
      const a = (ans?.a ?? '').trim();
      if (q.type === 'yesno' && a !== 'Sim' && a !== 'Não') missing.push(q.q);
      return {
        id: q.id,
        q: q.q,
        type: q.type,
        a: a || null,
        detail: ans?.detail?.trim() || null,
        alert: q.type === 'yesno' && !!q.alertOnYes && a === 'Sim',
      };
    }),
  }));
  return { sections, missing };
}

export function alertsOf(form: Pick<ClinicalForm, 'content'> | null): { q: string; detail: string | null }[] {
  if (!form?.content?.sections) return [];
  return form.content.sections.flatMap((s: any) => s.items.filter((i: any) => i.alert).map((i: any) => ({ q: i.q, detail: i.detail ?? null })));
}

const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const MAX_PHOTO = 4 * 1024 * 1024;
const MAX_THUMB = 400 * 1024;

export class ClinicalService {
  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
    private readonly secret: string,
  ) {}

  private async clinic() {
    const s = (await this.repos.settings.get<TemplatesSettings>(TEMPLATES_KEY)) ?? DEFAULT_TEMPLATES;
    return { name: s.clinicName, whatsapp: s.clinicWhatsapp ?? DEFAULT_TEMPLATES.clinicWhatsapp ?? null };
  }

  async consentTemplates(): Promise<ConsentTemplate[]> {
    const saved = await this.repos.settings.get<ConsentTemplate[]>(CONSENTS_KEY);
    return saved?.length ? saved : DEFAULT_CONSENTS;
  }

  async saveConsentTemplates(list: ConsentTemplate[], actor: Actor) {
    if (!list.length) throw new DomainError('VALIDATION', 'Mantenha ao menos um modelo de termo');
    const keys = new Set<string>();
    for (const t of list) {
      if (keys.has(t.key)) throw new DomainError('VALIDATION', 'Modelos com o mesmo identificador');
      keys.add(t.key);
    }
    await this.repos.settings.set(CONSENTS_KEY, list);
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.templates', entityType: 'Setting', entityId: CONSENTS_KEY, ip: actor.ip });
    return list;
  }

  private async contact(contactId: string) {
    const c = await this.repos.contacts.findById(contactId);
    if (!c) throw new NotFoundError('Paciente', contactId);
    return c;
  }

  // ── Visão geral do prontuário da paciente ─────────────────

  async record(contactId: string, actor: Actor) {
    await this.contact(contactId);
    const [forms, sessions, photos, procedures] = await Promise.all([
      this.repos.clinical.listForms(contactId),
      this.repos.clinical.listSessions(contactId),
      this.repos.clinical.listPhotos(contactId),
      this.repos.procedures.list(),
    ]);
    const procName = new Map(procedures.map((p) => [p.id, p.name]));
    const anamneses = forms.filter((f) => f.kind === 'ANAMNESIS');
    const latestAnamnesis = anamneses.find((f) => f.status === 'SIGNED') ?? anamneses.find((f) => f.content?.sections) ?? null;
    const consents = forms.filter((f) => f.kind === 'CONSENT' && f.status === 'SIGNED');
    const imageUse = consents.find((f) => f.imageUse)?.imageUse ?? null;
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.view', entityType: 'Contact', entityId: contactId, ip: actor.ip });
    return {
      alerts: alertsOf(latestAnamnesis),
      anamnesisAt: latestAnamnesis?.signedAt ?? latestAnamnesis?.updatedAt ?? null,
      imageUse,
      imageUseLabel: imageUse ? IMAGE_USE_LABELS[imageUse] : null,
      forms: forms.map((f) => ({
        id: f.id,
        kind: f.kind,
        title: f.title,
        procedureName: f.procedureId ? (procName.get(f.procedureId) ?? null) : null,
        status: f.status,
        filled: f.kind === 'CONSENT' || !!f.content?.sections,
        signerName: f.signerName,
        signedAt: f.signedAt,
        imageUse: f.imageUse,
        createdAt: f.createdAt,
        token: formToken(f.id, this.secret),
      })),
      sessions: sessions.map((s) => ({ ...s, procedureName: s.procedureId ? (procName.get(s.procedureId) ?? null) : null })),
      photos,
    };
  }

  // ── Formulários (anamnese / termo) ────────────────────────

  async createForm(
    contactId: string,
    input: { kind: 'ANAMNESIS' } | { kind: 'CONSENT'; templateKey?: string | null; procedureId?: string | null },
    actor: Actor,
  ) {
    const contact = await this.contact(contactId);
    const clinic = await this.clinic();
    let form: ClinicalForm;
    if (input.kind === 'ANAMNESIS') {
      form = await this.repos.clinical.createForm(this.blank(contactId, 'ANAMNESIS', 'Ficha de anamnese', null, {}, actor));
    } else {
      const proc = input.procedureId ? await this.repos.procedures.findById(input.procedureId) : null;
      if (input.procedureId && !proc) throw new NotFoundError('Procedimento', input.procedureId);
      const templates = await this.consentTemplates();
      const key = input.templateKey ?? suggestConsentKey(proc?.name);
      const t = templates.find((x) => x.key === key) ?? templates[0]!;
      const name = contact.name ?? contact.profileName ?? '';
      const text = t.text
        .replaceAll('{paciente}', name || '____________________')
        .replaceAll('{procedimento}', proc?.name ?? t.title.replace(/^Termo de consentimento – /, ''))
        .replaceAll('{clinica}', clinic.name)
        .replaceAll('{data}', this.clock.now().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
      form = await this.repos.clinical.createForm(this.blank(contactId, 'CONSENT', t.title, proc?.id ?? null, { text, templateKey: t.key }, actor));
    }
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.form.create', entityType: 'ClinicalForm', entityId: form.id, after: { kind: form.kind, title: form.title }, ip: actor.ip });
    return { ...form, token: formToken(form.id, this.secret) };
  }

  private blank(contactId: string, kind: ClinicalForm['kind'], title: string, procedureId: string | null, content: unknown, actor: Actor) {
    return {
      contactId,
      kind,
      title,
      procedureId,
      content,
      status: 'PENDING' as const,
      imageUse: null,
      signerName: null,
      signerDocument: null,
      signature: null,
      signedAt: null,
      signedIp: null,
      signedUserAgent: null,
      contentHash: null,
      createdById: actor.id,
    };
  }

  async getForm(id: string) {
    const f = await this.repos.clinical.findForm(id);
    if (!f) throw new NotFoundError('Documento', id);
    return f;
  }

  /** Equipe preenche a anamnese na consulta (a paciente assina depois, no celular). */
  async fillAnamnesis(id: string, answers: AnswerMap, actor: Actor) {
    const f = await this.getForm(id);
    if (f.kind !== 'ANAMNESIS') throw new DomainError('VALIDATION', 'Este documento não é uma anamnese');
    if (f.status === 'SIGNED') throw new DomainError('FORM_SIGNED', 'Anamnese já assinada. Crie uma nova para atualizar.');
    const { sections } = snapshotAnamnesis(answers);
    const updated = await this.repos.clinical.updateForm(id, { content: { sections } });
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.anamnesis.fill', entityType: 'ClinicalForm', entityId: id, ip: actor.ip });
    return updated;
  }

  async deleteForm(id: string, actor: Actor, opts: { allowSigned: boolean }) {
    const f = await this.getForm(id);
    if (f.status === 'SIGNED' && !opts.allowSigned) {
      throw new DomainError('FORM_SIGNED', 'Documento assinado não pode ser excluído (só o administrador, digitando APAGAR).', 403);
    }
    await this.repos.clinical.deleteForm(id);
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.form.delete', entityType: 'ClinicalForm', entityId: id, before: { ...f, signature: f.signature ? '[assinatura]' : null }, ip: actor.ip });
  }

  // ── Link da paciente (sem login) ──────────────────────────

  async publicView(token: string) {
    const id = readFormToken(token, this.secret);
    if (!id) throw new DomainError('NOT_FOUND', 'Link inválido', 404);
    const f = await this.repos.clinical.findForm(id);
    if (!f) throw new DomainError('NOT_FOUND', 'Documento não encontrado', 404);
    const contact = await this.repos.contacts.findById(f.contactId);
    const name = contact?.name ?? contact?.profileName ?? '';
    return {
      kind: f.kind,
      title: f.title,
      status: f.status,
      clinic: await this.clinic(),
      firstName: name.trim().split(/\s+/)[0] || null,
      suggestedName: f.status === 'PENDING' ? name || null : null,
      text: f.kind === 'CONSENT' ? f.content.text : null,
      template: f.kind === 'ANAMNESIS' && f.status === 'PENDING' ? ANAMNESIS_TEMPLATE : null,
      /** Respostas já preenchidas pela equipe (a paciente confere e assina). */
      prefilled: f.kind === 'ANAMNESIS' && f.status === 'PENDING' && f.content?.sections ? answersFrom(f.content.sections) : null,
      sections: f.kind === 'ANAMNESIS' && f.status === 'SIGNED' ? f.content.sections : null,
      imageUseOptions: f.kind === 'CONSENT' ? IMAGE_USE_LABELS : null,
      signedAt: f.signedAt,
      signerName: f.status === 'SIGNED' ? f.signerName : null,
      imageUse: f.imageUse,
      contentHash: f.contentHash,
    };
  }

  async publicSign(
    token: string,
    input: { signerName: string; signerDocument?: string | null; signature: string; imageUse?: 'NONE' | 'INTERNAL' | 'MARKETING' | null; answers?: AnswerMap | null; accept: boolean },
    meta: { ip: string | null; userAgent: string | null },
  ) {
    const id = readFormToken(token, this.secret);
    if (!id) throw new DomainError('NOT_FOUND', 'Link inválido', 404);
    const f = await this.repos.clinical.findForm(id);
    if (!f) throw new DomainError('NOT_FOUND', 'Documento não encontrado', 404);
    if (f.status === 'SIGNED') throw new DomainError('FORM_SIGNED', 'Este documento já foi assinado.', 409);
    if (!input.accept) throw new DomainError('VALIDATION', 'Marque que leu e concorda para assinar');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.signature) || input.signature.length < 1500) {
      throw new DomainError('VALIDATION', 'Faça a assinatura no quadro antes de enviar');
    }
    if (input.signature.length > 400_000) throw new DomainError('VALIDATION', 'Assinatura muito grande. Limpe e assine de novo.');
    const signerName = input.signerName.trim();
    if (signerName.split(/\s+/).length < 2) throw new DomainError('VALIDATION', 'Informe seu nome completo');

    let content = f.content;
    if (f.kind === 'ANAMNESIS') {
      const { sections, missing } = snapshotAnamnesis(input.answers ?? {});
      if (missing.length) throw new DomainError('VALIDATION', `Responda todas as perguntas de Sim/Não (faltam ${missing.length}).`);
      content = { sections };
    } else if (!input.imageUse) {
      throw new DomainError('VALIDATION', 'Escolha uma opção sobre o uso das suas fotos');
    }
    const signedAt = this.clock.now();
    const signerDocument = input.signerDocument?.replace(/[^\dXx]/g, '') || null;
    const imageUse = f.kind === 'CONSENT' ? (input.imageUse ?? 'NONE') : null;
    const contentHash = hashOf({ id: f.id, title: f.title, content, signerName, signerDocument, imageUse, signedAt: signedAt.toISOString() });
    const updated = await this.repos.clinical.updateForm(f.id, {
      content,
      status: 'SIGNED',
      imageUse,
      signerName,
      signerDocument,
      signature: input.signature,
      signedAt,
      signedIp: meta.ip,
      signedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
      contentHash,
    });
    await this.repos.audit.log({ userId: null, action: 'clinical.form.sign', entityType: 'ClinicalForm', entityId: f.id, after: { signerName, contentHash }, ip: meta.ip ?? undefined });
    return updated;
  }

  // ── Sessões ───────────────────────────────────────────────

  async saveSession(
    contactId: string,
    input: { id?: string | null; procedureId?: string | null; performedAt: Date; products: ClinicalProduct[]; areas?: string | null; notes?: string | null },
    actor: Actor,
  ) {
    await this.contact(contactId);
    if (input.procedureId && !(await this.repos.procedures.findById(input.procedureId))) throw new NotFoundError('Procedimento', input.procedureId);
    const data = {
      contactId,
      procedureId: input.procedureId ?? null,
      performedAt: input.performedAt,
      products: input.products.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), lot: p.lot?.trim() || null, quantity: p.quantity ?? null, unit: p.unit?.trim() || null })),
      areas: input.areas?.trim() || null,
      notes: input.notes?.trim() || null,
    };
    let s;
    if (input.id) {
      const prev = await this.repos.clinical.findSession(input.id);
      if (!prev || prev.contactId !== contactId) throw new NotFoundError('Sessão', input.id);
      s = await this.repos.clinical.updateSession(input.id, data);
    } else {
      s = await this.repos.clinical.createSession({ ...data, createdById: actor.id });
    }
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.session.save', entityType: 'ClinicalSession', entityId: s.id, after: s, ip: actor.ip });
    return s;
  }

  async deleteSession(id: string, actor: Actor) {
    const s = await this.repos.clinical.findSession(id);
    if (!s) throw new NotFoundError('Sessão', id);
    await this.repos.clinical.deleteSession(id);
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.session.delete', entityType: 'ClinicalSession', entityId: id, before: s, ip: actor.ip });
  }

  // ── Fotos ─────────────────────────────────────────────────

  async addPhoto(
    contactId: string,
    input: {
      data: string;
      thumb: string;
      mime: string;
      width: number;
      height: number;
      stage: ClinicalPhoto['stage'];
      angle?: string | null;
      caption?: string | null;
      sessionId?: string | null;
      takenAt?: Date | null;
    },
    actor: Actor,
  ) {
    await this.contact(contactId);
    if (!/^image\/(jpeg|png|webp)$/.test(input.mime)) throw new DomainError('VALIDATION', 'Formato de imagem não suportado');
    const data = Buffer.from(input.data, 'base64');
    const thumb = Buffer.from(input.thumb, 'base64');
    if (!data.length || data.length > MAX_PHOTO) throw new DomainError('VALIDATION', 'Foto vazia ou grande demais (máx. 4 MB após compressão)');
    if (!thumb.length || thumb.length > MAX_THUMB) throw new DomainError('VALIDATION', 'Miniatura inválida');
    if (input.sessionId) {
      const s = await this.repos.clinical.findSession(input.sessionId);
      if (!s || s.contactId !== contactId) throw new NotFoundError('Sessão', input.sessionId);
    }
    const p = await this.repos.clinical.createPhoto({
      contactId,
      sessionId: input.sessionId ?? null,
      takenAt: input.takenAt ?? this.clock.now(),
      stage: input.stage,
      angle: input.angle?.trim() || null,
      caption: input.caption?.trim() || null,
      mime: input.mime,
      width: Math.round(input.width),
      height: Math.round(input.height),
      sizeBytes: data.length,
      createdById: actor.id,
      data,
      thumb,
    });
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.photo.add', entityType: 'ClinicalPhoto', entityId: p.id, after: { contactId, stage: p.stage, sizeBytes: p.sizeBytes }, ip: actor.ip });
    return p;
  }

  async updatePhoto(id: string, input: Partial<Pick<ClinicalPhoto, 'sessionId' | 'stage' | 'angle' | 'caption' | 'takenAt'>>, actor: Actor) {
    const p = await this.repos.clinical.findPhoto(id);
    if (!p) throw new NotFoundError('Foto', id);
    if (input.sessionId) {
      const s = await this.repos.clinical.findSession(input.sessionId);
      if (!s || s.contactId !== p.contactId) throw new NotFoundError('Sessão', input.sessionId);
    }
    const u = await this.repos.clinical.updatePhoto(id, input);
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.photo.update', entityType: 'ClinicalPhoto', entityId: id, after: input, ip: actor.ip });
    return u;
  }

  async deletePhoto(id: string, actor: Actor) {
    const p = await this.repos.clinical.findPhoto(id);
    if (!p) throw new NotFoundError('Foto', id);
    await this.repos.clinical.deletePhoto(id);
    await this.repos.audit.log({ userId: actor.id, action: 'clinical.photo.delete', entityType: 'ClinicalPhoto', entityId: id, before: p, ip: actor.ip });
  }

  async photoBytes(id: string, variant: 'full' | 'thumb') {
    const b = await this.repos.clinical.photoBytes(id, variant);
    if (!b) throw new NotFoundError('Foto', id);
    return b;
  }

  async storage() {
    return { photoBytes: await this.repos.clinical.photoStorageBytes() };
  }
}

function answersFrom(sections: any[]): AnswerMap {
  const out: AnswerMap = {};
  for (const s of sections) for (const i of s.items) if (i.a != null) out[i.id] = { a: i.a, detail: i.detail ?? null };
  return out;
}
