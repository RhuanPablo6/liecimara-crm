'use client';

import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText, Field, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction } from '@/lib/api';

interface Preview {
  patients: {
    rows: number;
    people: number;
    mergedDuplicates: number;
    withWhatsApp: number;
    landline: number;
    noPhone: number;
    sharedPhone: number;
    alreadyInCrm: number;
    newInCrm: number;
    fixedNames: number;
    birthDates: number;
    discardedBirthDates: number;
    emails: number;
    fakeEmails: number;
    cpfs: number;
    invalidCpf: number;
    addresses: number;
  };
  agenda: {
    rows: number;
    from: string | null;
    to: string | null;
    blocks: number;
    future: number;
    toImport: number;
    canceled: number;
    patients: number;
    unmatched: string[];
    ambiguous: string[];
  };
  procedures: { name: string; count: number; suggestedId: string | null }[];
  procedureOptions: { id: string; name: string; returnDays: number | null }[];
}

type Step = { label: string; done: number; total: number };
const br = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

function FileInput({ label, hint, file, onFile }: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <Field label={label}>
      <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-3 py-3 text-sm hover:bg-muted/50">
        <FileUp className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{file ? file.name : <span className="text-muted-foreground">{hint}</span>}</span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>
    </Field>
  );
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: 'warn' | 'muted' }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className={`text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-700' : tone === 'muted' ? 'text-muted-foreground' : ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function HeonImport() {
  const [patientsFile, setPatientsFile] = useState<File | null>(null);
  const [agendaFile, setAgendaFile] = useState<File | null>(null);
  const [texts, setTexts] = useState<{ patientsCsv: string; agendaCsv: string | null } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [sensitive, setSensitive] = useState(true);
  const [step, setStep] = useState<Step | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; appts: number; performed: number; skipped: number } | null>(null);
  const act = useAction();

  const analyze = () =>
    act.run(async () => {
      if (!patientsFile) throw new Error('Escolha o arquivo de pacientes');
      const t = { patientsCsv: await patientsFile.text(), agendaCsv: agendaFile ? await agendaFile.text() : null };
      const p = await api<Preview>('/imports/heon/preview', { method: 'POST', body: t });
      setTexts(t);
      setPreview(p);
      setMapping(Object.fromEntries(p.procedures.map((x) => [x.name, x.suggestedId])));
      setResult(null);
    });

  const runImport = () =>
    act.run(async () => {
      if (!texts || !preview) return;
      const total = { created: 0, updated: 0, appts: 0, performed: 0, skipped: 0 };
      let offset: number | null = 0;
      while (offset !== null) {
        const r: { total: number; done: number; next: number | null; created: number; updated: number } = await api('/imports/heon/patients', {
          method: 'POST',
          body: { ...texts, offset, limit: 150, includeSensitive: sensitive },
        });
        total.created += r.created;
        total.updated += r.updated;
        setStep({ label: 'Pacientes', done: r.done, total: r.total });
        offset = r.next;
      }
      if (texts.agendaCsv && preview.agenda.toImport) {
        offset = 0;
        while (offset !== null) {
          const r: { total: number; done: number; next: number | null; created: number; performed: number; skipped: number } = await api('/imports/heon/agenda', {
            method: 'POST',
            body: { ...texts, offset, limit: 40, mapping },
          });
          total.appts += r.created;
          total.performed += r.performed;
          total.skipped += r.skipped;
          setStep({ label: 'Histórico da agenda', done: r.done, total: r.total });
          offset = r.next;
        }
      }
      setResult(total);
      setStep(null);
    });

  const p = preview?.patients;
  const a = preview?.agenda;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Importar pacientes do Heon</CardTitle>
          <CardDescription>
            Traz o cadastro de pacientes e o histórico da agenda do sistema anterior. Pode rodar de novo com um arquivo mais novo: nada é duplicado e
            nomes já corrigidos no CRM não são trocados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FileInput label="Cadastro de pacientes" hint="CSV exportado do Heon (pacientes_clinica…csv)" file={patientsFile} onFile={(f) => (setPatientsFile(f), setPreview(null))} />
            <FileInput label="Agenda (opcional)" hint="CSV da agenda (agenda_heon…csv)" file={agendaFile} onFile={(f) => (setAgendaFile(f), setPreview(null))} />
          </div>
          <Button onClick={analyze} disabled={!patientsFile || act.busy}>
            {act.busy && !step ? <Loader2 className="animate-spin" /> : null}
            Analisar arquivos
          </Button>
          <ErrorText>{act.error}</ErrorText>
        </CardContent>
      </Card>

      {p && a && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pacientes</CardTitle>
              <CardDescription>
                {p.rows} cadastros no arquivo → {p.people} pacientes ({p.mergedDuplicates} cadastros repetidos juntados). {p.alreadyInCrm} já estão no CRM
                (são completadas) e {p.newInCrm} entram novas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                <Stat value={p.withWhatsApp} label="com celular (WhatsApp)" />
                <Stat value={p.noPhone} label="sem WhatsApp" tone={p.noPhone ? 'warn' : undefined} />
                <Stat value={p.fixedNames} label="nomes corrigidos" />
                <Stat value={p.birthDates} label="com nascimento" />
                <Stat value={p.cpfs} label="com CPF" />
                <Stat value={p.addresses} label="com endereço" />
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{p.discardedBirthDates} datas de nascimento descartadas: eram de preenchimento do Heon (01/01/1970, ano 0220, datas repetidas em muitos cadastros).</li>
                <li>{p.fakeEmails} e-mails gerados pelo Heon (@heon.com.br) não entram; ficam {p.emails} e-mails reais.</li>
                {p.sharedPhone > 0 && (
                  <li>
                    {p.sharedPhone} pacientes usam o celular de outra pessoa (ex.: mãe e filha): entram sem WhatsApp. O número fica com o primeiro cadastro.
                  </li>
                )}
                {p.invalidCpf > 0 && <li>{p.invalidCpf} CPFs inválidos não entram.</li>}
                {p.landline > 0 && <li>{p.landline} com telefone fixo.</li>}
              </ul>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-navy-700" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
                Trazer CPF e endereço (dados pessoais: só quem usa o CRM vê)
              </label>
            </CardContent>
          </Card>

          {texts?.agendaCsv && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Histórico da agenda</CardTitle>
                <CardDescription>
                  {a.rows} linhas de {br(a.from)} a {br(a.to)}. Entram {a.toImport} agendamentos passados de {a.patients} pacientes ({a.canceled} cancelados).
                  Ficam de fora {a.future} agendamentos de hoje em diante (continuam sendo marcados no CRM) e {a.blocks} bloqueios de "agenda fechada".
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(a.ambiguous.length > 0 || a.unmatched.length > 0) && (
                  <p className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {a.ambiguous.length > 0 && <>Não entram por haver mais de uma paciente com o mesmo nome: {a.ambiguous.join(', ')}. </>}
                      {a.unmatched.length > 0 && <>Sem cadastro: {a.unmatched.join(', ')}.</>}
                    </span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Confira a qual procedimento do CRM cada nome do Heon corresponde. Os vinculados contam como procedimento realizado e geram o lembrete de
                  retorno (ex.: Botox). Consulta e retorno ficam sem vínculo.
                </p>
                <Table>
                  <THead>
                    <TR>
                      <TH>No Heon</TH>
                      <TH className="text-right">Agend.</TH>
                      <TH>No CRM</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.procedures.map((x) => (
                      <TR key={x.name}>
                        <TD>{x.name || <span className="text-muted-foreground">(sem procedimento)</span>}</TD>
                        <TD className="text-right tabular-nums">{x.count}</TD>
                        <TD>
                          <NativeSelect
                            className="w-full min-w-48"
                            value={mapping[x.name] ?? ''}
                            onChange={(e) => setMapping((m) => ({ ...m, [x.name]: e.target.value || null }))}
                          >
                            <option value="">Não vincular</option>
                            {preview.procedureOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                                {o.returnDays ? ` (retorno ${o.returnDays} dias)` : ''}
                              </option>
                            ))}
                          </NativeSelect>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 pt-6">
              <Button onClick={runImport} disabled={act.busy}>
                {step ? <Loader2 className="animate-spin" /> : null}
                Importar agora
              </Button>
              {step && (
                <div className="min-w-60 flex-1 space-y-1 text-sm">
                  <div>
                    {step.label}: {step.done} de {step.total}
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-navy-700 transition-all" style={{ width: `${Math.round((step.done / Math.max(1, step.total)) * 100)}%` }} />
                  </div>
                </div>
              )}
              {result && (
                <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-4" />
                  Pronto: {result.created} pacientes novas, {result.updated} completadas, {result.appts} agendamentos no histórico ({result.performed}{' '}
                  procedimentos realizados){result.skipped ? `, ${result.skipped} já estavam no CRM` : ''}.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
