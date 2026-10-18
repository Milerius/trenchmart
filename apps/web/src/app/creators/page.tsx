'use client';

import { CATEGORIES } from '@trenchmart/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  type Board,
  type BoardRange,
  type BoardRow,
  type BoardTab,
  CreatorAvatar,
  CreatorName,
  Headline,
  KindLabel,
  Movement,
  Spark,
  TAB_LABEL,
  profileHref,
} from '@/components/leaderboard';
import { Button, EmptyState, Label, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useSolUsd } from '@/lib/config';

const TABS: BoardTab[] = ['earners', 'rated', 'rising', 'upvoted'];
const RANGES: { value: BoardRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
];
const PAGE = 20;

const EMPTY_COPY: Record<BoardTab, { title: string; body: string }> = {
  earners: {
    title: 'No payouts in this window yet.',
    body: 'Creators show up here once a buyer’s order is released from escrow.',
  },
  rated: {
    title: 'Not enough reviews yet.',
    body: 'Top rated needs a minimum number of verified-buyer reviews per creator.',
  },
  rising: {
    title: 'Nobody is rising yet.',
    body: 'Rising compares sales in this window with the window before it.',
  },
  upvoted: {
    title: 'No counted upvotes yet.',
    body: 'Only upvotes from buyers and $TRENCH holders count toward the board.',
  },
};

