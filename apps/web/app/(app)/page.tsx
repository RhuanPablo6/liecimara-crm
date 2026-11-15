'use client';

import { AlertTriangle, Info } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PeriodPicker, type Preset } from '@/components/period-picker';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useApi } from '@/lib/api';
import { brl, dateTime, num, pct, presetRange, roas } from '@/lib/format';

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-gold-300 bg-gradient-to-br from-white to-gold-50' : ''}>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" title={hint}>
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold text-navy-800">{value}</p>
        {hint && <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<Preset>('30d');
  const qs = useMemo(() => new URLSearchParams(presetRange(preset)).toString(), [preset]);
  const { data: s } = useApi(`/reports/summary?${qs}`);
  const { data: series } = useApi<any[]>(`/reports/timeseries?${qs}`);
  const { data: ads } = useApi<any[]>(`/reports/ads?${qs}`);
  const { data: reminders } = useApi<any[]>(`/reminders`);
  const { data: newLeads } = useApi<{ items: any[] }>(`/leads?stage=NEW&limit=8`);

  const def = (key: string) => s?.definitions?.find((d: any) => d.key === key)?.criteria;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-navy-800">Painel</h1>
          <p className="text-sm text-muted-foreground">Leads de anúncios e conversões comerciais</p>
        </div>
        <PeriodPicker value={preset} onChange={setPreset} />
      </div>

      {s && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Mensagens" value={num(s.messages.total)} hint={def('messages')} />
            <Kpi label="Conversas" value={num(s.conversations)} hint={def('conversations')} />
            <Kpi label="Leads únicos" value={num(s.leads.uniqueContacts)} hint={def('uniqueLeads')} />
            <Kpi label="Leads de anúncios" value={num(s.leads.attributed)} hint={`${s.leads.officialReferral} oficiais · ${s.leads.manual} manuais`} />
            <Kpi label="Agendamentos" value={num(s.appointments.created - s.appointments.canceled)} hint={`${s.appointments.canceled} cancelados`} />
            <Kpi label="Vendas" value={num(s.sales.count)} hint={`Ticket médio ${brl(s.sales.averageTicketCents)}`} />
            <Kpi label="Procedimentos" value={num(s.proceduresPerformed)} hint={def('proceduresPerformed')} />
            <Kpi label="Receita atribuída" value={brl(s.sales.attributedRevenueCents)} hint={`de ${brl(s.sales.revenueCents)} no total`} accent />
          </section>

          <section className="grid gap-3 md:grid-cols-4">
            <Kpi label="Investimento (Meta)" value={brl(s.investment.spendCents)} />
            <Kpi label="Custo por lead atribuído" value={brl(s.investment.costPerAttributedLeadCents)} hint="Somente leads com evidência" />
            <Kpi label="ROAS" value={roas(s.investment.roas)} hint={`Só referência oficial: ${roas(s.investment.roasOfficialOnly)}`} accent />
            <Kpi label="Retorno sobre investimento" value={pct(s.investment.roiPercent)} hint="(receita atribuída − investimento) ÷ investimento" />
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-4 w-4 text-gold-500" /> Meta × CRM
              </CardTitle>
              <CardDescription>Números com critérios diferentes — lidos lado a lado, nunca como equivalentes.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {s.metaVsCrm.map((c: any) => (
                <div key={c.label} className="rounded-lg border p-4">
                  <p className="font-medium text-navy-800">{c.label}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Meta</p>
                      <p className="text-xl font-semibold">{num(c.meta.value)}</p>
                      <p className="text-[11px] text-muted-foreground">{c.meta.criteria}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">CRM</p>
                      <p className="text-xl font-semibold">{num(c.crm.value)}</p>
                      <p className="text-[11px] text-muted-foreground">{c.crm.criteria}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{c.note}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Leads por dia e origem</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {series && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series.map((d) => ({ ...d, dia: d.date.slice(8, 10) + '/' + d.date.slice(5, 7) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="dia" fontSize={11} tickLine={false} />
                  <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={28} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="leadsOfficial" name="Oficial" stackId="a" fill="#132B4E" />
                  <Bar dataKey="leadsManual" name="Manual" stackId="a" fill="#D4AF37" />
                  <Bar dataKey="leadsUnknown" name="Desconhecida" stackId="a" fill="#AABBD6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Para hoje</CardTitle>
            <CardDescription>Novos leads e lembretes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {newLeads?.items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lead novo aguardando.</p>}
              {newLeads?.items.map((l) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-secondary">
                  <span className="truncate text-sm font-medium">{l.contact?.name ?? l.contact?.waId}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{l.adName ?? 'Origem desconhecida'}</span>
                </Link>
              ))}
            </div>
            {reminders && reminders.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                {reminders.map((r) => (
                  <Link key={r.id} href={`/leads/${r.leadId}`} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className={`mt-0.5 h-4 w-4 ${new Date(r.dueAt) < new Date() ? 'text-red-500' : 'text-gold-500'}`} />
                    <span>
                      {r.note} <span className="text-xs text-muted-foreground">· {dateTime(r.dueAt)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Desempenho por anúncio</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Anúncio</TH>
                <TH className="text-right">Investimento</TH>
                <TH className="text-right">Conversas (Meta)</TH>
                <TH className="text-right">Leads (CRM)</TH>
                <TH className="text-right">Vendas</TH>
                <TH className="text-right">Receita</TH>
                <TH className="text-right">ROAS</TH>
              </TR>
            </THead>
            <TBody>
              {ads?.slice(0, 10).map((a) => (
                <TR key={a.adMetaId}>
                  <TD>
                    <p className="font-medium">{a.adName}</p>
                    <p className="text-xs text-muted-foreground">{a.campaignName}</p>
                  </TD>
                  <TD className="text-right">{brl(a.spendCents)}</TD>
                  <TD className="text-right">{num(a.metaConversationsStarted)}</TD>
                  <TD className="text-right">
                    {num(a.leadsOfficial + a.leadsManual)}
                    {a.leadsManual > 0 && <span className="text-xs text-muted-foreground"> ({a.leadsManual} man.)</span>}
                  </TD>
                  <TD className="text-right">{num(a.sales)}</TD>
                  <TD className="text-right">{brl(a.revenueCents)}</TD>
                  <TD className="text-right font-semibold">{roas(a.roas)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
