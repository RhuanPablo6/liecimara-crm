'use client';

import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/form';
import { api, useAction } from '@/lib/api';

export const TAG_LABEL: Record<string, string> = { NEW: 'Paciente novo', WALLET: 'Da carteira' };

export function PatientTagBadge({ tag }: { tag: string }) {
  return (
    <Badge variant={tag === 'WALLET' ? 'gold' : 'secondary'} className="ml-1.5 whitespace-nowrap align-middle">
      {TAG_LABEL[tag] ?? tag}
    </Badge>
  );
}

/** Etiqueta novo/carteira com troca manual (ou volta para automática). */
export function PatientTagControl({
  contactId,
  tag,
  manual,
  onChanged,
}: {
  contactId: string;
  tag: string;
  manual: boolean;
  onChanged: () => void;
}) {
  const { busy, run } = useAction();
  const value = manual ? (tag === 'WALLET' ? 'WALLET' : 'NEW') : 'AUTO';
  return (
    <div className="flex items-center gap-2">
      <PatientTagBadge tag={tag} />
      <NativeSelect
        aria-label="Etiqueta do paciente"
        className="h-7 w-auto py-0 text-xs"
        value={value}
        disabled={busy}
        onChange={(e) =>
          run(async () => {
            const v = e.target.value;
            await api(`/patients/${contactId}/tag`, { method: 'PATCH', body: { walletPatient: v === 'AUTO' ? null : v === 'WALLET' } });
            onChanged();
          })
        }
      >
        <option value="AUTO">Automático (já comprou = carteira)</option>
        <option value="NEW">Marcar como paciente novo</option>
        <option value="WALLET">Marcar como da carteira</option>
      </NativeSelect>
    </div>
  );
}
