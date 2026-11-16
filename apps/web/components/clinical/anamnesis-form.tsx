'use client';

// Perguntas da anamnese (Sim/Não com detalhe, e campos abertos). Usada no link da paciente e na consulta.
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Answers = Record<string, { a: string; detail?: string | null }>;
export interface AnamnesisSection {
  title: string;
  items: { id: string; q: string; type: 'yesno' | 'text'; alertOnYes?: boolean; detail?: string }[];
}

export const missingCount = (template: AnamnesisSection[], answers: Answers) =>
  template.flatMap((s) => s.items).filter((q) => q.type === 'yesno' && answers[q.id]?.a !== 'Sim' && answers[q.id]?.a !== 'Não').length;

export function AnamnesisForm({
  template,
  answers,
  onChange,
  showAlerts = false,
  highlightMissing = false,
}: {
  template: AnamnesisSection[];
  answers: Answers;
  onChange: (a: Answers) => void;
  /** Mostra o ícone de alerta (só para a equipe). */
  showAlerts?: boolean;
  highlightMissing?: boolean;
}) {
  const set = (id: string, patch: { a?: string; detail?: string }) => onChange({ ...answers, [id]: { a: answers[id]?.a ?? '', detail: answers[id]?.detail ?? null, ...patch } });
  return (
    <div className="space-y-6">
      {template.map((s) => (
        <section key={s.title} className="space-y-3">
          <h3 className="border-b border-gold-300 pb-1 font-serif text-lg text-navy-800">{s.title}</h3>
          {s.items.map((q) => {
            const a = answers[q.id]?.a ?? '';
            const missing = highlightMissing && q.type === 'yesno' && a !== 'Sim' && a !== 'Não';
            return (
              <div key={q.id} className={cn('rounded-lg px-1 py-1', missing && 'bg-red-50 ring-1 ring-red-200')}>
                <p className="text-sm text-navy-900">
                  {q.q}
                  {showAlerts && q.alertOnYes && a === 'Sim' && <AlertTriangle className="ml-1 inline size-4 text-red-600" />}
                </p>
                {q.type === 'yesno' ? (
                  <div className="mt-1.5 flex gap-2">
                    {['Não', 'Sim'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set(q.id, { a: opt })}
                        className={cn(
                          'min-w-20 rounded-full border px-4 py-1.5 text-sm transition-colors',
                          a === opt ? (opt === 'Sim' ? 'border-navy-800 bg-navy-800 text-white' : 'border-navy-800 bg-navy-50 text-navy-800') : 'bg-white hover:bg-slate-50',
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : null}
                {(q.type === 'text' || (q.detail && a === 'Sim')) && (
                  <textarea
                    rows={q.type === 'text' ? 2 : 1}
                    value={(q.type === 'text' ? a : answers[q.id]?.detail) ?? ''}
                    onChange={(e) => (q.type === 'text' ? set(q.id, { a: e.target.value }) : set(q.id, { detail: e.target.value }))}
                    placeholder={q.type === 'text' ? 'Escreva aqui' : q.detail}
                    maxLength={2000}
                    className="mt-1.5 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Mostra uma anamnese já respondida (somente leitura). */
export function AnamnesisAnswers({ sections }: { sections: any[] }) {
  return (
    <div className="space-y-5">
      {sections.map((s: any) => (
        <section key={s.title}>
          <h3 className="mb-2 border-b border-gold-300 pb-1 font-serif text-lg text-navy-800">{s.title}</h3>
          <dl className="divide-y divide-slate-100">
            {s.items.map((i: any) => (
              <div key={i.id ?? i.q} className={cn('grid gap-1 py-1.5 text-sm sm:grid-cols-[1fr_auto]', i.alert && 'rounded bg-red-50 px-2')}>
                <dt className="text-slate-700">
                  {i.alert && <AlertTriangle className="mr-1 inline size-3.5 text-red-600" />}
                  {i.q}
                </dt>
                <dd className={cn('font-medium sm:text-right', i.alert && 'text-red-800')}>
                  {i.a ?? '—'}
                  {i.detail && <span className="block text-xs font-normal text-slate-600 sm:max-w-xs">{i.detail}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