function pick<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return value && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pctChange(now: string, prior: string): string | null {
  const a = Number(now);
  const b = Number(prior);
  if (!b) return null;
  const pct = Math.round(((a - b) / b) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}% vs prior 30 days`;
}

function Leaderboard() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cents = useSolUsd();
  const tab = pick(params.get('tab'), TABS, 'earners');
  const range = pick(params.get('range'), ['7d', '30d', 'all'] as const, '30d');
  const category = params.get('category') ?? '';
  const verified = params.get('verified') === '1';
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [extra, setExtra] = useState<BoardRow[]>([]);

  useEffect(() => {
    let stop = false;
    setBoard(null);
    setExtra([]);
    setFailed(false);
    const query = new URLSearchParams({ tab, range, limit: String(PAGE) });
    if (category) query.set('category', category);
    if (verified) query.set('verified', '1');
    void api<Board>(`/creators/leaderboard?${query}`)
      .then((body) => !stop && setBoard(Array.isArray(body?.rows) ? body : null))
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, [tab, range, category, verified]);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const loadMore = async () => {
    if (!board) return;
    const query = new URLSearchParams({
      tab,
      range,
      limit: String(PAGE),
      offset: String(board.rows.length + extra.length),
    });
    if (category) query.set('category', category);
    if (verified) query.set('verified', '1');
    const more = await api<Board>(`/creators/leaderboard?${query}`).catch(() => null);
    if (more?.rows) setExtra((prev) => [...prev, ...more.rows]);
  };

  const rows = board ? [...board.rows, ...extra] : [];
  const podium = rows.slice(0, 3);
  const change = board
    ? pctChange(board.summary.paid30dLamports, board.summary.paidPrior30dLamports)
    : null;

  return (
    <section className="space-y-6" data-testid="creator-leaderboard">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <Label>Creators</Label>
          <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.03em]">
            Creator leaderboard
          </h1>
          <p className="m-0 mt-1 text-ink-2">
            Ranked on real, released sales, verified-buyer reviews and weighted upvotes. Paid
            featuring never changes a rank.
          </p>
        </div>
        {board ? (
          <dl className="m-0 grid grid-cols-3 gap-6" data-testid="leaderboard-summary">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Paid to creators
              </dt>
              <dd className="m-0 mt-1 text-lg">
                <Money lamports={board.summary.paidLamports} centsPerSol={cents} strong stacked />
              </dd>
              {change ? <dd className="m-0 font-mono text-[11px] text-accent">{change}</dd> : null}
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Ranked creators
              </dt>
              <dd className="m-0 mt-1 font-mono text-lg text-ink">
                {board.summary.rankedCreators}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                𝕏 verified
              </dt>
              <dd className="m-0 mt-1 font-mono text-lg text-ink">
                {board.summary.xVerifiedCreators}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <div role="tablist" aria-label="Leaderboard" className="flex flex-wrap gap-1">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => set('tab', value === 'earners' ? null : value)}
              className={`rounded-ctl px-3 py-1.5 text-sm ${
                tab === value ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {TAB_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-ctl border border-line" role="group" aria-label="Time range">
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={range === option.value}
                onClick={() => set('range', option.value === '30d' ? null : option.value)}
                className={`px-2.5 py-1 font-mono text-[12px] ${
                  range === option.value ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="lb-category">
            Category
          </label>
          <select
            id="lb-category"
            value={category}
            onChange={(event) => set('category', event.target.value || null)}
            className="rounded-ctl border border-line bg-surface px-2 py-1 text-sm text-ink"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat.code} value={cat.code}>
                {cat.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={verified}
              onChange={(event) => set('verified', event.target.checked ? '1' : null)}
            />
            𝕏 verified only
          </label>
        </div>
      </div>

      {failed ? (
        <EmptyState title="Couldn’t load the leaderboard." body="Refresh to try again." />
      ) : board === null ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={EMPTY_COPY[tab].title} body={EMPTY_COPY[tab].body} />
      ) : (
        <div className="space-y-4">
          <ol className="m-0 grid gap-3 p-0 md:grid-cols-3" data-testid="leaderboard-podium">
            {podium.map((row) => (
              <li key={row.creator.wallet} className="list-none">
                <Link
                  href={profileHref(row.creator)}
                  className={`flex h-full items-center gap-4 rounded-card border bg-surface p-4 hover:border-line-strong ${
                    row.position === 1 ? 'border-accent-line' : 'border-line'
                  }`}
                >
                  <span className="font-mono text-2xl font-semibold text-muted">
                    {row.position}
                  </span>
                  <CreatorAvatar who={row.creator} className="h-12 w-12 text-sm" />
                  <span className="min-w-0 flex-1">
                    <CreatorName who={row.creator} />
                    <span className="block text-[12px] text-muted">
                      <KindLabel who={row.creator} />
                      {row.topListing ? ` · ${row.topListing.title}` : ''}
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    <Headline row={row} tab={tab} centsPerSol={cents} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          <div className="overflow-x-auto rounded-card border border-line">
            <table
              className="w-full min-w-[760px] border-collapse text-sm"
              data-testid="leaderboard-table"
            >
              <thead>
                <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Creator</th>
                  <th className="px-3 py-2 font-medium">{TAB_LABEL[tab]}</th>
                  <th className="px-3 py-2 font-medium">Sales</th>
                  <th className="px-3 py-2 font-medium">Rating</th>
                  <th className="px-3 py-2 font-medium">Upvotes</th>
                  <th className="px-3 py-2 font-medium">Top listing</th>
                  <th className="px-3 py-2 font-medium">14 days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.creator.wallet}
                    className="border-b border-line-soft last:border-0"
                    data-testid="leaderboard-row"
                  >
                    <td className="px-3 py-2.5 align-middle">
                      <span className="flex items-center gap-2 font-mono">
                        <span className="w-5 text-ink">{row.position}</span>
                        <Movement row={row} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={profileHref(row.creator)} className="flex items-center gap-2.5">
                        <CreatorAvatar who={row.creator} className="h-8 w-8 text-[11px]" />
                        <span className="min-w-0">
                          <CreatorName who={row.creator} className="max-w-[180px]" />
                          <span className="block text-[11px] text-muted">
                            <KindLabel who={row.creator} /> · {row.listings} listing
                            {row.listings === 1 ? '' : 's'}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Headline row={row} tab={tab} centsPerSol={cents} />
                    </td>
                    <td className="px-3 py-2.5 font-mono">{row.sales}</td>
                    <td className="px-3 py-2.5 font-mono">
                      {row.rating ? `★ ${row.rating.avg.toFixed(1)} (${row.rating.count})` : '–'}
                    </td>
                    <td className="px-3 py-2.5 font-mono">
                      {row.upvotes.counted}
                      <span className="text-muted"> / {row.upvotes.raw}</span>
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2.5">
                      {row.topListing ? (
                        <Link
                          href={`/l/${row.topListing.slug}`}
                          className="text-ink-2 hover:text-ink"
                        >
                          {row.topListing.title}
                        </Link>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Spark values={row.spark} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length < board.total ? (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => void loadMore()}>
                Show more ({board.total - rows.length} left)
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {board ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div
            className="rounded-card border border-line bg-surface p-5"
            data-testid="ranking-rules"
          >
            <h2 className="m-0 text-base font-semibold">How ranking works</h2>
            <ul className="m-0 mt-3 space-y-2 pl-5 text-sm text-ink-2">
              <li>
                <b className="text-ink">Top earners</b>: SOL released to the creator from escrow in
                the window.
              </li>
              <li>
                <b className="text-ink">Top rated</b>: Bayesian average (pulled toward the site mean
                by {board.rules.bayesM} reviews); needs at least {board.rules.topRatedMinReviews}{' '}
                reviews.
              </li>
              <li>
                <b className="text-ink">Rising</b>: sales growth vs the previous window; needs{' '}
                {board.rules.risingMinSales}+ sales.
              </li>
              <li>
                <b className="text-ink">Most upvoted</b>: buyers count ×{board.rules.weights.buyer},{' '}
                {board.rules.holderMinTier}+ $TRENCH holders ×{board.rules.weights.holder}, everyone
                else ×0.
              </li>
              <li>Recomputed every {board.rules.recomputeMinutes} minutes.</li>
            </ul>
          </div>
          <div
            className="rounded-card border border-line bg-surface p-5"
            data-testid="ranking-never"
          >
            <h2 className="m-0 text-base font-semibold">What never counts</h2>
            <ul className="m-0 mt-3 space-y-2 pl-5 text-sm text-ink-2">
              <li>A creator buying, reviewing or upvoting their own listing.</li>
              <li>Wallets younger than {board.rules.minWalletAgeDays} days.</li>
              <li>
                Wallets funded by the creator in the last {board.rules.funderWindowDays} days;
                clusters of them pause the listing’s rank for review.
              </li>
              <li>Orders still in escrow, refunded or disputed.</li>
              <li>Paid featuring or sponsorship.</li>
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function CreatorsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <Leaderboard />
    </Suspense>
  );
}
