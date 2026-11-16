'use client';

import { useMemo, useState } from 'react';
import { LOST_REASONS, STAGES } from '@/components/badges';
import { defaultCustom, PeriodPicker, type CustomRange, type Preset } from '@/components/period-picker';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApi } from '@/lib/api';
import { brl, num, pct, presetRange, roas } from '@/lib/format';

export default function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState<CustomRange>(defaultCustom);
  const qs = useMemo(() => new URLSearchParams(presetRange(preset, custom)).toString(), [preset, custom]);
  const { data: ads } = useApi<any[]>(`/reports/ads?${qs}`);
  const { data: campaigns } = useApi<any[]>(`/reports/campaigns?${qs}`);
  const { data: funnel } = useApi(`/reports/funnel?${qs}`);
  const { data: defs } = useApi<any[]>(`/reports/definitions`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold text-navy-800">Relatórios</h1>
        <PeriodPicker value={preset} onChange={setPreset} custom={custom} onCustomChange={setCustom} />
      </div>

      <Tabs defaultValue="ads">
        <TabsList>
          <TabsTrigger value="ads">Anúncios</TabsTrigger>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          <TabsTrigger value="funnel">Funil</TabsTrigger>
          <TabsTrigger value="defs">Critérios</TabsTrigger>
        </TabsList>

        <TabsContent value="ads">
          <Card>
            <CardHeader>
              <CardTitle>Por anúncio</CardTitle>
              <CardDescription>“Conversas (Meta)” usa o modelo de atribuição da Meta; “Conversas/Leads (CRM)” só contam referências oficiais recebidas ou atribuições manuais.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>Anúncio</TH>
                    <TH className="text-right">Investimento</TH>
                    <TH className="text-right">Impressões</TH>
                    <TH className="text-right">Cliques</TH>
                    <TH className="text-right">Conversas (Meta)</TH>
                    <TH className="text-right">Conversas (CRM)</TH>
                    <TH className="text-right">Leads oficiais</TH>
                    <TH className="text-right">Leads manuais</TH>
                    <TH className="text-right">Agend.</TH>
                    <TH className="text-right">Vendas</TH>
                    <TH className="text-right">Receita</TH>
                    <TH className="text-right">CPL</TH>
                    <TH className="text-right">ROAS</TH>
                  </TR>
                </THead>
                <TBody>
                  {ads?.map((a) => (
                    <TR key={a.adMetaId}>
                      <TD className="min-w-[200px]">
                        <p className="font-medium">
                          {a.adCode && <span className="mr-1 rounded bg-gold-50 px-1.5 py-0.5 font-mono text-xs text-gold-700">{a.adCode}</span>}
                          {a.adName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.campaignName} · {a.adSetName}
                        </p>
                      </TD>
                      <TD className="text-right">{brl(a.spendCents)}</TD>
                      <TD className="text-right">{num(a.impressions)}</TD>
                      <TD className="text-right">{num(a.clicks)}</TD>
                      <TD className="text-right">{num(a.metaConversationsStarted)}</TD>
                      <TD className="text-right">{num(a.crmConversationsFromAd)}</TD>
                      <TD className="text-right">{num(a.leadsOfficial)}</TD>
                      <TD className="text-right">{num(a.leadsManual)}</TD>
                      <TD className="text-right">{num(a.appointments)}</TD>
                      <TD className="text-right">{num(a.sales)}</TD>
                      <TD className="text-right">{brl(a.revenueCents)}</TD>
                      <TD className="text-right">{brl(a.costPerLeadCents)}</TD>
                      <TD className="text-right font-semibold">{roas(a.roas)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns">
          <Card>
            <CardContent className="pt-5">
              <Table>
                <THead>
                  <TR>
                    <TH>Campanha</TH>
                    <TH className="text-right">Investimento</TH>
                    <TH className="text-right">Conversas (Meta)</TH>
                    <TH className="text-right">Leads atribuídos</TH>
                    <TH className="text-right">Vendas</TH>
                    <TH className="text-right">Receita</TH>
                    <TH className="text-right">CPL</TH>
                    <TH className="text-right">ROAS</TH>
                  </TR>
                </THead>
                <TBody>
                  {campaigns?.map((c) => (
                    <TR key={c.campaignMetaId ?? 'none'}>
                      <TD className="font-medium">{c.campaignName}</TD>
                      <TD className="text-right">{brl(c.spendCents)}</TD>
                      <TD className="text-right">{num(c.metaConversationsStarted)}</TD>
                      <TD className="text-right">{num(c.leads)}</TD>
                      <TD className="text-right">{num(c.sales)}</TD>
                      <TD className="text-right">{brl(c.revenueCents)}</TD>
                      <TD className="text-right">{brl(c.costPerLeadCents)}</TD>
                      <TD className="text-right font-semibold">{roas(c.roas)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel">
          {funnel && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Leads abertos no período: {num(funnel.total)}</CardTitle>
                  <CardDescription>“Alcançou” inclui leads que passaram pela etapa e seguiram adiante.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {funnel.stages.map((s: any) => (
                    <div key={s.stage}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{STAGES.find((x) => x.value === s.stage)?.label}</span>
                        <span className="text-muted-foreground">
                          alcançou {num(s.everReached)} · agora {num(s.current)}
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-secondary">
                        <div
                          className={`h-2.5 rounded-full ${s.stage === 'LOST' ? 'bg-red-400' : s.stage === 'WON' ? 'bg-gold-400' : 'bg-navy-600'}`}
                          style={{ width: `${funnel.total ? (s.everReached / funnel.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Conversão</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>Lead → agendamento: <b>{pct(funnel.conversion.leadToScheduledPercent)}</b></p>
                    <p>Agendamento → venda: <b>{pct(funnel.conversion.scheduledToWonPercent)}</b></p>
                    <p>Lead → venda: <b>{pct(funnel.conversion.leadToWonPercent)}</b></p>
                    <p>Mediana da 1ª resposta: <b>{funnel.medianFirstResponseMinutes ?? '—'} min</b></p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Motivos de perda</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {Object.keys(funnel.lostReasons).length === 0 && <p className="text-muted-foreground">Nenhuma perda no período.</p>}
                    {Object.entries(funnel.lostReasons).map(([k, v]) => (
                      <p key={k} className="flex justify-between">
                        <span>{LOST_REASONS.find((r) => r.value === k)?.label ?? k}</span>
                        <b>{v as number}</b>
                      </p>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="defs">
          <Card>
            <CardContent className="divide-y pt-5">
              {defs?.map((d) => (
                <div key={d.key} className="flex flex-col gap-1 py-3 md:flex-row md:items-start md:gap-4">
                  <div className="flex w-64 shrink-0 items-center gap-2">
                    <Badge variant={d.source === 'META' ? 'default' : 'gold'}>{d.source}</Badge>
                    <span className="font-medium">{d.label}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{d.criteria}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
