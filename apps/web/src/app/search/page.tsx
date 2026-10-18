'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ListingGrid, type Listing } from '@/components/listings';
import { Label, PreviewNotice } from '@/components/ui';
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
    <section className="min-h-[70vh] space-y-6">
      <div>
        <Label>Search</Label>
        <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.03em]">
          {q ? `Results for “${q}”` : 'All live listings'}
        </h1>
        {/* The line is always there so the grid below does not move when the count arrives. */}
        <p className="m-0 mt-1 min-h-5 text-sm text-muted">
          {listings
            ? `${listings.length} reviewed listing${listings.length === 1 ? '' : 's'}`
            : '\u00a0'}
        </p>
      </div>
      {!wallet.session ? <PreviewNotice onConnect={() => void wallet.connect()} /> : null}
      <ListingGrid
        listings={listings ?? []}
        loading={listings === null}
        centsPerSol={cents}
        config={config}
        tier={wallet.session?.tier}
        emptyTitle={q ? `Nothing matches “${q}”` : undefined}
        emptyBody={q ? 'Try a terminal name, a category, or fewer words.' : undefined}
      />
    </section>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="min-h-[70vh] space-y-3">
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
