'use client';

// Prontuário estético da paciente: documentos (anamnese e termos), sessões (com lote) e fotos de antes/depois.
import {
  AlertTriangle,
  Camera,
  Check,
  ClipboardList,
  Columns2,
  Copy,
  ExternalLink,
  FilePlus2,
  FileSignature,
  ImagePlus,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '@/components/access';
import { ConfirmButton } from '@/components/confirm-button';
import { PurgeButton } from '@/components/purge-dialog';
import { AnamnesisForm, type Answers } from '@/components/clinical/anamnesis-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { date, dateTime } from '@/lib/format';
import { preparePhoto } from '@/lib/image';
import { cn } from '@/lib/utils';

const STAGES: Record<string, { label: string; cls: string }> = {
  BEFORE: { label: 'Antes', cls: 'bg-slate-800 text-white' },
  AFTER: { label: 'Depois', cls: 'bg-gold-400 text-navy-900' },
  FOLLOWUP: { label: 'Retorno', cls: 'bg-sky-600 text-white' },
};
const ANGLES = ['Frontal', 'Perfil direito', 'Perfil esquerdo', 'Oblíquo direito', 'Oblíquo esquerdo', 'Detalhe'];
const IMAGE_USE: Record<string, { label: string; cls: string }> = {
  MARKETING: { label: 'Divulgação autorizada', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  INTERNAL: { label: 'Só uso clínico (sem divulgar)', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  NONE: { label: 'Fotos não autorizadas fora do prontuário', cls: 'bg-red-50 text-red-800 border-red-200' },
};
const photoUrl = (id: string, v: 'thumb' | 'full' = 'thumb') => `/api/proxy/clinical/photos/${id}?v=${v}`;
const spLocal = (d = new Date()) => {
  const x = new Date(d.getTime() - 3 * 3600_000);
  return x.toISOString().slice(0, 16);
};
const fromLocal = (v: string) => new Date(`${v}:00-03:00`).toISOString();
const linkOf = (token: string) => (typeof window === 'undefined' ? '' : `${window.location.origin}/f/${token}`);

function waLink(waId: string | null, firstName: string, title: string, token: string, clinic: string) {
  if (!waId) return null;
  const text = `Olá${firstName ? `, ${firstName}` : ''}! Aqui é da ${clinic}. Para seguirmos com o seu atendimento, por favor preencha e assine: ${title}.\n\n${linkOf(token)}`;
  return `https://wa.me/${waId}?text=${encodeURIComponent(text)}`;
}

// ── Documentos ───────────────────────────────────────────

function ShareLinks({ form, patient, clinic }: { form: any; patient: { name: string | null; waId: string | null }; clinic: string }) {
  const [copied, setCopied] = useState(false);
  const first = (patient.name ?? '').trim().split(/\s+/)[0] ?? '';
  const wa = waLink(patient.waId, first, form.title, form.token, clinic);
  return (
    <div className="flex flex-wrap gap-1.5">
      {wa && (
        <Button size="sm" variant="outline" asChild>
          <a href={wa} target="_blank" rel="noreferrer">
            <MessageCircle /> Enviar no WhatsApp
          </a>
        </Button>
      )}
      <Button size="sm" variant="outline" asChild>
        <a href={`/f/${form.token}`} target="_blank" rel="noreferrer" title="Para a paciente assinar neste aparelho (tablet ou celular da clínica)">
          <ExternalLink /> Assinar aqui
        </a>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(linkOf(form.token));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {}
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? 'Copiado' : 'Copiar link'}
      </Button>
    </div>
  );
}

function NewConsentDialog({ open, onOpenChange, contactId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; contactId: string; onCreated: () => void }) {
  const { data: procedures } = useApi<any[]>(open ? '/procedures' : null);
  const { data: templates } = useApi<any[]>(open ? '/clinical/templates' : null);
  const [procedureId, setProcedureId] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (open) {
      setProcedureId('');
      setTemplateKey('');
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo termo de consentimento</DialogTitle>
          <DialogDescription>O texto sai com o nome da paciente e do procedimento. Depois é só enviar o link para ela assinar no celular.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Procedimento">
            <NativeSelect value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
              <option value="">Escolha…</option>
              {(procedures ?? [])
                .filter((p) => p.active !== false)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Modelo do termo">
            <NativeSelect value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              <option value="">Automático pelo procedimento</option>
              {(templates ?? []).map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              disabled={busy || (!procedureId && !templateKey)}
              onClick={async () => {
                const ok = await run(() =>
                  api(`/patients/${contactId}/clinical/forms`, { method: 'POST', body: { kind: 'CONSENT', procedureId: procedureId || null, templateKey: templateKey || null } }),
                );
                if (ok) {
                  onOpenChange(false);
                  onCreated();
                }
              }}
            >
              Criar termo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FillAnamnesisDialog({ formId, onClose, onSaved }: { formId: string | null; onClose: () => void; onSaved: () => void }) {
  const { data: template } = useApi<any[]>(formId ? '/clinical/anamnesis-template' : null);
  const { data: form } = useApi<any>(formId ? `/clinical/forms/${formId}` : null);
  const [answers, setAnswers] = useState<Answers>({});
  const { busy, error, run } = useAction();
  useEffect(() => {
    const out: Answers = {};
    for (const s of form?.content?.sections ?? []) for (const i of s.items) if (i.a != null) out[i.id] = { a: i.a, detail: i.detail };
    setAnswers(out);
  }, [form]);
  return (
    <Dialog open={!!formId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preencher anamnese na consulta</DialogTitle>
          <DialogDescription>Depois de salvar, a paciente confere e assina pelo link (as respostas já aparecem preenchidas para ela).</DialogDescription>
        </DialogHeader>
        {template ? <AnamnesisForm template={template} answers={answers} onChange={setAnswers} showAlerts /> : <p className="text-sm text-muted-foreground">Carregando…</p>}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (await run(() => api(`/clinical/forms/${formId}/answers`, { method: 'PUT', body: answers }))) {
                onClose();
                onSaved();
              }
            }}
          >
            Salvar respostas
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Documents({ data, contactId, patient, clinic, canWrite, reload }: { data: any; contactId: string; patient: any; clinic: string; canWrite: boolean; reload: () => void }) {
  const [consent, setConsent] = useState(false);
  const [fill, setFill] = useState<string | null>(null);
  const create = useAction();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Anamnese e termos</CardTitle>
          <CardDescription>Envie o link: a paciente responde e assina com o dedo no celular. O documento assinado não pode ser alterado.</CardDescription>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={create.busy}
              onClick={async () => {
                if (await create.run(() => api(`/patients/${contactId}/clinical/forms`, { method: 'POST', body: { kind: 'ANAMNESIS' } }))) reload();
              }}
            >
              <ClipboardList /> Nova anamnese
            </Button>
            <Button variant="gold" size="sm" onClick={() => setConsent(true)}>
              <FileSignature /> Novo termo
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorText>{create.error}</ErrorText>
        {data.forms.length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento ainda. Comece pela anamnese.</p>}
        {data.forms.map((f: any) => (
          <div key={f.id} className={cn('rounded-lg border p-3', f.status === 'PENDING' && 'border-amber-200 bg-amber-50/40')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {f.title}
                  {f.procedureName && <span className="font-normal text-muted-foreground"> · {f.procedureName}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.status === 'SIGNED' ? (
                    <span className="text-emerald-700">
                      ✔ Assinado por {f.signerName} em {dateTime(f.signedAt)}
                    </span>
                  ) : (
                    <span className="text-amber-800">
                      Aguardando assinatura{f.kind === 'ANAMNESIS' && !f.filled ? ' · ainda sem respostas' : f.kind === 'ANAMNESIS' ? ' · respostas preenchidas na consulta' : ''}
                    </span>
                  )}{' '}
                  · criado em {date(f.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {f.status === 'SIGNED' || f.filled ? (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/prontuario/documento/${f.id}`}>
                      <Printer /> Ver / imprimir
                    </Link>
                  </Button>
                ) : null}
                {canWrite && f.status === 'PENDING' && f.kind === 'ANAMNESIS' && (
                  <Button size="sm" variant="ghost" onClick={() => setFill(f.id)}>
                    <Pencil /> Preencher na consulta
                  </Button>
                )}
                {canWrite && f.status === 'PENDING' && (
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    confirmLabel="Excluir?"
                    onConfirm={async () => {
                      await api(`/clinical/forms/${f.id}`, { method: 'DELETE', body: {} }).catch(() => null);
                      reload();
                    }}
                  >
                    <Trash2 />
                  </ConfirmButton>
                )}
                {f.status === 'SIGNED' && (
                  <PurgeButton
                    endpoint={`/clinical/forms/${f.id}/purge`}
                    title="Apagar documento assinado"
                    description={<p>“{f.title}”, assinado por {f.signerName}, será apagado de vez do prontuário. Use só se foi criado por engano.</p>}
                    onDone={reload}
                  />
                )}
              </div>
            </div>
            {f.status === 'PENDING' && canWrite && (
              <div className="mt-2">
                <ShareLinks form={f} patient={patient} clinic={clinic} />
              </div>
            )}
          </div>
        ))}
      </CardContent>
      <NewConsentDialog open={consent} onOpenChange={setConsent} contactId={contactId} onCreated={reload} />
      <FillAnamnesisDialog formId={fill} onClose={() => setFill(null)} onSaved={reload} />
    </Card>
  );
}

// ── Sessões ──────────────────────────────────────────────

type ProductRow = { name: string; lot: string; quantity: string; unit: string };

function SessionDialog({
  open,
  onOpenChange,
  contactId,
  session,
  productNames,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  session: any | null;
  productNames: string[];
  onSaved: () => void;
}) {
  const { data: procedures } = useApi<any[]>(open ? '/procedures' : null);
  const [when, setWhen] = useState(spLocal());
  const [procedureId, setProcedureId] = useState('');
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [areas, setAreas] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run, setError } = useAction();
  useEffect(() => {
    if (!open) return;
    setError(null);
    setWhen(session ? spLocal(new Date(session.performedAt)) : spLocal());
    setProcedureId(session?.procedureId ?? '');
    setProducts(
      session?.products?.map((p: any) => ({ name: p.name, lot: p.lot ?? '', quantity: p.quantity != null ? String(p.quantity).replace('.', ',') : '', unit: p.unit ?? '' })) ?? [
        { name: '', lot: '', quantity: '', unit: '' },
      ],
    );
    setAreas(session?.areas ?? '');
    setNotes(session?.notes ?? '');
  }, [open, session, setError]);
  const setP = (i: number, patch: Partial<ProductRow>) => setProducts((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{session ? 'Editar sessão' : 'Registrar sessão'}</DialogTitle>
          <DialogDescription>Produto, lote e quantidade de cada aplicação: é o que protege a clínica se houver qualquer intercorrência.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data e hora">
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Field label="Procedimento">
              <NativeSelect value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
                <option value="">—</option>
                {(procedures ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Produtos aplicados</p>
            <datalist id="clinical-products">
              {productNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {products.map((p, i) => (
              <div key={i} className="grid grid-cols-[1.6fr_1fr_70px_70px_auto] items-end gap-2">
                <Field label={i === 0 ? 'Produto / marca' : ''}>
                  <Input value={p.name} list="clinical-products" onChange={(e) => setP(i, { name: e.target.value })} placeholder="Ex.: Botox Allergan 100 U" />
                </Field>
                <Field label={i === 0 ? 'Lote' : ''}>
                  <Input value={p.lot} onChange={(e) => setP(i, { lot: e.target.value })} placeholder="Lote" />
                </Field>
                <Field label={i === 0 ? 'Qtd' : ''}>
                  <Input value={p.quantity} inputMode="decimal" onChange={(e) => setP(i, { quantity: e.target.value })} />
                </Field>
                <Field label={i === 0 ? 'Unid.' : ''}>
                  <Input value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} placeholder="U, ml" list="clinical-units" />
                </Field>
                <Button variant="ghost" size="icon" onClick={() => setProducts((xs) => xs.filter((_, j) => j !== i))} title="Remover">
                  <Trash2 />
                </Button>
              </div>
            ))}
            <datalist id="clinical-units">
              {['U', 'ml', 'seringa', 'fio', 'disparos', 'frasco'].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <Button variant="outline" size="sm" onClick={() => setProducts((xs) => [...xs, { name: '', lot: '', quantity: '', unit: '' }])}>
              <Plus /> Adicionar produto
            </Button>
          </div>
          <Field label="Áreas tratadas / pontos">
            <Input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="Ex.: glabela 20 U, frontal 10 U, periorbicular 12 U" maxLength={500} />
          </Field>
          <Field label="Evolução e observações">
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Como foi a sessão, reações, orientações dadas, plano para o retorno…" maxLength={5000} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              disabled={busy || !when}
              onClick={async () => {
                const body = {
                  performedAt: fromLocal(when),
                  procedureId: procedureId || null,
                  products: products
                    .filter((p) => p.name.trim())
                    .map((p) => ({
                      name: p.name,
                      lot: p.lot || null,
                      quantity: p.quantity.trim() ? Number(p.quantity.replace(',', '.')) || null : null,
                      unit: p.unit || null,
                    })),
                  areas: areas || null,
                  notes: notes || null,
                };
                const ok = await run(() =>
                  session
                    ? api(`/patients/${contactId}/clinical/sessions/${session.id}`, { method: 'PUT', body })
                    : api(`/patients/${contactId}/clinical/sessions`, { method: 'POST', body }),
                );
                if (ok) {
                  onOpenChange(false);
                  onSaved();
                }
              }}
            >
              Salvar sessão
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({ p, onClick, selected }: { p: any; onClick: () => void; selected?: boolean }) {
  const st = STAGES[p.stage] ?? STAGES.BEFORE!;
  return (
    <button type="button" onClick={onClick} className={cn('group relative overflow-hidden rounded-lg border bg-slate-100', selected && 'ring-2 ring-gold-400 ring-offset-2')}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl(p.id)} alt={`${st.label} ${p.angle ?? ''}`} loading="lazy" className="aspect-[3/4] w-full object-cover transition-transform group-hover:scale-[1.03]" />
      <span className={cn('absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', st.cls)}>{st.label}</span>
      {p.angle && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-left text-[11px] text-white">{p.angle}</span>}
    </button>
  );
}

function Sessions({ data, contactId, canWrite, reload, openPhoto }: { data: any; contactId: string; canWrite: boolean; reload: () => void; openPhoto: (p: any) => void }) {
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const productNames = useMemo(() => [...new Set(data.sessions.flatMap((s: any) => s.products.map((p: any) => p.name)))] as string[], [data.sessions]);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Sessões e evolução</CardTitle>
          <CardDescription>O que foi feito em cada atendimento, com produto e lote.</CardDescription>
        </div>
        {canWrite && (
          <Button
            size="sm"
            variant="gold"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> Registrar sessão
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {data.sessions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma sessão registrada.</p>}
        {data.sessions.map((s: any) => {
          const photos = data.photos.filter((p: any) => p.sessionId === s.id);
          return (
            <div key={s.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{s.procedureName ?? 'Sessão'}</p>
                  <p className="text-xs text-muted-foreground">{dateTime(s.performedAt)}</p>
                </div>
                {canWrite && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(s);
                        setOpen(true);
                      }}
                    >
                      <Pencil /> Editar
                    </Button>
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      confirmLabel="Excluir sessão?"
                      onConfirm={async () => {
                        await api(`/clinical/sessions/${s.id}`, { method: 'DELETE' }).catch(() => null);
                        reload();
                      }}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  </div>
                )}
              </div>
              {s.products.length > 0 && (
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 font-medium">Produto</th>
                      <th className="py-1 font-medium">Lote</th>
                      <th className="py-1 text-right font-medium">Qtd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.products.map((p: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1">{p.name}</td>
                        <td className={cn('py-1 font-mono text-xs', !p.lot && 'text-amber-700')}>{p.lot ?? 'sem lote'}</td>
                        <td className="py-1 text-right tabular-nums">{p.quantity != null ? `${String(p.quantity).replace('.', ',')} ${p.unit ?? ''}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {s.areas && (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Áreas: </span>
                  {s.areas}
                </p>
              )}
              {s.notes && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{s.notes}</p>}
              {photos.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {photos.map((p: any) => (
                    <Thumb key={p.id} p={p} onClick={() => openPhoto(p)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
      <SessionDialog open={open} onOpenChange={setOpen} contactId={contactId} session={editing} productNames={productNames} onSaved={reload} />
    </Card>
  );
}

// ── Fotos ────────────────────────────────────────────────

function UploadDialog({ open, onOpenChange, contactId, sessions, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; contactId: string; sessions: any[]; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState('BEFORE');
  const [angle, setAngle] = useState('Frontal');
  const [sessionId, setSessionId] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setError(null);
    setProgress(null);
    const today = new Date().toDateString();
    const s = sessions.find((x) => new Date(x.performedAt).toDateString() === today);
    setSessionId(s?.id ?? '');
  }, [open, sessions]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const [i, f] of files.entries()) {
        setProgress(`Enviando ${i + 1} de ${files.length}…`);
        const img = await preparePhoto(f);
        await api(`/patients/${contactId}/clinical/photos`, {
          method: 'POST',
          body: {
            data: img.data,
            thumb: img.thumb,
            mime: img.mime,
            width: img.width,
            height: img.height,
            stage,
            angle: files.length === 1 ? angle : angle,
            sessionId: sessionId || null,
            takenAt: f.lastModified && Date.now() - f.lastModified < 1000 * 86400 * 365 * 5 ? new Date(f.lastModified).toISOString() : null,
          },
        });
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar fotos</DialogTitle>
          <DialogDescription>Tire na hora ou escolha da galeria. As fotos são reduzidas no aparelho e ficam guardadas só no prontuário.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFiles((xs) => [...xs, ...Array.from(e.target.files ?? [])])} />
            <input ref={pick} type="file" accept="image/*" multiple className="hidden" onChange={(e) => setFiles((xs) => [...xs, ...Array.from(e.target.files ?? [])])} />
            <Button variant="outline" onClick={() => cam.current?.click()}>
              <Camera /> Tirar foto
            </Button>
            <Button variant="outline" onClick={() => pick.current?.click()}>
              <ImagePlus /> Escolher da galeria
            </Button>
          </div>
          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {previews.map((u, i) => (
                <div key={u} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="aspect-[3/4] w-full rounded-md object-cover" />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                    onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}
                    aria-label="Remover"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Momento">
              <NativeSelect value={stage} onChange={(e) => setStage(e.target.value)}>
                {Object.entries(STAGES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Ângulo">
              <NativeSelect value={angle} onChange={(e) => setAngle(e.target.value)}>
                {ANGLES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Sessão">
              <NativeSelect value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                <option value="">Sem sessão</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {date(s.performedAt)} · {s.procedureName ?? 'Sessão'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {files.length > 1 && <p className="text-xs text-muted-foreground">Todas as fotos selecionadas recebem o mesmo momento e ângulo. Dá para ajustar uma a uma depois.</p>}
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex items-center justify-end gap-2">
            {progress && <span className="mr-auto text-sm text-muted-foreground">{progress}</span>}
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button disabled={busy || !files.length} onClick={send}>
              Enviar {files.length || ''} foto{files.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PhotoViewer({ photo, sessions, canWrite, onClose, onChanged }: { photo: any | null; sessions: any[]; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const { run, error } = useAction();
  if (!photo) return null;
  const patch = async (body: any) => {
    if (await run(() => api(`/clinical/photos/${photo.id}`, { method: 'PATCH', body }))) onChanged();
  };
  return (
    <Dialog open={!!photo} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[96vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {STAGES[photo.stage]?.label} · {photo.angle ?? 'foto'}
          </DialogTitle>
          <DialogDescription>{dateTime(photo.takenAt)}</DialogDescription>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl(photo.id, 'full')} alt="" className="mx-auto max-h-[70vh] rounded-lg object-contain" />
        {canWrite && (
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
            <Field label="Momento">
              <NativeSelect defaultValue={photo.stage} onChange={(e) => patch({ stage: e.target.value })}>
                {Object.entries(STAGES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Ângulo">
              <NativeSelect defaultValue={photo.angle ?? ''} onChange={(e) => patch({ angle: e.target.value || null })}>
                <option value="">—</option>
                {ANGLES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Sessão">
              <NativeSelect defaultValue={photo.sessionId ?? ''} onChange={(e) => patch({ sessionId: e.target.value || null })}>
                <option value="">Sem sessão</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {date(s.performedAt)} · {s.procedureName ?? 'Sessão'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ConfirmButton
              variant="ghost"
              className="text-red-700"
              confirmLabel="Excluir foto?"
              onConfirm={async () => {
                if (await run(() => api(`/clinical/photos/${photo.id}`, { method: 'DELETE' }))) {
                  onClose();
                  onChanged();
                }
              }}
            >
              <Trash2 /> Excluir
            </ConfirmButton>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </DialogContent>
    </Dialog>
  );
}

/** Antes × depois com cortina arrastável. */
function CompareDialog({ pair, onClose }: { pair: [any, any] | null; onClose: () => void }) {
  const [pos, setPos] = useState(50);
  useEffect(() => setPos(50), [pair]);
  if (!pair) return null;
  const [a, b] = pair;
  return (
    <Dialog open={!!pair} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[96vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Antes e depois</DialogTitle>
          <DialogDescription>
            {STAGES[a.stage]?.label} {date(a.takenAt)} × {STAGES[b.stage]?.label} {date(b.takenAt)} · arraste para comparar
          </DialogDescription>
        </DialogHeader>
        <div className="relative mx-auto aspect-[3/4] h-[68vh] max-w-full select-none overflow-hidden rounded-xl bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl(b.id, 'full')} alt="depois" className="absolute inset-0 h-full w-full object-contain" />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(a.id, 'full')} alt="antes" className="absolute inset-0 h-full w-full object-contain" />
          </div>
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }} />
          <span className="absolute left-2 top-2 rounded bg-slate-800/80 px-2 py-0.5 text-xs font-medium uppercase text-white">{STAGES[a.stage]?.label}</span>
          <span className="absolute right-2 top-2 rounded bg-gold-400/90 px-2 py-0.5 text-xs font-medium uppercase text-navy-900">{STAGES[b.stage]?.label}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
            aria-label="Comparar"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Photos({ data, contactId, canWrite, reload, openPhoto }: { data: any; contactId: string; canWrite: boolean; reload: () => void; openPhoto: (p: any) => void }) {
  const [upload, setUpload] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<any[]>([]);
  const [pair, setPair] = useState<[any, any] | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    // Dias do mais recente para o mais antigo; dentro do dia, antes → depois.
    const order: Record<string, number> = { BEFORE: 0, AFTER: 1, FOLLOWUP: 2 };
    for (const p of data.photos) {
      const k = new Date(p.takenAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].reverse().map(([k, ps]) => [k, ps.sort((x, y) => (order[x.stage] ?? 9) - (order[y.stage] ?? 9))] as [string, any[]]);
  }, [data.photos]);
  const suggest = () => {
    const before = data.photos.filter((p: any) => p.stage === 'BEFORE');
    const after = [...data.photos].reverse().filter((p: any) => p.stage !== 'BEFORE');
    for (const a of after) {
      const b = before.find((x: any) => x.angle === a.angle && new Date(x.takenAt) < new Date(a.takenAt));
      if (b) return setPair([b, a]);
    }
    setSelecting(true);
  };
  const use = data.imageUse ? IMAGE_USE[data.imageUse] : null;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Fotos de antes e depois</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            Guardadas só no prontuário (não ficam na galeria do celular da clínica).
            {use ? (
              <span className={cn('rounded-full border px-2 py-0.5 text-xs', use.cls)}>{use.label}</span>
            ) : (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">Uso de imagem: sem termo assinado</span>
            )}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.photos.length >= 2 && (
            <Button
              size="sm"
              variant={selecting ? 'secondary' : 'outline'}
              onClick={() => {
                if (selecting) {
                  setSelecting(false);
                  setPicked([]);
                } else suggest();
              }}
            >
              <Columns2 /> {selecting ? 'Cancelar comparação' : 'Comparar antes e depois'}
            </Button>
          )}
          {canWrite && (
            <Button size="sm" variant="gold" onClick={() => setUpload(true)}>
              <Camera /> Adicionar fotos
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {selecting && <p className="rounded-md bg-gold-50 px-3 py-2 text-sm">Toque em duas fotos para comparar ({picked.length}/2).</p>}
        {data.photos.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma foto ainda. Tire as fotos de antes no início da sessão.</p>}
        {groups.map(([day, photos]) => (
          <div key={day}>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{day}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
              {photos.map((p) => (
                <Thumb
                  key={p.id}
                  p={p}
                  selected={picked.some((x) => x.id === p.id)}
                  onClick={() => {
                    if (!selecting) return openPhoto(p);
                    const next = picked.some((x) => x.id === p.id) ? picked.filter((x) => x.id !== p.id) : [...picked, p];
                    if (next.length === 2) {
                      const sorted = [...next].sort((x, y) => new Date(x.takenAt).getTime() - new Date(y.takenAt).getTime()) as [any, any];
                      setPair(sorted);
                      setPicked([]);
                      setSelecting(false);
                    } else setPicked(next);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
      <UploadDialog open={upload} onOpenChange={setUpload} contactId={contactId} sessions={data.sessions} onDone={reload} />
      <CompareDialog pair={pair} onClose={() => setPair(null)} />
    </Card>
  );
}

// ── Prontuário ───────────────────────────────────────────

export function ClinicalRecord({ contact }: { contact: { id: string; name: string | null; waId: string | null } }) {
  const { data, error, reload } = useApi<any>(`/patients/${contact.id}/clinical`);
  const { data: tpl } = useApi<any>('/messages/templates');
  const me = useMe();
  const canWrite = !!me?.permissions.includes('clinical:write');
  const [photo, setPhoto] = useState<any | null>(null);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <p className="text-sm text-muted-foreground">Carregando prontuário…</p>;
  const clinic = tpl?.settings?.clinicName ?? tpl?.clinicName ?? 'clínica';
  const hasAnamnesis = data.forms.some((f: any) => f.kind === 'ANAMNESIS' && f.status === 'SIGNED');

  return (
    <div className="space-y-6">
      {data.alerts.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="flex items-center gap-2 font-medium text-red-800">
            <AlertTriangle className="size-4" /> Atenção na anamnese ({date(data.anamnesisAt)})
          </p>
          <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-sm text-red-900 sm:grid-cols-2">
            {data.alerts.map((a: any) => (
              <li key={a.q}>
                • {a.q.replace(/\?$/, '')}
                {a.detail && <b>: {a.detail}</b>}
              </li>
            ))}
          </ul>
        </div>
      ) : !hasAnamnesis ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <FilePlus2 className="size-4" /> Paciente ainda sem anamnese assinada. Envie antes do primeiro procedimento.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Photos data={data} contactId={contact.id} canWrite={canWrite} reload={reload} openPhoto={setPhoto} />
          <Sessions data={data} contactId={contact.id} canWrite={canWrite} reload={reload} openPhoto={setPhoto} />
        </div>
        <Documents data={data} contactId={contact.id} patient={contact} clinic={clinic} canWrite={canWrite} reload={reload} />
      </div>
      <PhotoViewer
        photo={photo}
        sessions={data.sessions}
        canWrite={canWrite}
        onClose={() => setPhoto(null)}
        onChanged={() => {
          reload();
          setPhoto(null);
        }}
      />
    </div>
  );
}
