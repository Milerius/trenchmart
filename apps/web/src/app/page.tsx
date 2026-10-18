'use client';

import { DEFAULT_ESCROW_HOURS } from '@trenchmart/shared/config';
import { escrowWindowLabel, escrowWindowShort } from '@trenchmart/shared/escrow';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { preload } from 'react-dom';
import { solText } from '@/lib/money';
import { CATEGORIES } from '@trenchmart/shared/categories';
import { ActivityBand, useActivity } from '@/components/activity';
import { FeaturedRow, useFeatured } from '@/components/featured';
import { TierTable } from '@/components/fees';
import { type Board, type BoardTab, CreatorCards, TAB_LABEL } from '@/components/leaderboard';
import { ListingGrid, TERMINALS, type Listing } from '@/components/listings';
import { TerminalName } from '@/components/terminal-logo';
import {
  ButtonLink,
  Label,
  Money,
  PreviewNotice,
  Serif,
  ShieldIcon,
  Skeleton,
  Tag,
} from '@/components/ui';
import { CountUp, HeroField, Reveal } from '@/components/motion';
import { api } from '@/lib/api';
import { recentRead, rememberRead } from '@/lib/recent';
import { usePublicConfig } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

type Stats = {
  source: 'mock' | 'live';
  note?: string;
  listings: number;
  creators: number;
  orders: number;
  volume: { lamports: string; sol: string; usdCents: string | null };
  paidToCreators?: {
    lamports: string;
    usdCents: string | null;
    last24hLamports: string;
    orders: number;
  };
  solUsd: { centsPerSol: string | null };
};

const HOME_TABS: BoardTab[] = ['earners', 'rated', 'rising'];

