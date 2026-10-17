'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, Label, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useSolUsd } from '@/lib/config';

type Creator = { handle: string | null; wallet: string; volume: string; listings: number };

export default function CreatorsPage() {
  const cents = useSolUsd();
  const [creators, setCreators] = useState<Creator[] | null>(null);
  useEffect(() => {
    void api<Creator[]>('/creators/top')
      .then(setCreators)
      .catch(() => setCreators([]));
  }, []);
  return (
    <section className="space-y-6">
      <div>
        <Label>Creators</Label>
        <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.03em]">
          Top verified creators
        </h1>
        <p className="m-0 mt-1 text-ink-2">
          Ranked by sales volume. Every creator posts a SOL bond.
        </p>
      </div>
      {creators === null ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-14 w-full" />
          ))}
        </div>
      ) : creators.length === 0 ? (
        <EmptyState
          title="No creators with live listings yet."
          body="Creators appear here once a listing passes AI verification."
        />
      ) : (
        <ol className="m-0 space-y-2 p-0">
          {creators.map((creator, index) => (
            <li key={creator.wallet} className="list-none">
              <Link
                href={`/u/${creator.handle ?? creator.wallet}`}
                className="flex items-center justify-between gap-4 rounded-card border border-line bg-surface px-4 py-3 hover:border-line-strong"
              >
                <span className="flex items-center gap-3">
                  <span className="w-6 font-mono text-sm text-muted">{index + 1}</span>
                  <span className="font-medium">
                    @{creator.handle ?? creator.wallet.slice(0, 4)}
                  </span>
                  <span className="text-sm text-muted">
                    {creator.listings} listing{creator.listings === 1 ? '' : 's'}
                  </span>
                </span>
                <Money lamports={creator.volume} centsPerSol={cents} className="text-sm" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
