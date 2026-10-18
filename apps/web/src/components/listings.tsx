'use client';

import Link from 'next/link';
import { categoryMeta, quote, rankBadge, TERMINALS as TERMINAL_NAMES } from '@trenchmart/shared';
import { TerminalNames } from '@/components/terminal-logo';
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
  /** Seller-chosen cover from the listing gallery (approved content only). */
  cover?: { url: string; alt: string } | null;
  imageCount?: number;
  /** Raw upvote count (every wallet); ranking uses the weighted count. */
  upvotes?: number;
  /** Ranking job output; null until the listing has counted sales or upvotes. */
  rank?: { category: number | null; overall: number | null } | null;
};

export type Pricing = {
  centsPerSol: string | null;
  config?: PublicConfig | null;
  /** Buyer tier when connected; undefined shows list price with the fee note. */
  tier?: string;
};

export function ListingCard({
  listing,
  pricing,
  priority = false,
}: {
  listing: Listing;
  pricing: Pricing;
  /** Above-the-fold cards load their cover eagerly (it is the LCP image). */
  priority?: boolean;
}) {
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
      <CardCover
        listing={listing}
        color={meta.color}
        bg={meta.bg}
        tag={meta.tag}
        priority={priority}
      />
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
        <span className="flex items-center gap-1.5">
          {rankBadge(listing.rank?.category, meta.label) ? (
            <Tag tone="info" data-testid="rank-badge">
              {rankBadge(listing.rank?.category, meta.label)}
            </Tag>
          ) : null}
          <Tag tone="ok">
            <span aria-hidden="true">✓</span> REVIEWED
          </Tag>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="m-0 text-[17px] font-semibold leading-snug tracking-[-0.01em] group-hover:text-accent-hover">
          {listing.title}
        </h3>
        <p className="m-0 line-clamp-2 text-sm text-ink-2">{listing.summary}</p>
        {listing.terminals.length ? (
          <p className="m-0 font-mono text-[11px] text-muted" data-testid="card-terminals">
            <TerminalNames names={listing.terminals} />
          </p>
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
          {listing.upvotes ? (
            <span data-testid="card-upvotes" className="ml-auto font-mono text-xs">
              <span aria-hidden="true">▲</span> {listing.upvotes}
              <span className="sr-only"> upvotes</span>
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

function CardCover({
  listing,
  color,
  bg,
  tag,
  priority = false,
}: {
  priority?: boolean;
  listing: Listing;
  color: string;
  bg: string;
  tag: string;
}) {
  return (
    <div
      data-testid="card-cover"
      className="relative aspect-[16/10] overflow-hidden border-b border-line-soft bg-inset"
    >
      {listing.cover ? (
        <img
          src={listing.cover.url}
          alt={listing.cover.alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div
          aria-hidden="true"
          className="grid h-full w-full place-items-center"
          style={{ background: `radial-gradient(120% 90% at 20% 0%, ${bg} 0%, transparent 60%)` }}
        >
          <span className="font-mono text-[13px] font-semibold tracking-[0.2em]" style={{ color }}>
            {tag}
          </span>
        </div>
      )}
      {listing.imageCount && listing.imageCount > 1 ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-tag border border-line bg-bg/80 px-2 py-0.5 font-mono text-[11px] text-ink-2 backdrop-blur">
          <span aria-hidden="true">▦</span> {listing.imageCount}
          <span className="sr-only"> images</span>
        </span>
      ) : null}
    </div>
  );
}

export function ListingGrid({
  listings,
  centsPerSol,
  config,
  tier,
  loading = false,
  emptyTitle = 'No live listings yet',
  emptyBody = 'Every listing passes automated review before it shows here. Check back soon, or be the first to sell.',
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
          <li key={key} className="overflow-hidden rounded-card border border-line bg-surface">
            {/* Same shape as a real card (16:10 cover + body) so nothing shifts on load. */}
            <div className="aspect-[16/10] border-b border-line-soft bg-inset" />
            <div className="p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-5 w-3/4" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-8 h-5 w-1/3" />
            </div>
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
      {listings.map((listing, index) => (
        <li key={listing.slug}>
          <ListingCard
            listing={listing}
            pricing={{ centsPerSol, config, tier }}
            priority={index < 3}
          />
        </li>
      ))}
    </ul>
  );
}

export const TERMINALS = ['All', ...TERMINAL_NAMES] as const;
