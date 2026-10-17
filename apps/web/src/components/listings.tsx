'use client';

import Link from 'next/link';
import { moneyText, usdFor } from '@/lib/money';

export type Listing = {
  id?: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  terminals: string[];
  price: string;
  handle?: string;
  ratingAvg?: string | null;
  sales7d?: number;
  lockedUntil?: string | null;
};

export function ListingGrid({
  listings,
  centsPerSol,
}: {
  listings: Listing[];
  centsPerSol: string | null;
}) {
  if (listings.length === 0) {
    return <p className="text-muted">No live listings yet.</p>;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((listing) => (
        <li key={listing.slug}>
          <Link
            data-testid="listing-card"
            href={`/l/${listing.slug}`}
            className="block h-full rounded-xl border border-line bg-surface p-4"
          >
            <p className="text-xs uppercase tracking-wide text-muted">{listing.category}</p>
            <h3 className="mt-2 text-lg">{listing.title}</h3>
            <p className="mt-2 text-sm text-muted">{listing.summary}</p>
            <p className="mt-4 font-mono text-sm">
              {moneyText(listing.price, usdFor(listing.price, centsPerSol))}
            </p>
            {listing.handle ? <p className="mt-1 text-xs text-faint">@{listing.handle}</p> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export const TERMINALS = ['All', 'Axiom', 'GMGN', 'Photon', 'BullX', 'Padre'] as const;
