'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ListingGrid, type Listing } from '@/components/listings';
import { api } from '@/lib/api';

function Results() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [listings, setListings] = useState<Listing[]>([]);
  const [cents, setCents] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    void api<Listing[]>(`/listings?${query.toString()}`)
      .then(setListings)
      .catch(() => setListings([]));
    void api<{ centsPerSol: string | null }>('/prices/sol').then((price) =>
      setCents(price.centsPerSol),
    );
  }, [q]);

  return (
    <section>
      <h1 className="text-3xl">Search</h1>
      <p className="mt-2 text-muted">{q ? `Results for “${q}”` : 'All live listings'}</p>
      <div className="mt-6">
        <ListingGrid listings={listings} centsPerSol={cents} />
      </div>
    </section>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p>Searching…</p>}>
      <Results />
    </Suspense>
  );
}
