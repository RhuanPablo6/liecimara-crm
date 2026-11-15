'use client';

import { CalendarClock, ChevronRight, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input, NativeSelect } from '@/components/ui/form';
import { api, useAction, useApi } from '@/lib/api';
import { brl, dateTime, num, parseBRL } from '@/lib/format';
import { cn } from '@/lib/utils';

type Level = 'campaign' | 'adset' | 'ad';
type Preset = 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'month' | 'lastMonth' | 'custom';

const todaySP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const fmtDay = (d: string) => d.split('-').reverse().join('/');

function presetRange(p: Preset, custom: { from: string; to: string }) {
  const t = todaySP();
  switch (p) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday':
      return { from: addDays(t, -1), to: addDays(t, -1) };
    case '7d':
      return { from: addDays(t, -6), to: t };
    case '14d':
      return { from: addDays(t, -13), to: t };
    case '30d':
      return { from: addDays(t, -29), to: t };
    case 'lastMonth': {
      const firstThis = `${t.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
    case 'custom':
      return custom;
    default:
      return { from: `${t.slice(0, 7)}-01`, to: t };
  }
}

/** Veiculação: como o Gerenciador de Anúncios mostra. */
const DELIVERY: Record<string, { label: string; tone: 'on' | 'off' | 'warn' | 'bad' }> = {
  ACTIVE: { label: 'Ativa', tone: 'on' },
  PAUSED: { label: 'Desativada', tone: 'off' },
  CAMPAIGN_PAUSED: { label: 'Campanha desativada', tone: 'off' },
  ADSET_PAUSED: { label: 'Conjunto desativado', tone: 'off' },
  IN_PROCESS: { label: 'Em processamento', tone: 'warn' },
  PENDING_REVIEW: { label: 'Em análise', tone: 'warn' },
  PREAPPROVED: { label: 'Pré-aprovado', tone: 'warn' },
  WITH_ISSUES: { label: 'Com problemas', tone: 'bad' },
  DISAPPROVED: { label: 'Reprovado', tone: 'bad' },
  PENDING_BILLING_INFO: { label: 'Pagamento pendente', tone: 'bad' },
  ARCHIVED: { label: 'Arquivada', tone: 'off' },
  DELETED: { label: 'Excluída', tone: 'off' },
};

function Delivery({ status, stopTime }: { status: string | null; stopTime?: string | null }) {
  const ended = status === 'ACTIVE' && stopTime && new Date(stopTime) < new Date();
  const d = ended ? { label: 'Concluída', tone: 'off' as const } : (DELIVERY[status ?? ''] ?? { label: status ?? '—', tone: 'off' as const });
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span
        className={cn(
          'size-2 rounded-full',
          d.tone === 'on' ? 'bg-emerald-500' : d.tone === 'warn' ? 'bg-amber-500' : d.tone === 'bad' ? 'bg-red-500' : 'bg-slate-300',
        )}
      />
      {d.label}
    </span>
  );
}

/** Interruptor de veiculação (liga/desliga) com o visual do Gerenciador. */
function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
        on ? 'bg-[#1877f2]' : 'bg-slate-300',
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

const pct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const money = (c: number | null) => (c == null ? '—' : brl(c));
const roasText = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`);

type Row = any;

const METRIC_COLS: { key: string; label: string; render: (r: Row) => string; title?: string }[] = [
  { key: 'spend', label: 'Valor usado', render: (r) => brl(r.spendCents) },
  { key: 'impr', label: 'Impressões', render: (r) => num(r.impressions) },
  { key: 'clicks', label: 'Cliques', render: (r) => num(r.clicks) },
  { key: 'ctr', label: 'CTR', render: (r) => pct(r.ctrPct) },
  { key: 'conv', label: 'Conversas iniciadas', render: (r) => num(r.conversations), title: 'Métrica da Meta: conversas por mensagem iniciadas' },
  { key: 'cpc', label: 'Custo por conversa', render: (r) => money(r.costPerConversationCents) },
  { key: 'leads', label: 'Leads (CRM)', render: (r) => num(r.leads), title: 'Leads ligados ao anúncio no CRM (código, escolha manual ou referência oficial)' },
  { key: 'sales', label: 'Vendas', render: (r) => num(r.sales) },
  { key: 'rev', label: 'Faturamento', render: (r) => brl(r.revenueCents) },
  { key: 'roas', label: 'ROAS', render: (r) => roasText(r.roas) },
];

function sumRows(rows: Row[]) {
  const t: any = { spendCents: 0, impressions: 0, clicks: 0, conversations: 0, leads: 0, sales: 0, revenueCents: 0 };
  for (const r of rows) for (const k of Object.keys(t)) t[k] += r[k] ?? 0;
  t.ctrPct = t.impressions ? Math.round((t.clicks / t.impressions) * 10000) / 100 : null;
  t.costPerConversationCents = t.conversations ? Math.round(t.spendCents / t.conversations) : null;
  t.roas = t.spendCents ? Math.round((t.revenueCents / t.spendCents) * 100) / 100 : null;
  return t;
}

// ── Diálogos ──────────────────────────────────────────────────

function ConfirmStatus({ target, onDone }: { target: { level: Level; row: Row; next: 'ACTIVE' | 'PAUSED' }; onDone: (changed: boolean) => void }) {
  const { busy, error, run } = useAction();
  const what = target.level === 'campaign' ? 'campanha' : target.level === 'adset' ? 'conjunto de anúncios' : 'anúncio';
  const on = target.next === 'ACTIVE';
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{on ? `Ativar ${what}?` : `Desativar ${what}?`}</DialogTitle>
      </DialogHeader>
      <p className="text-sm">
        <b>{target.row.name}</b>
      </p>
      <p className="text-sm text-muted-foreground">
        {on
          ? 'A Meta volta a veicular e a gastar o orçamento. Se estiver tudo aprovado, começa em poucos minutos.'
          : `A veiculação para em poucos minutos${target.level === 'campaign' ? ', incluindo todos os conjuntos e anúncios desta campanha' : target.level === 'adset' ? ', incluindo os anúncios deste conjunto' : ''}. Você pode reativar quando quiser.`}
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button
          variant={on ? 'default' : 'destructive'}
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api(`/ads-manager/${target.level}/${target.row.id}/status`, { method: 'POST', body: { status: target.next } });
              onDone(true);
            })
          }
        >
          {busy ? 'Enviando para a Meta…' : on ? 'Ativar' : 'Desativar'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onDone(false)}>
          Cancelar
        </Button>
      </div>
    </DialogContent>
  );
}

