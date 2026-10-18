'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { Listing } from '@/components/listings';
import { MARKET_WRAP, MarketGrid, PageHero } from '@/components/market';
import { Serif } from '@/components/ui';
import { api } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

function Results() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const wallet = useWallet();
  const config = usePublicConfig();
  const cents = useSolUsd();
  const [listings, setListings] = useState<Listing[] | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    setListings(null);
    void api<Listing[]>(`/listings?${query.toString()}`)
      .then(setListings)
      .catch(() => setListings([]));
  }, [q, wallet.session?.wallet]);

  return (
    <>
      <PageHero
        eyebrow={q ? 'Search' : 'Explore'}
        title={
          q ? (
            <>
              Results for <Serif>“{q}”</Serif>
            </>
          ) : (
            <>
              All live <Serif>listings</Serif>
            </>
          )
        }
        sub="Every listing passed a static scan and an AI review before it showed up here; scripts also ran in a sandbox."
      />
      <MarketGrid
        listings={listings}
        query={q || undefined}
        centsPerSol={cents}
        config={config}
        tier={wallet.session?.tier}
        onConnect={wallet.session ? undefined : () => void wallet.connect()}
      />
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className={`${MARKET_WRAP} min-h-[70vh] space-y-3 py-14`}>
          <p className="sr-only">Searching…</p>
          <span className="skeleton block h-8 w-48" />
          <span className="skeleton block h-36 w-full" />
        </div>
      }
    >
      <Results />
    </Suspense>
  );
}
