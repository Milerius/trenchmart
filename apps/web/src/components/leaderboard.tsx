'use client';

import type { PublicIdentity } from '@trenchmart/shared';
import Link from 'next/link';
import { Avatar, VerifiedBadge } from '@/components/profile';
import { Money, Tag } from '@/components/ui';

/** Creator leaderboard rows (API: GET /creators/leaderboard) and their small visuals. */

export type BoardTab = 'earners' | 'rated' | 'rising' | 'upvoted';
export type BoardRange = '7d' | '30d' | 'all';

export type BoardRow = {
  position: number;
  creator: PublicIdentity;
  sales: number;
  paidLamports: string;
  rating: { avg: number; count: number } | null;
  bayes: number | null;
  upvotes: { counted: number; raw: number };
  rising: { now: number; prev: number; ratio: number } | null;
  listings: number;
  topListing: { title: string; slug: string } | null;
  isNew: boolean;
  movement: number | null;
  spark: number[];
};

export type Board = {
  tab: BoardTab;
  range: BoardRange;
  total: number;
  offset: number;
  rows: BoardRow[];
  summary: {
    paidLamports: string;
    paid30dLamports: string;
    paidPrior30dLamports: string;
    rankedCreators: number;
    xVerifiedCreators: number;
  };
  rules: {
    bayesM: number;
    topRatedMinReviews: number;
    risingMinSales: number;
    minWalletAgeDays: number;
    funderWindowDays: number;
    weights: { buyer: number; holder: number };
    holderMinTier: string;
    recomputeMinutes: number;
  };
};

export const TAB_LABEL: Record<BoardTab, string> = {
  earners: 'Top earners',
  rated: 'Top rated',
  rising: 'Rising',
  upvoted: 'Most upvoted',
};

export function profileHref(who: PublicIdentity): string {
  return `/u/${who.handle ?? who.wallet}`;
}

export function KindLabel({ who }: { who: PublicIdentity }) {
  if (who.kind === 'x')
    return (
      <span className="inline-flex items-center gap-1 text-accent">
        <span aria-hidden="true">𝕏</span> verified
      </span>
    );
  return <span>{who.kind === 'pseudonym' ? 'pseudonym' : 'wallet only'}</span>;
}

export function CreatorName({ who, className = '' }: { who: PublicIdentity; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <span
        className={`truncate font-semibold text-ink ${who.kind === 'wallet' ? 'font-mono' : ''}`}
      >
        {who.name}
      </span>
      {who.kind === 'x' ? <VerifiedBadge className="h-4 w-4" /> : null}
    </span>
  );
}

export function CreatorAvatar({ who, className }: { who: PublicIdentity; className: string }) {
  return (
    <Avatar
      image={who.avatarUrl}
      name={who.kind === 'wallet' ? null : who.name}
      fallback={who.wallet.slice(0, 2)}
      className={className}
      ring=""
    />
  );
}

/** Inline sparkline of daily payouts (last 14 days). Flat line when there were none. */
export function Spark({
  values,
  className = 'h-6 w-20',
}: {
  values: number[];
  className?: string;
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 0);
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 100;
      const y = max > 0 ? 22 - (v / max) * 20 : 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={className} aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        stroke={up ? 'var(--color-accent)' : 'var(--color-danger)'}
      />
    </svg>
  );
}

export function Movement({ row }: { row: BoardRow }) {
  if (row.isNew) return <Tag tone="info">NEW</Tag>;
  if (!row.movement) return <span className="font-mono text-[11px] text-muted">–</span>;
  return row.movement > 0 ? (
    <span className="font-mono text-[11px] text-accent">▲{row.movement}</span>
  ) : (
    <span className="font-mono text-[11px] text-danger">▼{Math.abs(row.movement)}</span>
  );
}

/** The headline number for a tab. */
export function Headline({
  row,
  tab,
  centsPerSol,
}: {
  row: BoardRow;
  tab: BoardTab;
  centsPerSol: string | null;
}) {
  if (tab === 'rated')
    return (
      <span className="font-mono text-ink">
        ★ {row.bayes?.toFixed(2) ?? '–'}
        <span className="block text-[11px] text-muted">{row.rating?.count ?? 0} reviews</span>
      </span>
    );
  if (tab === 'rising')
    return (
      <span className="font-mono text-ink">
        {row.rising?.now ?? 0} sales
        <span className="block text-[11px] text-muted">
          vs {row.rising?.prev ?? 0} before
          {row.rising && row.rising.prev ? ` · ${row.rising.ratio}×` : ''}
        </span>
      </span>
    );
  if (tab === 'upvoted')
    return (
      <span className="font-mono text-ink">
        ▲ {row.upvotes.counted}
        <span className="block text-[11px] text-muted">{row.upvotes.raw} raw</span>
      </span>
    );
  return <Money lamports={row.paidLamports} centsPerSol={centsPerSol} strong stacked />;
}

/** Home strip: six creator cards for the chosen tab. */
export function CreatorCards({
  rows,
  tab,
  centsPerSol,
}: {
  rows: BoardRow[];
  tab: BoardTab;
  centsPerSol: string | null;
}) {
  return (
    <ol className="m-0 grid grid-cols-2 gap-3 p-0 md:grid-cols-3 xl:grid-cols-6">
      {rows.map((row) => (
        <li key={row.creator.wallet} className="list-none">
          <Link
            href={profileHref(row.creator)}
            data-testid="creator-card"
            className="motion-card flex h-full flex-col items-center gap-2 rounded-card border border-line bg-surface p-4 text-center hover:border-line-strong"
          >
            <span className="flex h-5 w-full items-center justify-between font-mono text-[11px] text-muted">
              #{row.position}
              <Movement row={row} />
            </span>
            <CreatorAvatar who={row.creator} className="h-14 w-14 text-base" />
            <CreatorName who={row.creator} className="max-w-full justify-center text-sm" />
            <span className="text-[11px] text-muted">
              <KindLabel who={row.creator} />
            </span>
            <span className="mt-1 text-sm">
              <Headline row={row} tab={tab} centsPerSol={centsPerSol} />
            </span>
            <span className="mt-auto grid w-full grid-cols-3 gap-1 border-t border-line-soft pt-2 font-mono text-[11px] text-ink-2">
              <span>
                {row.sales}
                <span className="block text-muted">sales</span>
              </span>
              <span>
                {row.rating ? `★ ${row.rating.avg.toFixed(1)}` : '–'}
                <span className="block text-muted">rating</span>
              </span>
              <span>
                {row.upvotes.raw}
                <span className="block text-muted">upvotes</span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
