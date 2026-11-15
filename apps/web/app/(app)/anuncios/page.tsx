'use client';

import { useState } from 'react';
import { AdCodesPanel } from '@/components/ads/codes-panel';
import { AdsManager } from '@/components/ads/ads-manager';
import { cn } from '@/lib/utils';

export default function AdsPage() {
  const [tab, setTab] = useState<'manager' | 'codes'>('manager');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-navy-800">Anúncios</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Gerencie as campanhas da Meta sem sair do CRM: ative ou desative, ajuste orçamentos e programe aumentos de orçamento, vendo junto os
          leads e as vendas que cada anúncio trouxe.
        </p>
      </div>
      <div className="inline-flex rounded-lg bg-secondary p-1" role="tablist">
        {(
          [
            ['manager', 'Gerenciador'],
            ['codes', 'Códigos e procedimentos'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === k ? 'bg-background text-navy-800 shadow' : 'text-muted-foreground hover:text-navy-700',
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'manager' ? <AdsManager /> : <AdCodesPanel />}
    </div>
  );
}
