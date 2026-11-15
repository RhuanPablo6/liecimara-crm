import { Badge } from '@/components/ui/badge';

export type Stage = 'NEW' | 'CONTACTED' | 'SCHEDULED' | 'ATTENDED' | 'WON' | 'LOST';
export type Confidence = 'OFFICIAL_REFERRAL' | 'MANUAL' | 'UNKNOWN';

export const STAGES: { value: Stage; label: string }[] = [
  { value: 'NEW', label: 'Novo' },
  { value: 'CONTACTED', label: 'Em atendimento' },
  { value: 'SCHEDULED', label: 'Agendado' },
  { value: 'ATTENDED', label: 'Compareceu' },
  { value: 'WON', label: 'Venda realizada' },
  { value: 'LOST', label: 'Perdido' },
];

export const LOST_REASONS = [
  { value: 'PRICE', label: 'Preço' },
  { value: 'NO_RESPONSE', label: 'Parou de responder' },
  { value: 'CHOSE_COMPETITOR', label: 'Escolheu outra clínica' },
  { value: 'NOT_A_CANDIDATE', label: 'Sem indicação' },
  { value: 'SCHEDULE_CONFLICT', label: 'Agenda incompatível' },
  { value: 'JUST_RESEARCHING', label: 'Apenas pesquisando' },
  { value: 'OTHER', label: 'Outro' },
] as const;

const stageVariant: Record<Stage, 'secondary' | 'default' | 'gold' | 'success' | 'danger' | 'warning'> = {
  NEW: 'gold',
  CONTACTED: 'secondary',
  SCHEDULED: 'default',
  ATTENDED: 'warning',
  WON: 'success',
  LOST: 'danger',
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge variant={stageVariant[stage]}>{STAGES.find((s) => s.value === stage)?.label ?? stage}</Badge>;
}

const confidence: Record<Confidence, { label: string; short: string; variant: 'success' | 'warning' | 'outline' }> = {
  OFFICIAL_REFERRAL: { label: 'Confirmada por referência oficial', short: 'Oficial', variant: 'success' },
  MANUAL: { label: 'Informada manualmente', short: 'Manual', variant: 'warning' },
  UNKNOWN: { label: 'Origem desconhecida', short: 'Desconhecida', variant: 'outline' },
};

export function ConfidenceBadge({ value, long = false }: { value: Confidence; long?: boolean }) {
  const c = confidence[value];
  return (
    <Badge variant={c.variant} title={c.label}>
      {long ? c.label : c.short}
    </Badge>
  );
}
