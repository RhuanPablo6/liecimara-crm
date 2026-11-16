'use client';

import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText, Field, Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, useAction, useApi } from '@/lib/api';
import { dateTime } from '@/lib/format';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
  CONNECTED: { label: 'Conectado', variant: 'success' },
  DEGRADED: { label: 'Com alertas', variant: 'warning' },
  PENDING: { label: 'Aguardando verificação', variant: 'secondary' },
  DISCONNECTED: { label: 'Desconectado', variant: 'danger' },
  ERROR: { label: 'Erro', variant: 'danger' },
};
const WEBHOOK: Record<string, string> = {
  OK: 'Recebendo eventos',
  NO_EVENTS: 'Nenhum evento recebido ainda',
  STALE: 'Sem eventos há mais de 48h',
  SIGNATURE_FAILURES: 'Rejeitando eventos com assinatura inválida',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-navy-800 sm:text-right">{value ?? '—'}</span>
    </div>
  );
}

const TEMPLATE_STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
  APPROVED: { label: 'Aprovado pela Meta', variant: 'success' },
  PENDING: { label: 'Em análise na Meta', variant: 'warning' },
  IN_APPEAL: { label: 'Em recurso', variant: 'warning' },
  REJECTED: { label: 'Recusado', variant: 'danger' },
  PAUSED: { label: 'Pausado', variant: 'danger' },
  DISABLED: { label: 'Desativado', variant: 'danger' },
};

/** Confirmação automática de agendamento com botões (YCloud). */
function ConfirmationsCard() {
  const { data, reload } = useApi<any>('/whatsapp/confirmations');
  const act = useAction();
  if (!data) return null;
  const tpl = data.template ? (TEMPLATE_STATUS[data.template.status] ?? { label: data.template.status, variant: 'secondary' as const }) : null;
  const approved = data.template?.status === 'APPROVED';
  const save = (patch: object) => act.run(async () => (await api('/whatsapp/confirmations/settings', { method: 'PUT', body: patch }), await reload()));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Confirmação de agendamento pelo WhatsApp
          {tpl ? <Badge variant={tpl.variant}>{tpl.label}</Badge> : <Badge variant="secondary">Modelo não criado</Badge>}
        </CardTitle>
        <CardDescription>
          Na véspera, a paciente recebe a mensagem com os botões <b>Confirmar</b>, <b>Remarcar</b> e <b>Desmarcar</b>. O toque dela atualiza a Agenda
          na hora e ela recebe uma resposta automática.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-md border bg-secondary/40 p-3">
          <p className="whitespace-pre-wrap">{data.body.replace('{{1}}', 'Mariana').replace('{{2}}', 'Clínica Dra. Liecimara Esteves').replace('{{3}}', 'Botox').replace('{{4}}', '18/11').replace('{{5}}', '14:00')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.buttons.map((b: string) => (
              <span key={b} className="rounded-full border bg-background px-3 py-1 text-xs font-medium text-navy-700">
                {b}
              </span>
            ))}
          </div>
        </div>
        {data.template?.reason && <p className="text-red-700">Motivo da recusa: {data.template.reason}</p>}
        {data.templateError && <p className="text-red-700">{data.templateError}</p>}
        {!data.template && (
          <Button disabled={act.busy} onClick={() => act.run(async () => (await api('/whatsapp/confirmations/template', { method: 'POST' }), await reload()))}>
            Enviar modelo para aprovação da Meta
          </Button>
        )}
        {data.template && !approved && <p className="text-muted-foreground">A Meta costuma aprovar em minutos, às vezes em até 24 h. Atualize esta página para ver.</p>}
        <div className="flex flex-wrap items-center gap-4 border-t pt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-navy-700"
              checked={data.settings.enabled}
              disabled={act.busy || !approved}
              onChange={(e) => save({ enabled: e.target.checked })}
            />
            Enviar automaticamente na véspera
          </label>
          <label className="flex items-center gap-2">
            a partir das
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={data.settings.sendHour}
              disabled={act.busy}
              onChange={(e) => save({ sendHour: Number(e.target.value) })}
            >
              {Array.from({ length: 11 }, (_, i) => i + 8).map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </label>
        </div>
        {!approved && <p className="text-xs text-muted-foreground">O envio automático libera quando o modelo estiver aprovado.</p>}
        <p className="text-xs text-muted-foreground">
          Também dá para enviar na hora, por agendamento, no botão “Enviar confirmação pelo WhatsApp” da Agenda. Cada confirmação custa cerca de R$ 0,04
          (tarifa da Meta).
        </p>
        <ErrorText>{act.error}</ErrorText>
      </CardContent>
    </Card>
  );
}

