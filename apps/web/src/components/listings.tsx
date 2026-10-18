'use client';

import Link from 'next/link';
import { categoryMeta } from '@trenchmart/shared/categories';
import { quote } from '@trenchmart/shared/fee';
import { rankBadge } from '@trenchmart/shared/ranking';
import { TERMINALS as TERMINAL_NAMES } from '@trenchmart/shared/terminals';
import { Star } from 'lucide-react';
import { TerminalMark, TerminalNames } from '@/components/terminal-logo';
import { Spot } from '@/components/spot';
import { Money, Skeleton, EmptyState, Tag } from '@/components/ui';
import type { PublicConfig } from '@/lib/config';
import { CARD_SIZES, mediaSrcSet } from '@/lib/media';

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
  /** Paid featuring slot (always labelled; never affects rank). */
  sponsored?: { bookingId: string; placement: string } | null;
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
  const sold = listing.sales7d ?? 0;
  return (
    <Spot color={meta.color} surface="#0f110f" className="motion-card group h-full !rounded-panel">
      <Link
        data-testid="listing-card"
        href={`/l/${listing.slug}`}
        className="flex h-full flex-col overflow-hidden rounded-[inherit]"
      >
        <CardCover
          listing={listing}
          color={meta.color}
          bg={meta.bg}
          tag={meta.tag}
          priority={priority}
        />
        <div className="flex flex-1 flex-col gap-3 p-5">
          {listing.sponsored || rankBadge(listing.rank?.category, meta.label) ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {listing.sponsored ? (
                <Tag
                  tone="warn"
                  data-testid="sponsored-tag"
                  title="Paid placement. Never affects ranking."
                >
                  <span aria-hidden="true">★</span> FEATURED · SPONSORED
                </Tag>
              ) : (
                <Tag tone="info" data-testid="rank-badge">
                  {rankBadge(listing.rank?.category, meta.label)}
                </Tag>
              )}
            </span>
          ) : null}
          <h3 className="m-0 text-[17px] font-semibold leading-snug tracking-tight group-hover:text-accent-hover">
            {listing.title}
          </h3>
          <p className="m-0 line-clamp-2 text-sm text-muted">{listing.summary}</p>
          {listing.terminals.length > 1 ? (
            <p className="m-0 font-mono text-[11px] text-faint" data-testid="card-terminals">
              <TerminalNames names={listing.terminals} />
            </p>
          ) : null}
          <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
              {rating ? (
                <span className="inline-flex items-center gap-1">
                  <Star size={14} className="fill-accent text-accent" aria-hidden="true" />
                  {rating.toFixed(1)}
                  <span className="sr-only"> out of 5</span>
                </span>
              ) : null}
              <span className="text-faint">
                {rating ? '· ' : ''}
                {sold ? `${sold} sold this week` : listing.handle ? `@${listing.handle}` : 'New'}
              </span>
              {listing.upvotes ? (
                <span data-testid="card-upvotes" className="font-mono text-xs text-faint">
                  <span aria-hidden="true">▲</span> {listing.upvotes}
                  <span className="sr-only"> upvotes</span>
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-right">
              {total !== null ? (
                <span className="block font-mono text-[10px] uppercase tracking-wide text-faint">
                  You pay
                </span>
              ) : null}
              <Money
                lamports={total ?? listing.price}
                centsPerSol={pricing.centsPerSol}
                stacked
                className="items-end text-[15px] font-semibold text-accent [&>[data-testid=usd-amount]]:text-[11px] [&>[data-testid=usd-amount]]:text-faint"
              />
            </span>
          </div>
          {total === null ? (
            <p className="-mt-1 m-0 text-right font-mono text-[10px] text-faint">
              + 5% buyer fee · your tier can cut it
            </p>
          ) : null}
        </div>
      </Link>
    </Spot>
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
          data-testid="card-cover-img"
          src={listing.cover.url}
          srcSet={mediaSrcSet(listing.cover.url)}
          sizes={CARD_SIZES}
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
          <span
            className="font-mono text-[13px] font-semibold tracking-[0.2em] opacity-40"
            style={{ color }}
          >
            {tag}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center rounded-md px-2 py-1 font-mono text-[11px] font-semibold tracking-wider"
          style={{ color, background: bg, boxShadow: `inset 0 0 0 1px ${color}33` }}
        >
          {tag}
        </span>
        {listing.terminals[0] ? (
          <span
            data-testid="card-terminal-chip"
            className="flex items-center gap-1.5 rounded-md bg-black/60 py-1 pr-2 pl-1 font-mono text-[11px] font-medium text-ink"
          >
            <TerminalMark name={listing.terminals[0]} className="h-4 w-4 rounded" />
            {listing.terminals[0]}
          </span>
        ) : null}
      </div>
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
  wide = false,
}: {
  listings: Listing[];
  centsPerSol: string | null;
  config?: PublicConfig | null;
  tier?: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  /** Four columns on wide screens (home market). */
  wide?: boolean;
}) {
  const grid = `grid gap-4 sm:grid-cols-2 lg:grid-cols-3${wide ? ' xl:grid-cols-4' : ''}`;
  if (loading) {
    return (
      <ul className={grid} aria-busy="true">
        {[0, 1, 2].map((key) => (
          <li key={key} className="overflow-hidden rounded-[22px] border border-line bg-surface">
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
    <ul className={grid}>
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
