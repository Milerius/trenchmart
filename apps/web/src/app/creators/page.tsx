'use client';

import { CATEGORIES } from '@trenchmart/shared/categories';
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
import { XIcon } from '@/components/icons';
import {
  Button,
  EmptyState,
  Label,
  Money,
  PillGroup,
  pillClass,
  Serif,
  Skeleton,
  Tag,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

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
  const { session } = useWallet();
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
  // Podium reads 2 · 1 · 3 on wide screens (winner in the middle), 1 · 2 · 3 on phones.
  const podiumOrder = podium.length === 3 ? [podium[1]!, podium[0]!, podium[2]!] : podium;
  const change = board
    ? pctChange(board.summary.paid30dLamports, board.summary.paidPrior30dLamports)
    : null;
  const rangeLabel = range === '7d' ? 'last 7 days' : range === '30d' ? 'last 30 days' : 'all time';

  return (
    <section className="space-y-6" data-testid="creator-leaderboard">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <Label>Creators</Label>
          <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.03em]">
            Creator <Serif>leaderboard</Serif>
          </h1>
          <p className="m-0 mt-1 text-ink-2">
            Built from released escrow orders and verified-buyer reviews. Featured placements can’t
            buy a spot here.
          </p>
        </div>
        {board ? (
          <dl
            className="m-0 grid w-full grid-cols-3 divide-x divide-line overflow-hidden rounded-card border border-line bg-surface sm:w-auto"
            data-testid="leaderboard-summary"
          >
            <div className="min-w-0 px-3 py-3 sm:px-4">
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Paid to creators
              </dt>
              <dd className="m-0 mt-1 text-lg text-accent">
                <Money lamports={board.summary.paidLamports} centsPerSol={cents} strong stacked />
              </dd>
              <dd className="m-0 font-mono text-[11px] text-muted">all time</dd>
            </div>
            <div className="min-w-0 px-3 py-3 sm:px-4">
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Paid · 30 days
              </dt>
              <dd className="m-0 mt-1 text-lg">
                <Money lamports={board.summary.paid30dLamports} centsPerSol={null} strong />
              </dd>
              <dd className="m-0 font-mono text-[11px] text-accent">{change ?? ' '}</dd>
            </div>
            <div className="min-w-0 px-3 py-3 sm:px-4">
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Ranked creators
              </dt>
              <dd className="m-0 mt-1 font-mono text-lg font-semibold text-ink">
                {board.summary.rankedCreators}
              </dd>
              <dd className="m-0 inline-flex items-center gap-1 font-mono text-[11px] text-muted">
                {board.summary.xVerifiedCreators} <XIcon className="h-3 w-3" /> verified
              </dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-line">
        <div role="tablist" aria-label="Leaderboard" className="flex flex-wrap gap-1">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => set('tab', value === 'earners' ? null : value)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${
                tab === value
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              {TAB_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 pb-2">
          <PillGroup role="group" aria-label="Time range">
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={range === option.value}
                onClick={() => set('range', option.value === '30d' ? null : option.value)}
                className={pillClass(range === option.value, 'h-8 font-mono text-[12px]')}
              >
                {option.label}
              </button>
            ))}
          </PillGroup>
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <XIcon className="h-3.5 w-3.5" />
            <span>verified only</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="X verified only"
              className="peer sr-only"
              checked={verified}
              onChange={(event) => set('verified', event.target.checked ? '1' : null)}
            />
            <span
              aria-hidden="true"
              className="relative h-5 w-9 rounded-full border border-line bg-surface-2 transition-colors peer-checked:border-accent-line peer-checked:bg-accent after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-onaccent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
            />
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
        <ol
          className="m-0 grid items-end gap-3 p-0 md:grid-cols-3"
          data-testid="leaderboard-podium"
        >
          {podiumOrder.map((row) => {
            const first = row.position === 1;
            return (
              <li
                key={row.creator.wallet}
                className={`list-none ${first ? 'order-first md:order-none' : ''}`}
              >
                <Link
                  href={profileHref(row.creator)}
                  data-testid="podium-card"
                  className={`relative flex h-full flex-col items-center gap-2 overflow-hidden rounded-card border px-4 text-center hover:border-line-strong ${
                    first
                      ? 'border-accent-line bg-[radial-gradient(ellipse_at_top,rgba(200,255,61,0.16),transparent_65%)] py-7'
                      : 'border-line bg-surface py-5'
                  }`}
                >
                  <span className="absolute inset-x-3 top-3 flex items-center justify-between font-mono text-[11px] text-muted">
                    <span className={first ? 'text-accent' : ''}>#{row.position}</span>
                    <Movement row={row} />
                  </span>
                  <CreatorAvatar
                    who={row.creator}
                    className={`${first ? 'h-24 w-24 text-2xl' : 'h-16 w-16 text-lg'} mt-3`}
                  />
                  <CreatorName who={row.creator} className="max-w-full justify-center text-base" />
                  <span className="rounded-ctl border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]">
                    <KindLabel who={row.creator} />
                  </span>
                  <span className={`mt-1 ${first ? 'text-2xl text-accent' : 'text-xl'}`}>
                    <Headline row={row} tab={tab} centsPerSol={null} />
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {tab === 'earners' ? `paid out · ${rangeLabel}` : TAB_LABEL[tab]}
                  </span>
                  <span className="mt-2 grid w-full grid-cols-3 gap-2 font-mono text-[12px]">
                    <span className="rounded-ctl border border-line-soft bg-inset py-1.5 text-ink">
                      {row.sales}
                      <span className="block text-[10px] text-muted">sales</span>
                    </span>
                    <span className="rounded-ctl border border-line-soft bg-inset py-1.5 text-ink">
                      {row.rating ? `★ ${row.rating.avg.toFixed(1)}` : '–'}
                      <span className="block text-[10px] text-muted">
                        {row.rating?.count ?? 0} reviews
                      </span>
                    </span>
                    <span className="rounded-ctl border border-line-soft bg-inset py-1.5 text-ink">
                      {row.upvotes.raw}
                      <span className="block text-[10px] text-muted">upvotes</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {board ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {rows.length ? (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-card border border-line bg-surface">
                <table
                  className="w-full min-w-[720px] border-collapse text-sm"
                  data-testid="leaderboard-table"
                >
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Creator</th>
                      <th className="px-3 py-2 font-medium">Top listing</th>
                      <th className="px-3 py-2 text-right font-medium">Sales</th>
                      <th className="px-3 py-2 text-right font-medium">
                        {tab === 'earners' ? 'Paid out ▾' : TAB_LABEL[tab]}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">Rating</th>
                      <th className="px-3 py-2 text-right font-medium">Upvotes</th>
                      <th className="px-3 py-2 font-medium">14d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const mine = session?.wallet === row.creator.wallet;
                      return (
                        <tr
                          key={row.creator.wallet}
                          className={`border-b border-line-soft last:border-0 ${mine ? 'bg-accent-bg' : ''}`}
                          data-testid="leaderboard-row"
                        >
                          <td className="px-3 py-2.5 align-middle">
                            <span className="flex flex-col font-mono leading-tight">
                              <span className="text-ink">{row.position}</span>
                              <Movement row={row} />
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Link
                              href={profileHref(row.creator)}
                              className="flex items-center gap-2.5"
                            >
                              <CreatorAvatar who={row.creator} className="h-8 w-8 text-[11px]" />
                              <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                  <CreatorName who={row.creator} className="max-w-[160px]" />
                                  {mine ? <Tag tone="ok">YOU</Tag> : null}
                                </span>
                                <span className="block text-[11px] text-muted">
                                  {row.creator.handle ? `@${row.creator.handle} · ` : ''}
                                  <KindLabel who={row.creator} />
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="max-w-[180px] truncate px-3 py-2.5">
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
                          <td className="px-3 py-2.5 text-right font-mono">{row.sales}</td>
                          <td className="px-3 py-2.5 text-right">
                            <Headline row={row} tab={tab} centsPerSol={null} />
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {row.rating ? (
                              <>
                                ★ {row.rating.avg.toFixed(1)}
                                <span className="block text-[11px] text-muted">
                                  {row.rating.count} reviews
                                </span>
                              </>
                            ) : (
                              '–'
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            ↑ {row.upvotes.counted}
                            <span className="block text-[11px] text-muted">
                              {row.upvotes.raw} raw
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Spark values={row.spark} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3 font-mono text-[12px] text-muted">
                <span data-testid="leaderboard-count">
                  Showing {rows.length} of {board.total}
                </span>
                {rows.length < board.total ? (
                  <Button variant="secondary" onClick={() => void loadMore()}>
                    Show more ({board.total - rows.length} left)
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div />
          )}

          <aside className="space-y-4">
            <div
              className="rounded-card border border-line bg-surface p-4"
              data-testid="ranking-rules"
            >
              <h2 className="m-0 text-base font-semibold">How ranking works</h2>
              <div className="mt-3 space-y-2">
                {RULE_CARDS(board.rules).map((card) => (
                  <div
                    key={card.tab}
                    className={`rounded-ctl border p-3 text-[13px] ${
                      tab === card.tab ? 'border-accent-line bg-accent-bg' : 'border-line-soft'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <b className={tab === card.tab ? 'text-accent' : 'text-ink'}>
                        {TAB_LABEL[card.tab]}
                      </b>
                      {tab === card.tab ? (
                        <span className="font-mono text-[10px] text-accent">SHOWING</span>
                      ) : null}
                    </div>
                    <p className="m-0 mt-1 font-mono text-[12px] text-ink">{card.formula}</p>
                    <p className="m-0 mt-1 text-ink-2">{card.note}</p>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="rounded-card border border-line bg-surface p-4"
              data-testid="ranking-never"
            >
              <h2 className="m-0 text-base font-semibold">What never counts</h2>
              <ul className="m-0 mt-3 space-y-2 p-0 text-[13px] text-ink-2">
                {[
                  'A creator buying, reviewing or upvoting their own listing.',
                  `Wallets funded by the creator in the last ${board.rules.funderWindowDays} days; clusters of them pause the listing’s rank for review.`,
                  'Orders still in escrow, refunded or disputed.',
                  `Wallets younger than ${board.rules.minWalletAgeDays} days.`,
                  'Paid featuring or sponsorship.',
                ].map((item) => (
                  <li key={item} className="flex list-none gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded bg-danger-bg text-[10px] text-danger"
                    >
                      ✕
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 text-[12px] text-muted">
                Recomputed every {board.rules.recomputeMinutes} minutes. Each row links to the
                on-chain payouts behind it.
              </p>
            </div>
            <div
              className="rounded-card border border-line bg-surface p-4"
              data-testid="ranking-names"
            >
              <h2 className="m-0 text-base font-semibold">Names on this page</h2>
              <ul className="m-0 mt-3 space-y-2 p-0 text-[13px] text-ink-2">
                <li className="flex list-none items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-ctl border border-line px-1.5 py-0.5 font-mono text-[10px] text-accent">
                    <XIcon className="h-3 w-3" /> VERIFIED
                  </span>
                  Signed in with X. Handle is proven.
                </li>
                <li className="flex list-none items-center gap-2">
                  <span className="rounded-ctl border border-line px-1.5 py-0.5 font-mono text-[10px]">
                    PSEUDONYM
                  </span>
                  Chosen name, not linked to X.
                </li>
                <li className="flex list-none items-center gap-2">
                  <span className="rounded-ctl border border-line px-1.5 py-0.5 font-mono text-[10px]">
                    WALLET
                  </span>
                  No profile. Shown as an address.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function RULE_CARDS(rules: Board['rules']): { tab: BoardTab; formula: string; note: string }[] {
  return [
    {
      tab: 'earners',
      formula: 'Σ SOL released to the creator in the range',
      note: 'Only escrow-released orders. Refunds and upheld disputes are subtracted.',
    },
    {
      tab: 'rated',
      formula: `(n·avg + ${rules.bayesM}·site avg) ÷ (n + ${rules.bayesM})`,
      note: `Bayesian average, pulled toward the site mean by ${rules.bayesM} reviews. Minimum ${rules.topRatedMinReviews} reviews.`,
    },
    {
      tab: 'rising',
      formula: 'counted sales this range ÷ previous range',
      note: `Minimum ${rules.risingMinSales} counted sales in the range.`,
    },
    {
      tab: 'upvoted',
      formula: 'Σ upvote weight on live listings',
      note: `Buyers ×${rules.weights.buyer}, ${rules.holderMinTier}+ $TRENCH holders ×${rules.weights.holder}, any other wallet ×0 (shown, not counted).`,
    },
  ];
}

export default function CreatorsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <Leaderboard />
    </Suspense>
  );
}
