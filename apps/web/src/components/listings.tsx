'use client';

import Link from 'next/link';
import { categoryMeta, quote } from '@trenchmart/shared';
import { Money, Skeleton, EmptyState, Tag } from '@/components/ui';
import type { PublicConfig } from '@/lib/config';

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

export type Pricing = {
  centsPerSol: string | null;
  config?: PublicConfig | null;
  /** Buyer tier when connected; undefined shows list price with the fee note. */
  tier?: string;
};

export function ListingCard({ listing, pricing }: { listing: Listing; pricing: Pricing }) {
  const meta = categoryMeta(listing.category);
  const connected = pricing.tier !== undefined && pricing.config;
  const total = connected
    ? quote(
        BigInt(listing.price),
        pricing.config!.feeBps,
        pricing.config!.tierRebateBps[pricing.tier!] ?? 0,
      ).total
    : null;
  const rating = listing.ratingAvg ? Number(listing.ratingAvg) : null;
  return (
    <Link
      data-testid="listing-card"
      href={`/l/${listing.slug}`}
      className="motion-card group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface hover:border-line-strong"
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3"
        style={{ background: meta.bg }}
      >
        <span
          className="font-mono text-[11px] font-semibold tracking-wide"
          style={{ color: meta.color }}
        >
          {meta.tag}
        </span>
        <Tag tone="ok">
          <span aria-hidden="true">✓</span> AI-VERIFIED
        </Tag>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="m-0 text-[17px] font-semibold leading-snug tracking-[-0.01em] group-hover:text-accent-hover">
          {listing.title}
        </h3>
        <p className="m-0 line-clamp-2 text-sm text-ink-2">{listing.summary}</p>
        {listing.terminals.length ? (
          <p className="m-0 font-mono text-[11px] text-muted">{listing.terminals.join(' · ')}</p>
        ) : null}
        <div className="mt-auto flex items-center gap-3 pt-2 text-[13px] text-muted">
          {listing.handle ? <span className="text-ink-2">@{listing.handle}</span> : null}
          {listing.sales7d ? <span>{listing.sales7d} sold this week</span> : null}
          {rating ? (
            <span>
              <span aria-hidden="true">★</span> {rating.toFixed(1)}
              <span className="sr-only"> out of 5</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 border-t border-line-soft bg-inset px-4 py-3">
        {total !== null ? (
          <div className="min-w-0">
            <p className="m-0 font-mono text-[11px] uppercase tracking-wide text-muted">You pay</p>
            <Money lamports={total} centsPerSol={pricing.centsPerSol} strong />
          </div>
        ) : (
          <div className="min-w-0">
            <Money lamports={listing.price} centsPerSol={pricing.centsPerSol} strong />
            <p className="m-0 text-xs text-muted">+ 5% buyer fee · your tier can cut it</p>
          </div>
        )}
        <span className="shrink-0 font-mono text-xs text-accent" aria-hidden="true">
          View →
        </span>
      </div>
    </Link>
  );
}

export function ListingGrid({
  listings,
  centsPerSol,
  config,
  tier,
  loading = false,
  emptyTitle = 'No live listings yet',
  emptyBody = 'Every listing passes AI verification before it shows here. Check back soon, or be the first to sell.',
}: {
  listings: Listing[];
  centsPerSol: string | null;
  config?: PublicConfig | null;
  tier?: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (loading) {
    return (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((key) => (
          <li key={key} className="rounded-card border border-line bg-surface p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-5 w-3/4" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-8 h-5 w-1/3" />
          </li>
        ))}
      </ul>
    );
  }
  if (listings.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        body={emptyBody}
        action={
          <Link href="/sell" className="text-sm text-accent underline-offset-4 hover:underline">
            Sell your tooling →
          </Link>
        }
      />
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((listing) => (
        <li key={listing.slug}>
          <ListingCard listing={listing} pricing={{ centsPerSol, config, tier }} />
        </li>
      ))}
    </ul>
  );
}

export const TERMINALS = ['All', 'Axiom', 'GMGN', 'Photon', 'BullX', 'Padre'] as const;