function BudgetEditor({ target, onDone }: { target: { level: 'campaign' | 'adset'; row: Row }; onDone: (changed: boolean) => void }) {
  const kind: 'daily' | 'lifetime' = target.row.dailyBudgetCents ? 'daily' : 'lifetime';
  const current: number = kind === 'daily' ? target.row.dailyBudgetCents : target.row.lifetimeBudgetCents;
  const [value, setValue] = useState((current / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  const { busy, error, run } = useAction();
  const cents = parseBRL(value);
  const change = cents ? Math.round(((cents - current) / current) * 1000) / 10 : null;
  const bump = (p: number) => setValue(((Math.round(current * (1 + p / 100)) / 100) as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Editar orçamento {kind === 'daily' ? 'diário' : 'total'}</DialogTitle>
      </DialogHeader>
      <p className="text-sm">
        <b>{target.row.name}</b> · atual: {brl(current)} {kind === 'daily' ? 'por dia' : 'no total'}
      </p>
      <Field label={`Novo orçamento ${kind === 'daily' ? 'diário' : 'total'} (R$)`}>
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {[-20, -10, 10, 20, 50].map((p) => (
          <Button key={p} size="sm" variant="outline" onClick={() => bump(p)}>
            {p > 0 ? '+' : ''}
            {p}%
          </Button>
        ))}
      </div>
      {change != null && change !== 0 && (
        <p className={cn('text-sm', Math.abs(change) > 20 ? 'text-amber-700' : 'text-muted-foreground')}>
          {change > 0 ? 'Aumento' : 'Redução'} de {Math.abs(change).toLocaleString('pt-BR')}%
          {Math.abs(change) > 20 && ': mudanças grandes podem fazer a Meta reiniciar a fase de aprendizado. Prefira subir aos poucos (até 20% por vez).'}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button
          disabled={busy || !cents || cents < 100 || cents === current}
          onClick={() =>
            run(async () => {
              await api(`/ads-manager/${target.level}/${target.row.id}/budget`, { method: 'POST', body: { kind, cents } });
              onDone(true);
            })
          }
        >
          {busy ? 'Enviando para a Meta…' : 'Salvar na Meta'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onDone(false)}>
          Cancelar
        </Button>
      </div>
    </DialogContent>
  );
}

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** Data + hora de São Paulo → instante (Brasil sem horário de verão: UTC−3). */
const spInstant = (day: string, time: string) => new Date(`${day}T${time}:00-03:00`);
const fmtWindow = (d: Date) =>
  d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function ScheduleDialog({ target, onClose }: { target: { level: 'campaign' | 'adset'; row: Row }; onClose: () => void }) {
  const { data: list, error: loadError, reload } = useApi<any[]>(`/ads-manager/${target.level}/${target.row.id}/schedules`);
  const daily: number | null = target.row.dailyBudgetCents;
  const [day, setDay] = useState(addDays(todaySP(), 1));
  const [startTime, setStartTime] = useState('18:00');
  const [endDay, setEndDay] = useState(addDays(todaySP(), 1));
  const [endTime, setEndTime] = useState('23:45');
  const [increase, setIncrease] = useState('');
  const [weeks, setWeeks] = useState('1');
  const act = useAction();
  const del = useAction();

  const inc = parseBRL(increase);
  const windows = useMemo(() => {
    const n = Math.max(1, Math.min(12, Number.parseInt(weeks, 10) || 1));
    return Array.from({ length: n }, (_, i) => ({
      start: spInstant(addDays(day, 7 * i), startTime),
      end: spInstant(addDays(endDay, 7 * i), endTime),
      increaseCents: inc ?? 0,
    }));
  }, [day, startTime, endDay, endTime, weeks, inc]);
  const first = windows[0]!;
  const hours = (first.end.getTime() - first.start.getTime()) / 3_600_000;
  const problem = !daily
    ? 'A programação só funciona com orçamento diário.'
    : hours < 3
      ? 'Cada janela precisa ter pelo menos 3 horas.'
      : first.start <= new Date()
        ? 'O início precisa ser no futuro.'
        : inc && daily + inc > daily * 8
          ? `O orçamento na janela não pode passar de 8× o diário (aumento máximo: ${brl(daily * 7)}).`
          : null;

  return (
    <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Programação de orçamento</DialogTitle>
      </DialogHeader>
      <p className="text-sm">
        <b>{target.row.name}</b> · orçamento diário {daily ? brl(daily) : '—'}
      </p>
      <p className="text-sm text-muted-foreground">
        Aumenta o orçamento durante uma janela (ex.: sexta 18h até sábado 23h) e volta sozinho ao normal depois. A Meta executa a programação
        mesmo com o CRM fechado.
      </p>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Janelas programadas</p>
        <ErrorText>{loadError ?? del.error}</ErrorText>
        {!list && !loadError && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {list && list.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma janela programada.</p>}
        {list?.map((s) => {
          const ended = new Date(s.end) < new Date();
          return (
            <div key={s.id} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm', ended && 'opacity-60')}>
              <span>
                {fmtWindow(new Date(s.start))} → {fmtWindow(new Date(s.end))}
                {ended && ' (encerrada)'}
              </span>
              <span className="flex items-center gap-2">
                <b className="tabular-nums">
                  {s.type === 'ABSOLUTE' ? `+ R$ ${num(s.value)}` : `× ${s.value}`}
                  {s.type === 'ABSOLUTE' && daily ? ` (≈ ${brl(daily + s.value * 100)}/dia)` : ''}
                </b>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Excluir janela"
                  disabled={del.busy}
                  onClick={() =>
                    del.run(async () => {
                      await api(`/ads-manager/${target.level}/${target.row.id}/schedules/${s.id}`, { method: 'DELETE' });
                      await reload();
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </span>
            </div>
          );
        })}
      </div>

      {daily ? (
        <div className="space-y-4 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nova janela</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Começa em">
              <Input
                type="date"
                min={todaySP()}
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  if (endDay < e.target.value) setEndDay(e.target.value);
                }}
              />
            </Field>
            <Field label="às">
              <NativeSelect value={startTime} onChange={(e) => setStartTime(e.target.value)}>
                {TIMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Termina em">
              <Input type="date" min={day} value={endDay} onChange={(e) => setEndDay(e.target.value)} />
            </Field>
            <Field label="às">
              <NativeSelect value={endTime} onChange={(e) => setEndTime(e.target.value)}>
                {TIMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Aumentar o orçamento diário em (R$)">
              <Input inputMode="decimal" placeholder="ex.: 50" value={increase} onChange={(e) => setIncrease(e.target.value)} />
            </Field>
            <Field label="Repetir">
              <NativeSelect value={weeks} onChange={(e) => setWeeks(e.target.value)}>
                <option value="1">Só desta vez</option>
                {[2, 3, 4, 6, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    Toda {WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]}, por {n} semanas
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {inc ? (
            <p className="text-sm text-muted-foreground">
              Durante a janela o orçamento fica em <b className="text-foreground">{brl(daily + inc)}/dia</b> ({hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h).
              {windows.length > 1 && ` Serão criadas ${windows.length} janelas, uma por semana.`}
            </p>
          ) : null}
          {problem && <p className="text-sm text-amber-700">{problem}</p>}
          <ErrorText>{act.error}</ErrorText>
          <Button
            disabled={act.busy || !!problem || !inc}
            onClick={() =>
              act.run(async () => {
                await api(`/ads-manager/${target.level}/${target.row.id}/schedules`, {
                  method: 'POST',
                  body: { windows: windows.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString(), increaseCents: w.increaseCents })) },
                });
                setIncrease('');
                await reload();
              })
            }
          >
            {act.busy ? 'Enviando para a Meta…' : windows.length > 1 ? `Criar ${windows.length} janelas` : 'Criar janela'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Regras da Meta: janelas de no mínimo 3 h, horários de 15 em 15 min, até 50 por campanha e no máximo 8× o orçamento diário. Na primeira
            vez, confira no Gerenciador da Meta (orçamento da campanha → Programação de orçamento) se o valor ficou igual.
          </p>
        </div>
      ) : (
        <p className="text-sm text-amber-700">Esta campanha usa orçamento total; a Meta só permite programação com orçamento diário.</p>
      )}
      <Button variant="ghost" onClick={onClose}>
        Fechar
      </Button>
    </DialogContent>
  );
}

// ── Gerenciador ───────────────────────────────────────────────

export function AdsManager() {
  const [level, setLevel] = useState<Level>('campaign');
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState({ from: `${todaySP().slice(0, 7)}-01`, to: todaySP() });
  const [accountId, setAccountId] = useState('');
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [selCampaigns, setSelCampaigns] = useState<Set<string>>(new Set());
  const [selAdSets, setSelAdSets] = useState<Set<string>>(new Set());
  const [statusTarget, setStatusTarget] = useState<any>(null);
  const [budgetTarget, setBudgetTarget] = useState<any>(null);
  const [scheduleTarget, setScheduleTarget] = useState<any>(null);
  const sync = useAction();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const { from, to } = presetRange(preset, custom);
  const qs = new URLSearchParams({ from, to, ...(accountId ? { accountId } : {}), ...(archived ? { includeArchived: 'true' } : {}) });
  const { data, error, reload, loading } = useApi<any>(`/ads-manager?${qs}`);

  useEffect(() => {
    setSelCampaigns(new Set());
    setSelAdSets(new Set());
  }, [accountId]);

  const q = search.trim().toLowerCase();
  const match = (r: Row) => !q || r.name.toLowerCase().includes(q) || (r.code ?? '').toLowerCase() === q;
  const campaigns: Row[] = (data?.campaigns ?? []).filter(match);
  const adSets: Row[] = (data?.adSets ?? []).filter((s: Row) => (!selCampaigns.size || selCampaigns.has(s.campaignId)) && match(s));
  const ads: Row[] = (data?.ads ?? []).filter(
    (a: Row) => (!selCampaigns.size || selCampaigns.has(a.campaignId)) && (!selAdSets.size || selAdSets.has(a.adSetId)) && match(a),
  );
  const rows = level === 'campaign' ? campaigns : level === 'adset' ? adSets : ads;
  const sorted = [...rows].sort(
    (a, b) => Number(b.effectiveStatus === 'ACTIVE') - Number(a.effectiveStatus === 'ACTIVE') || b.spendCents - a.spendCents || a.name.localeCompare(b.name, 'pt-BR'),
  );
  const totals = sumRows(rows);
  const sel = level === 'campaign' ? selCampaigns : level === 'adset' ? selAdSets : null;
  const setSel = level === 'campaign' ? setSelCampaigns : setSelAdSets;

  const toggleSel = (id: string) =>
    setSel((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const close = async (changed: boolean) => {
    setStatusTarget(null);
    setBudgetTarget(null);
    if (changed) await reload();
  };

  const tabs: { key: Level; label: string; count: number }[] = [
    { key: 'campaign', label: 'Campanhas', count: selCampaigns.size },
    { key: 'adset', label: 'Conjuntos de anúncios', count: selAdSets.size },
    { key: 'ad', label: 'Anúncios', count: 0 },
  ];
  const noun = level === 'campaign' ? 'campanhas' : level === 'adset' ? 'conjuntos de anúncios' : 'anúncios';

  return (
    <div className="space-y-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-2">
        {(data?.accounts?.length ?? 0) > 1 && (
          <NativeSelect aria-label="Conta de anúncios" className="w-56" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Todas as contas</option>
            {data.accounts.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Pesquisar por nome ou código" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-navy-700" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Mostrar arquivadas
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Período" className="w-48" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="14d">Últimos 14 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="month">Este mês</option>
            <option value="lastMonth">Mês passado</option>
            <option value="custom">Personalizado…</option>
          </NativeSelect>
          {preset === 'custom' ? (
            <>
              <Input type="date" aria-label="De" className="w-40" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <Input type="date" aria-label="Até" className="w-40" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {fmtDay(from)}
              {from !== to && ` – ${fmtDay(to)}`}
            </span>
          )}
          <Button
            variant="outline"
            disabled={sync.busy}
            onClick={() =>
              sync.run(async () => {
                await api('/ads-manager/sync', { method: 'POST' });
                setSyncMsg('Atualizando com a Meta… os números aparecem em até 1 minuto.');
                setTimeout(() => void reload(), 15_000);
                setTimeout(() => (void reload(), setSyncMsg(null)), 45_000);
              })
            }
          >
            <RefreshCw className={cn(sync.busy && 'animate-spin')} /> Atualizar
          </Button>
        </div>
      </div>
      {(syncMsg || data?.lastSyncAt) && (
        <p className="text-xs text-muted-foreground">{syncMsg ?? `Dados da Meta atualizados em ${dateTime(data.lastSyncAt)}. Status e orçamento mudam na hora quando alterados por aqui.`}</p>
      )}
      <ErrorText>{error ?? sync.error}</ErrorText>

      {/* Abas de nível */}
      <div className="flex flex-wrap border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setLevel(t.key)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              level === t.key ? 'border-[#1877f2] text-[#1877f2]' : 'border-transparent text-muted-foreground hover:text-navy-800',
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#1877f2] px-2 py-0.5 text-xs text-white">
                {t.count} selecionado(s)
                <span
                  role="button"
                  aria-label="Limpar seleção"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (t.key === 'campaign') setSelCampaigns(new Set());
                    else setSelAdSets(new Set());
                  }}
                >
                  ×
                </span>
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full min-w-[1400px] text-sm">
          <thead className="bg-secondary/60 text-left text-xs text-muted-foreground">
            <tr>
              {sel && <th className="w-10 px-3 py-2" />}
              <th className="w-20 px-3 py-2 font-medium">Desativar / Ativar</th>
              <th className="min-w-[260px] px-3 py-2 font-medium">{level === 'campaign' ? 'Campanha' : level === 'adset' ? 'Conjunto de anúncios' : 'Anúncio'}</th>
              <th className="px-3 py-2 font-medium">Veiculação</th>
              {level !== 'ad' && <th className="px-3 py-2 font-medium">Orçamento</th>}
              {METRIC_COLS.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium" title={c.title}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={20} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {data && sorted.length === 0 && (
              <tr>
                <td colSpan={20} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum resultado. Se você acabou de conectar a Meta, clique em Atualizar.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const on = r.status === 'ACTIVE';
              return (
                <tr key={r.id} className={cn('border-t hover:bg-secondary/40', sel?.has(r.id) && 'bg-[#1877f2]/5')}>
                  {sel && (
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Selecionar ${r.name}`} className="size-4 accent-[#1877f2]" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Toggle
                      on={on}
                      disabled={r.status === 'ARCHIVED' || r.status === 'DELETED'}
                      label={on ? `Desativar ${r.name}` : `Ativar ${r.name}`}
                      onClick={() => setStatusTarget({ level, row: r, next: on ? 'PAUSED' : 'ACTIVE' })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {level !== 'ad' ? (
                      <button
                        className="group flex items-center gap-1 text-left font-medium text-[#1877f2] hover:underline"
                        onClick={() => {
                          if (level === 'campaign') {
                            setSelCampaigns(new Set([r.id]));
                            setLevel('adset');
                          } else {
                            setSelAdSets(new Set([r.id]));
                            setLevel('ad');
                          }
                        }}
                        title={level === 'campaign' ? 'Ver conjuntos desta campanha' : 'Ver anúncios deste conjunto'}
                      >
                        {r.name}
                        <ChevronRight className="size-3.5 opacity-0 group-hover:opacity-100" />
                      </button>
                    ) : (
                      <span className="font-medium">
                        {r.name}
                        {r.code && (
                          <Badge variant="secondary" className="ml-2 font-mono">
                            {r.code}
                          </Badge>
                        )}
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {level === 'campaign'
                        ? `${num(r.adSets)} conjunto(s) · ${num(r.ads)} anúncio(s)`
                        : level === 'adset'
                          ? r.campaignName
                          : `${r.campaignName ?? ''} › ${r.adSetName ?? ''}`}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <Delivery status={r.effectiveStatus} stopTime={r.stopTime} />
                  </td>
                  {level !== 'ad' && (
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.dailyBudgetCents || r.lifetimeBudgetCents ? (
                        <div className="flex items-center gap-1">
                          <div>
                            <p className="tabular-nums">{brl(r.dailyBudgetCents ?? r.lifetimeBudgetCents)}</p>
                            <p className="text-xs text-muted-foreground">{r.dailyBudgetCents ? 'Diário' : 'Total'}</p>
                          </div>
                          <Button size="icon" variant="ghost" className="size-7" aria-label="Editar orçamento" onClick={() => setBudgetTarget({ level, row: r })}>
                            <Pencil className="size-3.5" />
                          </Button>
                          {r.dailyBudgetCents && (
                            <Button size="icon" variant="ghost" className="size-7" aria-label="Programação de orçamento" title="Programação de orçamento" onClick={() => setScheduleTarget({ level, row: r })}>
                              <CalendarClock className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{level === 'adset' && r.usesCampaignBudget ? 'Usando orçamento da campanha' : 'Orçamento nos conjuntos'}</span>
                      )}
                    </td>
                  )}
                  {METRIC_COLS.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 bg-secondary/40 text-sm font-medium">
              <tr>
                {sel && <td />}
                <td />
                <td className="px-3 py-2">
                  Resultados de {num(sorted.length)} {noun}
                </td>
                <td />
                {level !== 'ad' && <td />}
                {METRIC_COLS.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {c.render(totals)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Valor usado, impressões, cliques e conversas vêm da Meta. Leads, vendas, faturamento e ROAS vêm do CRM (anúncio informado no lead ou na venda).
      </p>

      <Dialog open={!!statusTarget} onOpenChange={(v) => !v && setStatusTarget(null)}>
        {statusTarget && <ConfirmStatus key={statusTarget.row.id} target={statusTarget} onDone={close} />}
      </Dialog>
      <Dialog open={!!budgetTarget} onOpenChange={(v) => !v && setBudgetTarget(null)}>
        {budgetTarget && <BudgetEditor key={budgetTarget.row.id} target={budgetTarget} onDone={close} />}
      </Dialog>
      <Dialog open={!!scheduleTarget} onOpenChange={(v) => !v && setScheduleTarget(null)}>
        {scheduleTarget && <ScheduleDialog key={scheduleTarget.row.id} target={scheduleTarget} onClose={() => setScheduleTarget(null)} />}
      </Dialog>
    </div>
  );
}
