'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ListingCard, type Listing } from '@/components/listings';
import { Label } from '@/components/ui';
import { api } from '@/lib/api';
import { recentRead, rememberRead } from '@/lib/recent';
import type { PublicConfig } from '@/lib/config';

/** Today's paid "Featured · Sponsored" listings for a placement (hourly rotation, server side). */
export function useFeatured(placement: 'home' | 'category', category?: string) {
  const key = `featured|${placement}|${category ?? ''}`;
  const [items, setItems] = useState<Listing[]>(() => recentRead<Listing[]>(key) ?? []);
  useEffect(() => {
    let stop = false;
    const query = new URLSearchParams({ placement });
    if (category) query.set('category', category);
    void api<{ items: Listing[] }>(`/featured?${query}`)
      .then(
        (body) =>
          !stop && setItems(rememberRead(key, Array.isArray(body?.items) ? body.items : [])),
      )
      .catch(() => !stop && setItems([]));
    return () => {
      stop = true;
    };
  }, [key, placement, category]);
  return items;
}

/** Renders nothing when no slot is booked today. Always labelled as paid placement. */
export function FeaturedRow({
  items,
  centsPerSol,
  config,
  tier,
}: {
  items: Listing[];
  centsPerSol: string | null;
  config?: PublicConfig | null;
  tier?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section data-testid="featured-row" aria-labelledby="featured-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label className="text-warn">Featured</Label>
          <h2 id="featured-heading" className="m-0 mt-1 text-2xl font-semibold tracking-[-0.02em]">
            Featured today
          </h2>
        </div>
        <p className="m-0 max-w-md text-right text-xs text-muted">
          Paid placements. Same automated review as every listing.{' '}
          <Link
            href="/studio/featuring#featuring-policy"
            className="text-accent hover:text-accent-hover"
          >
            How featuring works →
          </Link>
        </p>
      </div>
      <ul className="m-0 grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((listing) => (
          <li key={listing.slug} className="list-none">
            <ListingCard listing={listing} pricing={{ centsPerSol, config, tier }} />
          </li>
        ))}
      </ul>
      <p className="m-0 font-mono text-[11px] text-muted">
        Fixed price per day · featuring never changes rank or reviews · the leaderboard is organic
      </p>
    </section>
  );
}
