'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ListingGrid, type Listing } from '@/components/listings';
import { api } from '@/lib/api';

export default function CategoryPage() {
  const params = useParams<{ category: string }>();
  const [listings, setListings] = useState<Listing[]>([]);
  const [cents, setCents] = useState<string | null>(null);

  useEffect(() => {
    void api<Listing[]>(`/listings?category=${params.category}`)
      .then(setListings)
      .catch(() => setListings([]));
    void api<{ centsPerSol: string | null }>('/prices/sol').then((price) =>
      setCents(price.centsPerSol),
    );
  }, [params.category]);

  return (
    <section>
      <h1 className="text-3xl capitalize">{params.category.replace('_', ' ')}</h1>
      <div className="mt-6">
        <ListingGrid listings={listings} centsPerSol={cents} />
      </div>
    </section>
  );
}
