'use client';

import { FileSignature, HardDrive, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, Textarea } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { date, dateTime, phone } from '@/lib/format';
import { cn } from '@/lib/utils';

const mb = (b: number) => `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

function TemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useApi<any[]>(open ? '/clinical/templates' : null);
  const [list, setList] = useState<any[]>([]);
  const [sel, setSel] = useState(0);
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) {
      setList(data.map((t) => ({ ...t })));
      setSel(0);
      setSaved(false);
    }
  }, [data]);
  const cur = list[sel];
  const set = (patch: any) => {
    setSaved(false);
    setList((xs) => xs.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modelos de termo de consentimento</DialogTitle>
          <DialogDescription>
            Use {'{paciente}'}, {'{procedimento}'}, {'{clinica}'} e {'{data}'}: são trocados na hora de gerar o termo. Termos já criados não mudam. Os textos que vêm prontos são uma
            base: revise com o responsável técnico e o jurídico da clínica.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <div className="space-y-1">
            {list.map((t, i) => (
              <button
                key={t.key}
                onClick={() => setSel(i)}
                className={cn('block w-full rounded-md px-3 py-2 text-left text-sm', i === sel ? 'bg-navy-800 text-white' : 'hover:bg-secondary')}
              >
                {t.title.replace(/^Termo de consentimento – /, '')}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setList((xs) => [...xs, { key: `custom-${Date.now().toString(36)}`, title: 'Termo de consentimento – novo', text: 'Eu, {paciente}, autorizo a realização de {procedimento} na {clinica}.\n\n' }]);
                setSel(list.length);
              }}
            >
              <Plus /> Novo modelo
            </Button>
          </div>
          {cur && (
            <div className="space-y-3">
              <Field label="Título">
                <Input value={cur.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="Texto">
                <Textarea rows={18} value={cur.text} onChange={(e) => set({ text: e.target.value })} className="font-mono text-xs leading-relaxed" />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-700"
                  disabled={list.length <= 1}
                  onClick={() => {
                    setList((xs) => xs.filter((_, i) => i !== sel));
                    setSel(0);
                  }}
                >
                  <Trash2 /> Remover modelo
                </Button>
                <div className="flex items-center gap-2">
                  {saved && <span className="text-sm text-emerald-700">Modelos salvos.</span>}
                  <ErrorText>{error}</ErrorText>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      if (await run(() => api('/clinical/templates', { method: 'PUT', body: list.map(({ key, title, text }) => ({ key, title, text })) }))) setSaved(true);
                    }}
                  >
                    Salvar modelos
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClinicalOverviewPage() {
  const { data, error } = useApi<any>('/clinical/overview');
  const me = useMe();
  const canWrite = !!me?.permissions.includes('clinical:write');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<any[]>([]);
  const [tpl, setTpl] = useState(false);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return setHits([]);
    const h = setTimeout(() => api<any[]>(`/agenda/patients?q=${encodeURIComponent(t)}`).then(setHits, () => setHits([])), 250);
    return () => clearTimeout(h);
  }, [q]);

  const pending = useMemo(() => (data?.forms ?? []).filter((f: any) => f.status === 'PENDING'), [data]);
  const signed = useMemo(() => (data?.forms ?? []).filter((f: any) => f.status === 'SIGNED').slice(0, 30), [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Prontuário</h1>
          <p className="text-sm text-muted-foreground">Anamnese, termos assinados no celular, sessões com lote e fotos de antes e depois. Tudo fica na ficha de cada paciente.</p>
        </div>
        {canWrite && (
          <Button variant="outline" onClick={() => setTpl(true)}>
            <FileSignature /> Modelos de termo
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Abrir prontuário</CardTitle>
          <CardDescription>Busque a paciente pelo nome ou telefone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou telefone" />
          </div>
          {hits.length > 0 && (
            <div className="max-w-md divide-y rounded-md border">
              {hits.map((h) => (
                <Link key={h.contactId} href={`/pacientes/${h.contactId}?tab=prontuario`} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary/60">
                  <span>{h.name ?? 'Sem nome'}</span>
                  <span className="text-xs text-muted-foreground">{phone(h.waId)}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && <ErrorText>{error}</ErrorText>}
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Aguardando assinatura ({pending.length})</CardTitle>
              <CardDescription>Documentos enviados que a paciente ainda não assinou.</CardDescription>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada pendente.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Paciente</TH>
                      <TH>Documento</TH>
                      <TH>Criado</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {pending.map((f: any) => (
                      <TR key={f.id}>
                        <TD>
                          <Link href={`/pacientes/${f.contactId}?tab=prontuario`} className="font-medium text-navy-700 hover:underline">
                            {f.patientName ?? 'Sem nome'}
                          </Link>
                        </TD>
                        <TD className="text-sm">{f.title}</TD>
                        <TD className="text-sm">{date(f.createdAt)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle>Assinados recentemente</CardTitle>
                <CardDescription>Últimos documentos assinados pelas pacientes.</CardDescription>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Espaço usado pelas fotos no banco de dados">
                <HardDrive className="size-3.5" /> Fotos: {mb(data.storage.photoBytes)}
              </span>
            </CardHeader>
            <CardContent>
              {signed.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum documento assinado ainda.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Paciente</TH>
                      <TH>Documento</TH>
                      <TH>Assinado</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {signed.map((f: any) => (
                      <TR key={f.id}>
                        <TD>
                          <Link href={`/pacientes/${f.contactId}?tab=prontuario`} className="font-medium text-navy-700 hover:underline">
                            {f.patientName ?? 'Sem nome'}
                          </Link>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/prontuario/documento/${f.id}`} className="hover:underline">
                            {f.title}
                          </Link>
                        </TD>
                        <TD className="text-sm">{dateTime(f.signedAt)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <TemplatesDialog open={tpl} onOpenChange={setTpl} />
    </div>
  );
}
