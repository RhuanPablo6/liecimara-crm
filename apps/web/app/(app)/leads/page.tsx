'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ConfidenceBadge, StageBadge, STAGES } from '@/components/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { dateTime, phone } from '@/lib/format';

function NewLeadDialog() {
  const router = useRouter();
  const [waId, setWaId] = useState('55');
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="gold">
          <Plus /> Novo lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo lead manual</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Use quando o paciente chegou por telefone, indicação ou presencialmente. A origem fica como desconhecida até ser informada.</p>
        <Field label="WhatsApp (DDI + DDD + número)">
          <Input inputMode="numeric" value={waId} onChange={(e) => setWaId(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const lead = await api('/leads', { method: 'POST', body: { waId, name: name || undefined } });
              router.push(`/leads/${lead.id}`);
            })
          }
        >
          Criar lead
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export default function LeadsPage() {
  const [stage, setStage] = useState('');
  const [confidence, setConfidence] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ limit: '50', offset: String(page * 50) });
    if (stage) p.set('stage', stage);
    if (confidence) p.set('confidence', confidence);
    if (search.length >= 2) p.set('search', search);
    return p.toString();
  }, [stage, confidence, search, page]);
  const { data, loading } = useApi<{ total: number; items: any[] }>(`/leads?${qs}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Leads</h1>
          <p className="text-sm text-muted-foreground">{data ? `${data.total} leads` : 'Carregando…'}</p>
        </div>
        <NewLeadDialog />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Nome ou telefone" value={search} onChange={(e) => (setSearch(e.target.value), setPage(0))} />
          </div>
          <NativeSelect className="w-auto" value={stage} onChange={(e) => (setStage(e.target.value), setPage(0))}>
            <option value="">Todas as etapas</option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="w-auto" value={confidence} onChange={(e) => (setConfidence(e.target.value), setPage(0))}>
            <option value="">Qualquer origem</option>
            <option value="OFFICIAL_REFERRAL">Referência oficial</option>
            <option value="MANUAL">Informada manualmente</option>
            <option value="UNKNOWN">Origem desconhecida</option>
          </NativeSelect>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Contato</TH>
              <TH>Etapa</TH>
              <TH>Anúncio de origem</TH>
              <TH>Atribuição</TH>
              <TH>Interesse</TH>
              <TH>Última atividade</TH>
            </TR>
          </THead>
          <TBody>
            {data?.items.map((l) => (
              <TR key={l.id} className="cursor-pointer">
                <TD>
                  <Link href={`/leads/${l.id}`} className="block">
                    <p className="font-medium text-navy-800">{l.contact?.name ?? 'Sem nome'}</p>
                    <p className="text-xs text-muted-foreground">{phone(l.contact?.waId)}</p>
                  </Link>
                </TD>
                <TD>
                  <StageBadge stage={l.stage} />
                </TD>
                <TD className="max-w-[220px] truncate text-sm">{l.adName ?? '—'}</TD>
                <TD>
                  <ConfidenceBadge value={l.attributionConfidence} />
                </TD>
                <TD className="text-sm">{l.procedureInterest ?? '—'}</TD>
                <TD className="text-sm text-muted-foreground">{dateTime(l.lastActivityAt)}</TD>
              </TR>
            ))}
            {!loading && data?.items.length === 0 && (
              <TR>
                <TD colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nenhum lead encontrado.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
        {data && data.total > 50 && (
          <div className="flex items-center justify-end gap-2 border-t p-3">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              {page + 1} / {Math.ceil(data.total / 50)}
            </span>
            <Button size="sm" variant="outline" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