function WhatsAppPanel() {
  const { data, reload } = useApi('/integrations/whatsapp');
  const { data: events, reload: reloadEvents } = useApi<any[]>('/integrations/events?limit=30');
  const act = useAction();
  const [form, setForm] = useState({ wabaId: '', phoneNumberId: '', accessToken: '', coexistence: true });
  const [ycKey, setYcKey] = useState('');
  const [ycConfirm, setYcConfirm] = useState(false);

  if (!data) return <p className="text-muted-foreground">Carregando…</p>;
  const run = (fn: () => Promise<unknown>) => act.run(async () => (await fn(), await reload(), await reloadEvents()));

  return (
    <div className="space-y-6">
      <ErrorText>{act.error}</ErrorText>
      <div className="rounded-md border border-gold-300 bg-gold-50 p-3 text-sm text-navy-800">
        Ambiente atual: <b>{data.environment === 'PRODUCTION' ? 'Produção' : 'Homologação'}</b>. O CRM nunca migra, registra ou desconecta o número — apenas
        recebe eventos e consulta dados. A vinculação do número de produção exige confirmação do administrador.
      </div>

      {!data.connections.some((c: any) => c.partnerName === 'YCloud') && (
        <Card className="border-emerald-300">
          <CardHeader>
            <CardTitle>Conectar via YCloud (coexistência, plano grátis)</CardTitle>
            <CardDescription>
              Depois de conectar o número no YCloud (Coexistência do aplicativo WhatsApp Business), crie uma API Key em Desenvolvedor → API Keys e
              cole aqui. O CRM encontra o número, cria o webhook sozinho e passa a receber as mensagens. A clínica continua atendendo pelo app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="API Key do YCloud">
              <Input type="password" autoComplete="off" value={ycKey} onChange={(e) => setYcKey(e.target.value)} />
            </Field>
            {data.environment === 'PRODUCTION' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-navy-700" checked={ycConfirm} onChange={(e) => setYcConfirm(e.target.checked)} />
                Confirmo que este é o número oficial da clínica
              </label>
            )}
            <Button
              disabled={act.busy || ycKey.trim().length < 8 || (data.environment === 'PRODUCTION' && !ycConfirm)}
              onClick={() =>
                run(async () => {
                  await api('/integrations/whatsapp/ycloud', { method: 'POST', body: { apiKey: ycKey, confirmProductionNumber: ycConfirm || undefined } });
                  setYcKey('');
                })
              }
            >
              Conectar YCloud
            </Button>
          </CardContent>
        </Card>
      )}

      {data.connections.some((c: any) => c.partnerName === 'YCloud') && <ConfirmationsCard />}

      {data.connections.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Configurar WhatsApp Cloud API (avançado)</CardTitle>
            <CardDescription>Dados obtidos após o Embedded Signup (coexistência) no Gerenciador do WhatsApp.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="ID da conta WhatsApp (WABA)">
              <Input value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} />
            </Field>
            <Field label="ID do número na API">
              <Input value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} />
            </Field>
            <Field label="Token de acesso (usuário do sistema)" className="md:col-span-2">
              <Input type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.coexistence} onChange={(e) => setForm({ ...form, coexistence: e.target.checked })} />
              Número continua no app WhatsApp Business (coexistência)
            </label>
            <div className="md:col-span-2">
              <Button disabled={act.busy} onClick={() => run(() => api('/integrations/whatsapp/cloud', { method: 'POST', body: form }))}>
                Salvar (homologação)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data.connections.map((c: any) => {
        const kind = c.provider === 'WHATSAPP_CLOUD_API' ? 'cloud' : 'partner';
        const st = STATUS[c.status] ?? STATUS.PENDING!;
        return (
          <div key={c.provider} className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {c.provider === 'WHATSAPP_CLOUD_API' ? 'WhatsApp Cloud API' : `WhatsApp · ${c.partnerName ?? 'parceiro oficial'} (coexistência)`}
                  <Badge variant={st.variant}>{st.label}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                <Row label="Estado da conexão" value={st.label} />
                <Row label="Número vinculado" value={c.displayPhoneNumber} />
                <Row label="ID da conta WhatsApp (WABA)" value={c.wabaId} />
                <Row label="ID do número na API" value={c.phoneNumberId} />
                <Row label="Coexistência com o app" value={c.coexistence ? 'Sim' : 'Não'} />
                <Row label="Credencial" value={c.credential} />
                <Row label="Status dos webhooks" value={WEBHOOK[c.webhook.status] ?? c.webhook.status} />
                <Row label="Último evento recebido" value={dateTime(c.webhook.lastEventAt)} />
                <Row label="Última sincronização" value={dateTime(c.lastSyncAt)} />
                <Row label="URL de callback" value={<code className="break-all text-xs">{c.webhook.callbackUrl}</code>} />
                <Row
                  label="Segredos do webhook"
                  value={`${c.webhook.appSecretConfigured ? 'App Secret ✓' : 'App Secret ✗'} · ${c.webhook.verifyTokenConfigured ? 'Verify token ✓' : 'Verify token ✗'}`}
                />
                {c.diagnostic?.historySync && <Row label="Histórico do app" value={`${c.diagnostic.historySync.status} ${c.diagnostic.historySync.progress ?? ''}`} />}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-gold-500" /> Diagnóstico de permissões
                  </CardTitle>
                  <CardDescription>{c.diagnostic?.checkedAt ? `Verificado em ${dateTime(c.diagnostic.checkedAt)}` : 'Ainda não executado'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {c.diagnostic?.checks?.map((ch: any) => (
                    <div key={ch.name} className="flex items-start gap-2 text-sm">
                      {ch.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-600" />}
                      <div>
                        <p className="font-medium">{ch.name}</p>
                        <p className="text-xs text-muted-foreground">{ch.detail}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button size="sm" disabled={act.busy} onClick={() => run(() => api(`/integrations/whatsapp/${kind}/diagnose`, { method: 'POST' }))}>
                      <RefreshCw /> Executar diagnóstico
                    </Button>
                    {kind === 'cloud' && (
                      <Button size="sm" variant="outline" disabled={act.busy} onClick={() => run(() => api('/integrations/whatsapp/resubscribe', { method: 'POST' }))}>
                        Reinscrever webhooks
                      </Button>
                    )}
                    {c.coexistence && (
                      <>
                        <Button size="sm" variant="outline" disabled={act.busy} onClick={() => run(() => api(`/integrations/whatsapp/${kind}/sync`, { method: 'POST', body: { type: 'smb_app_state_sync' } }))}>
                          Sincronizar contatos
                        </Button>
                        <Button size="sm" variant="outline" disabled={act.busy} onClick={() => run(() => api(`/integrations/whatsapp/${kind}/sync`, { method: 'POST', body: { type: 'history' } }))}>
                          Importar histórico
                        </Button>
                      </>
                    )}
                  </div>
                  {c.coexistence && <p className="text-xs text-muted-foreground">Sincronização de contatos e histórico só pode ser feita uma vez por conexão, em até 24h após o onboarding.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500" /> Erros recentes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {c.recentErrors.length === 0 && <p className="text-sm text-muted-foreground">Nenhum erro.</p>}
                  {c.recentErrors.map((e: any) => (
                    <div key={e.id} className="text-sm">
                      <p className="font-medium">{e.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.code} · {dateTime(e.createdAt)}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Procedimento de reconexão</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {data.reconnectProcedure.map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos recentes</CardTitle>
          <CardDescription>
            {Object.entries(data.events)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ') || 'Nenhum evento'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Recebido</TH>
                <TH>Tipo</TH>
                <TH>Status</TH>
                <TH>Tentativas</TH>
                <TH>Erro</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {events?.map((e) => (
                <TR key={e.id}>
                  <TD className="text-xs">{dateTime(e.receivedAt)}</TD>
                  <TD className="text-xs">{e.kind}</TD>
                  <TD>
                    <Badge variant={e.status === 'PROCESSED' ? 'success' : e.status === 'DEAD' || e.status === 'FAILED' ? 'danger' : 'secondary'}>{e.status}</Badge>
                  </TD>
                  <TD className="text-xs">{e.attempts}</TD>
                  <TD className="max-w-[280px] truncate text-xs text-muted-foreground">{e.lastError}</TD>
                  <TD>
                    {(e.status === 'DEAD' || e.status === 'FAILED') && (
                      <Button size="sm" variant="outline" onClick={() => run(() => api(`/integrations/events/${e.id}/reprocess`, { method: 'POST' }))}>
                        Reprocessar
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MetaPanel() {
  const { data, reload } = useApi('/integrations/meta');
  const act = useAction();
  const [form, setForm] = useState({ adAccountIds: '', accessToken: '' });
  const [diag, setDiag] = useState<any[] | null>(null);
  if (!data) return null;
  const st = STATUS[data.status] ?? STATUS.PENDING!;
  const accountsLabel = !data.configured
    ? null
    : data.allAdAccounts
      ? 'Todas as contas acessíveis pelo token'
      : (data.adAccountIds ?? []).map((id: string) => `act_${id}`).join(', ');
  // Sem token novo, só é possível salvar se já houver um token guardado.
  const canSave = !!form.accessToken || data.configured;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Meta Marketing API <Badge variant={st.variant}>{st.label}</Badge>
          </CardTitle>
          <CardDescription>Campanhas, anúncios e investimento (somente leitura, escopo ads_read).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="divide-y">
            <Row label="Contas de anúncios" value={accountsLabel} />
            <Row label="Última sincronização" value={dateTime(data.lastSyncAt)} />
          </div>
          <Field label="Contas de anúncios">
            <Input
              placeholder="Em branco = todas as contas do token · ou act_123, act_456"
              value={form.adAccountIds}
              onChange={(e) => setForm({ ...form, adAccountIds: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Deixe em branco para sincronizar todas as contas atribuídas ao usuário do sistema, ou informe os IDs separados por vírgula.
            </p>
          </Field>
          <Field label="Token de acesso">
            <Input
              type="password"
              placeholder={data.configured ? 'Deixe em branco para manter o token atual' : ''}
              value={form.accessToken}
              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
            />
          </Field>
          <ErrorText>{act.error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={act.busy || !canSave}
              onClick={() =>
                act.run(async () => {
                  await api('/integrations/meta', { method: 'POST', body: form });
                  setForm({ adAccountIds: '', accessToken: '' });
                  await reload();
                })
              }
            >
              Salvar e sincronizar
            </Button>
            <Button variant="outline" disabled={act.busy || !data.configured} onClick={() => act.run(async () => (await api('/integrations/meta/sync', { method: 'POST' }), await reload()))}>
              Sincronizar agora
            </Button>
            <Button variant="outline" disabled={act.busy || !data.configured} onClick={() => act.run(async () => setDiag(await api('/integrations/meta/diagnose', { method: 'POST' })))}>
              Diagnóstico
            </Button>
          </div>
          {diag?.map((d) => (
            <p key={d.name} className="flex items-center gap-2 text-sm">
              {d.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
              {d.name}: <span className="text-muted-foreground">{d.detail}</span>
            </p>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Erros recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recentErrors.length === 0 && <p className="text-sm text-muted-foreground">Nenhum erro.</p>}
          {data.recentErrors.map((e: any) => (
            <div key={e.id} className="text-sm">
              <p className="font-medium">{e.message}</p>
              <p className="text-xs text-muted-foreground">
                {e.code} · {dateTime(e.createdAt)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-navy-800">Integrações</h1>
      <Tabs defaultValue="whatsapp">
        <TabsList>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="meta">Meta Ads</TabsTrigger>
        </TabsList>
        <TabsContent value="whatsapp">
          <WhatsAppPanel />
        </TabsContent>
        <TabsContent value="meta">
          <MetaPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