export default function HomePage() {
  // Home-only reads start with the HTML (see PRELOADED_READS in the shell).
  for (const href of [
    '/api/v1/stats',
    '/api/v1/creators/leaderboard?tab=earners&range=30d&limit=6',
    '/api/v1/activity?limit=24',
  ])
    preload(href, { as: 'fetch', crossOrigin: 'use-credentials' });
  const wallet = useWallet();
  const config = usePublicConfig();
  const [terminal, setTerminal] = useState('All');
  // A return visit paints the last answers at once (this tab only) and refreshes them.
  const viewer = wallet.session?.wallet ?? '';
  const [listings, setListings] = useState<Listing[] | null>(
    () => recentRead<Listing[]>(`home-listings|All|${viewer}`) ?? null,
  );
  const [stats, setStats] = useState<Stats | null>(() => recentRead<Stats>('stats') ?? null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [creatorTab, setCreatorTab] = useState<BoardTab>('earners');
  const [board, setBoard] = useState<Board | null | 'error'>(
    () => recentRead<Board>('home-board|earners') ?? null,
  );
  const activity = useActivity(24);
  const featured = useFeatured('home');

  useEffect(() => {
    const query =
      terminal === 'All' ? '' : `?terminal=${encodeURIComponent(terminal)}&sort=trending`;
    const key = `home-listings|${terminal}|${viewer}`;
    const recent = recentRead<Listing[]>(key);
    if (recent) setListings(recent);
    void api<Listing[]>(`/listings${query}`)
      .then((body) => setListings(rememberRead(key, body)))
      .catch(() => setListings((prev) => prev ?? []));
  }, [terminal, viewer]);

  useEffect(() => {
    void api<Stats>('/stats')
      .then((body) => setStats(rememberRead('stats', body)))
      .catch(() => setStatsFailed(true));
  }, []);

  useEffect(() => {
    let stop = false;
    const key = `home-board|${creatorTab}`;
    const recent = recentRead<Board>(key);
    if (recent) setBoard(recent);
    void api<Board>(`/creators/leaderboard?tab=${creatorTab}&range=30d&limit=6`)
      .then(
        (body) => !stop && setBoard(Array.isArray(body?.rows) ? rememberRead(key, body) : 'error'),
      )
      .catch(() => !stop && setBoard('error'));
    return () => {
      stop = true;
    };
  }, [creatorTab]);

  const cents = stats?.solUsd.centsPerSol ?? null;
  const escrowHours = config?.escrowHours ?? DEFAULT_ESCROW_HOURS;

  return (
    <div className="space-y-20">
      <section className="relative grid items-center gap-10 pt-4 lg:grid-cols-[1.3fr_1fr]">
        <HeroField />
        <div className="relative">
          <p
            className="rise m-0 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-accent"
            style={{ animationDelay: '40ms' }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Solana devnet marketplace · reviewed · escrowed
          </p>
          <h1
            className="rise mt-4 text-[42px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[58px]"
            style={{ animationDelay: '90ms' }}
          >
            The verified edge, <Serif className="text-accent">for sale.</Serif>
          </h1>
          <p
            className="rise mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2"
            style={{ animationDelay: '150ms' }}
          >
            Buy and sell trading scripts, terminal filters and wallet lists. Every version is
            scanned, scripts also run in a sandbox, and an AI review (rules engine plus an LLM)
            decides in under a minute. Your SOL waits in escrow until the trade is done.
          </p>
          <div className="rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: '210ms' }}>
            <ButtonLink href="#market" size="lg">
              Browse the market
            </ButtonLink>
            <ButtonLink href="/sell" variant="secondary" size="lg">
              Sell your tooling
            </ButtonLink>
          </div>
          <ul
            className="rise mt-8 flex flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-ink-2"
            style={{ animationDelay: '270ms' }}
          >
            <li className="flex items-center gap-2">
              <Check /> 5% buyer fee, up to 100% off with $TRENCH
            </li>
            <li className="flex items-center gap-2">
              <Check /> 0% creator commission
            </li>
            <li className="flex items-center gap-2">
              <Check /> {escrowWindowShort(escrowHours)} escrow on every order
            </li>
          </ul>
        </div>
        <div className="rise relative" style={{ animationDelay: '160ms' }}>
          <ReviewReceipt />
        </div>
      </section>

      <Reveal>
        <div className="space-y-8">
          <LandingStats stats={stats} failed={statsFailed} />
          <ActivityBand activity={activity} />
        </div>
      </Reveal>

      {featured.length ? (
        <FeaturedRow
          items={featured}
          centsPerSol={cents}
          config={config}
          tier={wallet.session?.tier}
        />
      ) : null}

      <Reveal>
        <section aria-labelledby="creators-heading" data-testid="top-creators">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHead
              id="creators-heading"
              kicker="Creators"
              title="Top creators"
              accent="this month"
            />
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="Top creators" className="flex gap-1">
                {HOME_TABS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={creatorTab === value}
                    onClick={() => setCreatorTab(value)}
                    className={`motion-press h-9 rounded-full border px-3.5 text-[13px] ${
                      creatorTab === value
                        ? 'border-accent bg-accent-bg text-accent'
                        : 'border-line-control text-ink-2 hover:text-ink'
                    }`}
                  >
                    {TAB_LABEL[value]}
                  </button>
                ))}
              </div>
              <ButtonLink href="/creators" variant="ghost" size="sm">
                Full leaderboard →
              </ButtonLink>
            </div>
          </div>
          <div className="mt-6">
            {board === null ? (
              <p className="m-0 text-muted">Loading creators…</p>
            ) : board === 'error' ? (
              <p className="m-0 text-muted">Creator rankings are unavailable right now.</p>
            ) : board.rows.length === 0 ? (
              <p className="m-0 text-muted" data-testid="top-creators-empty">
                {creatorTab === 'earners'
                  ? 'No creator payouts in the last 30 days yet. The first released order puts a creator here.'
                  : creatorTab === 'rated'
                    ? `No creator has ${board.rules.topRatedMinReviews}+ verified reviews yet.`
                    : `No creator has ${board.rules.risingMinSales}+ sales this month yet.`}
              </p>
            ) : (
              <CreatorCards rows={board.rows} tab={creatorTab} centsPerSol={cents} />
            )}
            <p className="mt-3 text-xs text-muted">
              Ranked on released sales, verified-buyer reviews and weighted upvotes. Paid featuring
              never changes a rank.
            </p>
          </div>
        </section>
      </Reveal>

      <section id="market" aria-labelledby="market-heading" className="scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead id="market-heading" kicker="Market" title="Trending" accent="this week" />
          <div
            data-testid="terminal-filter"
            role="group"
            aria-label="Filter by terminal"
            className="flex flex-wrap gap-2"
          >
            {TERMINALS.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={terminal === name}
                className={`motion-press h-9 rounded-full border px-3.5 text-[13px] ${
                  terminal === name
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-line-control text-ink-2 hover:text-ink'
                }`}
                onClick={() => setTerminal(name)}
              >
                {name === 'All' ? name : <TerminalName name={name} logoClassName="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
        {!wallet.session ? (
          <div className="mt-6">
            <PreviewNotice onConnect={() => void wallet.connect()} />
          </div>
        ) : null}
        <div className="mt-6">
          <ListingGrid
            listings={listings ?? []}
            loading={listings === null}
            centsPerSol={cents}
            config={config}
            tier={wallet.session?.tier}
          />
        </div>
      </section>

      <Reveal>
        <section aria-labelledby="how-heading">
          <SectionHead
            id="how-heading"
            kicker="How buying works"
            title="Four steps,"
            accent="no surprises."
          />
          <ol className="stagger mt-8 grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                'Pick a verified tool',
                'Every listing shows its review result, the checks it passed, the file hash and a signed scan report.',
              ],
              [
                'See your exact price',
                'Price, 5% fee, your tier discount and 0% creator commission, itemised before you sign.',
              ],
              [
                'Pay into escrow',
                `Your SOL is held in escrow for ${escrowWindowLabel(escrowHours)}. Open a dispute any time in that window.`,
              ],
              [
                'Download on release',
                'Once payment is confirmed in escrow, download a copy watermarked to your wallet.',
              ],
            ].map(([title, body], index) => (
              <li
                key={title}
                className="motion-card list-none rounded-card border border-line bg-surface p-5"
              >
                <span className="font-mono text-xs text-accent">0{index + 1}</span>
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-ink-2">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      </Reveal>

      <Reveal>
        <section aria-labelledby="cat-heading">
          <SectionHead id="cat-heading" kicker="Categories" title="Find your" accent="edge" />
          <ul className="mt-8 grid gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((cat) => (
              <li key={cat.code} className="list-none">
                <Link
                  href={`/c/${cat.code}`}
                  className="motion-card flex h-full flex-col gap-2 rounded-card border border-line bg-surface p-5 hover:border-line-strong"
                >
                  <span
                    className="font-mono text-[11px] tracking-wide"
                    style={{ color: cat.color }}
                  >
                    {cat.short}
                  </span>
                  <span className="text-base font-semibold">{cat.label}</span>
                  <span className="text-sm text-ink-2">{cat.desc}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </Reveal>

      <Reveal>
        <section aria-labelledby="fees-heading" className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <SectionHead id="fees-heading" kicker="Fees" title="Hold $TRENCH," accent="pay less." />
            <p className="mt-4 max-w-md text-ink-2">
              Buyers pay a 5% fee on top of the listing price. Your $TRENCH tier cuts it, down to
              zero for OG holders. Creators keep 100% of the listing price.
            </p>
            <ButtonLink href="/token" variant="secondary" className="mt-6">
              See tiers and savings
            </ButtonLink>
          </div>
          <div className="rounded-panel border border-line bg-surface p-5">
            <TierTable config={config} current={wallet.session?.tier} />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section aria-labelledby="trust-heading">
          <SectionHead
            id="trust-heading"
            kicker="Trust"
            title="Built so you don't have to"
            accent="trust anyone."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              [
                'Escrow on every order',
                `The creator is paid only after ${escrowWindowLabel(escrowHours)} with no dispute. A dispute freezes the funds until it is settled.`,
              ],
              [
                'On-chain escrow program',
                'Each order is a program account on Solana. Only the program moves the SOL: to the creator after the window, or back to you on an upheld dispute.',
              ],
              [
                'Sandboxed automated review',
                'Each file is statically scanned; scripts also run in an isolated sandbox with logged network calls. A rules engine and an LLM then review it; the stricter verdict wins.',
              ],
            ].map(([title, body]) => (
              <div
                key={title}
                className="motion-card rounded-card border border-line bg-surface p-5"
              >
                <ShieldIcon className="text-accent" />
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-ink-2">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="motion-card flex flex-wrap items-center justify-between gap-6 rounded-panel border border-accent-line bg-accent-bg p-8">
          <div>
            <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em]">
              Have an edge? <Serif className="text-accent">Sell it.</Serif>
            </h2>
            <p className="mt-2 max-w-lg text-ink-2">
              Upload a file and watch the automated review run live. 0% commission, payouts in SOL.
            </p>
          </div>
          <ButtonLink href="/sell" size="lg">
            Start selling
          </ButtonLink>
        </section>
      </Reveal>
    </div>
  );
}

function SectionHead({
  id,
  kicker,
  title,
  accent,
}: {
  id: string;
  kicker: string;
  title: string;
  accent?: string;
}) {
  return (
    <div>
      <Label className="text-accent-label">{kicker}</Label>
      <h2 id={id} className="mt-2 text-[28px] font-semibold tracking-[-0.025em]">
        {title}
        {accent ? (
          <>
            {' '}
            <Serif>{accent}</Serif>
          </>
        ) : null}
      </h2>
    </div>
  );
}

function Check() {
  return (
    <span aria-hidden="true" className="font-mono text-accent">
      ✓
    </span>
  );
}

function ReviewReceipt() {
  const steps: [string, string, string][] = [
    ['Static scan', '14 rules · 0 findings', '0.4s'],
    ['Sandbox run', '3 requests · allowlisted hosts', '1.9s'],
    ['Verdict', 'Rules engine: approve', '2.6s'],
  ];
  return (
    <figure className="m-0 overflow-hidden rounded-panel border border-line bg-surface shadow-[0_30px_80px_-40px_rgba(198,244,50,0.25)]">
      <div className="flex items-center justify-between border-b border-line-soft bg-inset px-5 py-3">
        <span className="font-mono text-xs text-muted">review · axiom-pulse-filter.user.js</span>
        <Tag tone="ok">
          <span aria-hidden="true">✓</span> PASSED · 4.9s
        </Tag>
      </div>
      <ol className="m-0 space-y-3 p-5">
        {steps.map(([name, detail, time]) => (
          <li key={name} className="flex list-none items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 place-items-center rounded-tag bg-accent font-mono text-xs font-bold text-onaccent"
            >
              ✓
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{name}</span>
              <span className="block text-xs text-muted">{detail}</span>
            </span>
            <span className="font-mono text-xs text-ink-2">{time}</span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-px border-t border-line-soft bg-line-soft font-mono text-xs">
        <div className="bg-surface px-5 py-3">
          <span className="block text-muted">SHA-256</span>
          <span className="text-ink-2">9f2c…e41a pinned</span>
        </div>
        <div className="bg-surface px-5 py-3">
          <span className="block text-muted">Escrow</span>
          <span className="text-ink-2">
            {escrowWindowShort(DEFAULT_ESCROW_HOURS)} · download once paid
          </span>
        </div>
      </div>
      <figcaption className="border-t border-line-soft px-5 py-2.5 text-xs text-muted">
        Example review receipt (illustration)
      </figcaption>
    </figure>
  );
}

function LandingStats({ stats, failed }: { stats: Stats | null; failed: boolean }) {
  const tiles: [string, ReactNode][] = stats
    ? [
        ['Live listings', stats ? <CountUp key="listings" value={stats.listings} /> : null],
        ['Creators', stats ? <CountUp key="creators" value={stats.creators} /> : null],
        ['Orders paid', stats ? <CountUp key="orders" value={stats.orders} /> : null],
        [
          'Volume traded',
          <Money
            key="v"
            lamports={stats.volume.lamports}
            usdCents={stats.volume.usdCents}
            stacked
          />,
        ],
        [
          'Paid to creators',
          stats.paidToCreators ? (
            <span key="paid" data-testid="paid-to-creators" className="inline-flex flex-col">
              <Money
                lamports={stats.paidToCreators.lamports}
                usdCents={stats.paidToCreators.usdCents}
                stacked
              />
              {BigInt(stats.paidToCreators.last24hLamports) > 0n ? (
                <span className="mt-1 text-xs font-normal text-accent">
                  +{solText(stats.paidToCreators.last24hLamports)} in 24h
                </span>
              ) : null}
            </span>
          ) : (
            '—'
          ),
        ],
      ]
    : [
        ['Live listings', null],
        ['Verified creators', null],
        ['Orders paid', null],
        ['Volume traded', null],
        ['Paid to creators', null],
      ];
  return (
    <section data-testid="dashboard" aria-label="Marketplace stats">
      <div
        data-testid="landing-stats"
        data-source={stats?.source ?? 'none'}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-5"
      >
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-surface p-5 last:col-span-2 lg:last:col-span-1">
            <Label>{label}</Label>
            <div className="tabular mt-2 font-mono text-2xl font-semibold text-ink">
              {value ?? (failed ? '—' : <Skeleton className="h-7 w-20" />)}
            </div>
          </div>
        ))}
      </div>
      {stats?.source === 'mock' ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Tag tone="info">SAMPLE DATA</Tag>
          {stats.note ?? 'Sample figures until the first listing goes live.'}
        </p>
      ) : null}
    </section>
  );
}
