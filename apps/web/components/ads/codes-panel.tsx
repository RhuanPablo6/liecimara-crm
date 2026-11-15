'use client';

import { Check, Copy, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';

/** Código editável na própria linha: salva ao sair do campo ou com Enter. */
function CodeCell({ ad, onSaved }: { ad: any; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState<string>(ad.code ?? '');
  const { busy, error, run } = useAction();
  const save = () => {
    const next = value.trim().toUpperCase();
    if (next === (ad.code ?? '')) return;
    void run(async () => {
      await api(`/ads/${encodeURIComponent(ad.metaId)}/code`, { method: 'PATCH', body: { code: next || null } });
      await onSaved();
    });
  };
  return (
    <div className="space-y-1">
      <Input
        aria-label={`Código do anúncio ${ad.name}`}
        className="h-8 w-24 font-mono uppercase"
        placeholder="—"
        maxLength={10}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value.replace(/\s/g, ''))}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Procedimento que o anúncio divulga: o gasto dele entra no custo desse procedimento no Financeiro. */
function ProcedureCell({ ad, procedures, sameCampaign, onSaved }: { ad: any; procedures: any[]; sameCampaign: number; onSaved: () => Promise<void> }) {
  const { busy, error, run } = useAction();
  const [justSet, setJustSet] = useState(false);
  const save = (procedureId: string | null, applyToCampaign = false) =>
    run(async () => {
      await api(`/ads/${encodeURIComponent(ad.metaId)}/procedure`, { method: 'PATCH', body: { procedureId, applyToCampaign } });
      setJustSet(!applyToCampaign && !!procedureId && sameCampaign > 0);
      await onSaved();
    });
  return (
    <div className="space-y-1">
      <NativeSelect
        aria-label={`Procedimento do anúncio ${ad.name}`}
        className="h-8 w-56"
        value={ad.procedureId ?? ''}
        disabled={busy}
        onChange={(e) => save(e.target.value || null)}
      >
        <option value="">Não definido</option>
        {procedures
          .filter((p) => p.active || p.id === ad.procedureId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </NativeSelect>
      {justSet && ad.procedureId && (
        <button className="text-xs text-navy-600 underline" disabled={busy} onClick={() => save(ad.procedureId, true)}>
          Aplicar aos outros {sameCampaign} anúncios da campanha
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* sem permissão de área de transferência: o texto continua visível para copiar à mão */
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copiado' : 'Copiar mensagem'}
    </Button>
  );
}

/** Códigos da mensagem pronta e procedimento de cada anúncio. */
export function AdCodesPanel() {
  const { data: ads, reload } = useApi<any[]>('/ads');
  const { data: procedures } = useApi<any[]>('/procedures');
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [search, setSearch] = useState('');
  const gen = useAction();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (ads ?? [])
      .filter((a) => filter === 'all' || a.status === 'ACTIVE' || a.code)
      .filter((a) => !q || `${a.code ?? ''} ${a.name} ${a.campaignName ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.code ? 0 : 1) - (b.code ? 0 : 1) || `${a.campaignName}|${a.name}`.localeCompare(`${b.campaignName}|${b.name}`, 'pt-BR'));
  }, [ads, filter, search]);

  const withoutCode = (ads ?? []).filter((a) => a.status === 'ACTIVE' && !a.code).length;

  return (
    <div className="space-y-6">

      <Card>
        <CardHeader>
          <CardTitle>Como usar</CardTitle>
          <CardDescription>Faça uma vez para cada anúncio ativo.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Gere os códigos (ou digite os seus, como U1 para Ultraformer) na tabela abaixo.</li>
            <li>Clique em <b>Copiar mensagem</b> no anúncio.</li>
            <li>
              No Gerenciador de Anúncios, edite o anúncio e, em <b>Modelo de mensagem / Mensagem pronta</b> do WhatsApp, cole o texto e publique.
            </li>
            <li>Quando chegar um paciente, em <b>Leads → Novo lead</b>, digite o código que veio na mensagem.</li>
            <li>Escolha o <b>procedimento</b> de cada anúncio: o gasto dele entra no custo desse procedimento no <b>Financeiro</b>.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Input className="max-w-xs" placeholder="Buscar por código, anúncio ou campanha" value={search} onChange={(e) => setSearch(e.target.value)} />
            <NativeSelect className="w-60" value={filter} onChange={(e) => setFilter(e.target.value as 'active' | 'all')} aria-label="Filtro">
              <option value="active">Ativos ou com código</option>
              <option value="all">Todos</option>
            </NativeSelect>
            <div className="ml-auto">
              <Button
                variant="gold"
                disabled={gen.busy || withoutCode === 0}
                onClick={() =>
                  gen.run(async () => {
                    await api('/ads/codes/generate', { method: 'POST', body: {} });
                    await reload();
                  })
                }
              >
                <Wand2 /> Gerar códigos ({withoutCode} ativos sem código)
              </Button>
            </div>
          </div>
          <ErrorText>{gen.error}</ErrorText>

          {!ads && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {ads && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum anúncio encontrado. Os anúncios aparecem aqui depois da sincronização com a Meta (Integrações → Meta Ads).
            </p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Código</TH>
                    <TH>Anúncio</TH>
                    <TH>Procedimento</TH>
                    <TH>Situação</TH>
                    <TH>Mensagem pronta</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((a) => (
                    <TR key={a.metaId}>
                      <TD className="align-top">
                        <CodeCell key={`${a.metaId}:${a.code ?? ''}`} ad={a} onSaved={reload} />
                      </TD>
                      <TD className="min-w-[220px] align-top">
                        <p className="font-medium">{a.name}</p>
                        <p className="text-xs text-muted-foreground">{a.campaignName ?? 'Campanha não sincronizada'}</p>
                      </TD>
                      <TD className="align-top">
                        <ProcedureCell
                          ad={a}
                          procedures={procedures ?? []}
                          sameCampaign={(ads ?? []).filter((x) => x.campaignMetaId === a.campaignMetaId && x.metaId !== a.metaId).length}
                          onSaved={reload}
                        />
                      </TD>
                      <TD className="align-top">
                        <Badge variant={a.status === 'ACTIVE' ? 'success' : 'secondary'}>{a.status === 'ACTIVE' ? 'Ativo' : 'Pausado/encerrado'}</Badge>
                      </TD>
                      <TD className="min-w-[260px] align-top">
                        {a.suggestedMessage ? (
                          <div className="space-y-2">
                            <p className="text-sm">{a.suggestedMessage}</p>
                            <CopyMessage text={a.suggestedMessage} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Defina um código</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
