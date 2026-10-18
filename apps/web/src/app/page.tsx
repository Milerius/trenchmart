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
  Money,
  PillGroup,
  pillClass,
  PreviewNotice,
  Serif,
  Skeleton,
  Tag,
} from '@/components/ui';
import { HeroField, Reveal } from '@/components/motion';
import {
  CtaRays,
  GlowPanel,
  HeroAurora,
  Shiny,
  SplitLine,
  StatCount,
  TerminalBand,
  TradingWords,
} from '@/components/home-fx';
import { PrimaryCta } from '@/components/cta';
import { Spot } from '@/components/spot';
import { api } from '@/lib/api';
import { recentRead, rememberRead } from '@/lib/recent';
import { usePublicConfig } from '@/lib/config';
import { useWallet } from '@/lib/wallet';
import { Download, Lock, Receipt, ScanSearch, ShieldCheck, Wallet } from 'lucide-react';

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

const STEP_ICONS = [ScanSearch, Receipt, Lock, Download];
const TRUST_ICONS: [typeof Lock, string][] = [
  [Lock, '#C6F432'],
  [ShieldCheck, '#7CC4FF'],
  [ScanSearch, '#C9A2FF'],
];

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
  // Live listings per category, from the unfiltered market list.
  const [catCounts, setCatCounts] = useState<Record<string, number> | null>(null);
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
      .then((body) => {
        setListings(rememberRead(key, body));
        if (terminal === 'All' && Array.isArray(body)) {
          const counts: Record<string, number> = {};
          for (const item of body) counts[item.category] = (counts[item.category] ?? 0) + 1;
          setCatCounts(counts);
        }
      })
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
    <div className="pb-8">
      <section
        data-testid="hero"
        className="relative overflow-hidden border-b border-line-soft"
        aria-labelledby="hero-heading"
      >
        <div className="hero-aurora" aria-hidden="true" />
        <HeroField />
        <HeroAurora />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/30 via-bg/55 to-bg/20 sm:hidden"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-bg"
        />
        <div
          className={`${WRAP} relative grid items-center gap-14 pt-14 pb-20 lg:grid-cols-[1.35fr_1fr] lg:pt-24 lg:pb-24`}
        >
          <div className="flex flex-col gap-7">
            <Link
              href="/verify"
              className="rise glass inline-flex items-center gap-2.5 self-start rounded-full border border-white/10 py-1.5 pr-3.5 pl-1.5 text-sm text-ink-2 hover:text-ink"
              style={{ animationDelay: '40ms' }}
            >
              <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[11px] font-semibold text-onaccent">
                NEW
              </span>
              Escrow program is live on devnet <span aria-hidden="true">→</span>
            </Link>
            <h1
              id="hero-heading"
              className="rise m-0 text-[clamp(44px,5.4vw,80px)] font-semibold leading-[0.98] tracking-[-0.05em]"
              style={{ animationDelay: '90ms' }}
            >
              <SplitLine text="The verified edge," />
              <span className="block">
                <Serif className="text-accent">
                  <Shiny text="for sale." />
                </Serif>
              </span>
            </h1>
            <p
              className="rise m-0 max-w-xl text-lg leading-relaxed text-ink-2 sm:text-xl"
              style={{ animationDelay: '150ms' }}
            >
              Trading <TradingWords /> — every version scanned, scripts sandboxed, and an AI review
              (rules engine plus an LLM) decides in under a minute. Your SOL waits in escrow until
              the trade is done.
            </p>
            <div
              className="rise flex flex-wrap items-center gap-3"
              style={{ animationDelay: '210ms' }}
            >
              <PrimaryCta href="#market">
                Browse the market <span aria-hidden="true">→</span>
              </PrimaryCta>
              <ButtonLink
                href="/sell"
                variant="secondary"
                size="lg"
                className="glass border-white/10"
              >
                Sell your tooling
              </ButtonLink>
            </div>
            <dl
              className="rise m-0 grid max-w-xl grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10"
              style={{ animationDelay: '270ms' }}
            >
              {[
                ['5%', 'buyer fee, 0% for OG'],
                ['0%', 'creator commission'],
                [escrowWindowShort(escrowHours), 'escrow window'],
              ].map(([value, label]) => (
                <div key={label} className="glass flex flex-col gap-0.5 px-4 py-3.5">
                  <dt className="order-2 text-xs text-muted">{label}</dt>
                  <dd className="m-0 text-2xl font-semibold tracking-tight">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rise relative" style={{ animationDelay: '160ms' }}>
            <ReviewReceipt escrowHours={escrowHours} />
          </div>
        </div>
      </section>

      <TerminalBand />

      <div className={`${WRAP} space-y-24 pt-16`}>
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

        <section id="market" aria-labelledby="market-heading" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHead id="market-heading" kicker="Market" title="Trending" accent="this week" />
            <PillGroup data-testid="terminal-filter" role="group" aria-label="Filter by terminal">
              {TERMINALS.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={terminal === name}
                  className={pillClass(terminal === name)}
                  onClick={() => setTerminal(name)}
                >
                  {name === 'All' ? name : <TerminalName name={name} logoClassName="h-4 w-4" />}
                </button>
              ))}
            </PillGroup>
          </div>
          {!wallet.session ? (
            <div className="mt-6">
              <PreviewNotice onConnect={() => void wallet.connect()} />
            </div>
          ) : null}
          <div className="mt-8">
            <ListingGrid
              listings={listings ?? []}
              loading={listings === null}
              centsPerSol={cents}
              config={config}
              tier={wallet.session?.tier}
              wide
            />
          </div>
          {listings?.length ? (
            <div className="mt-8 flex justify-center">
              <ButtonLink href="/search" variant="secondary" size="sm">
                See all listings →
              </ButtonLink>
            </div>
          ) : null}
        </section>

        <Reveal>
          <section aria-labelledby="cat-heading">
            <SectionHead id="cat-heading" kicker="Categories" title="Find your" accent="edge" />
            <ul className="mt-10 grid gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORIES.map((cat) => (
                <li key={cat.code} className="list-none">
                  <Spot
                    color={cat.color}
                    alpha="40"
                    shape="beam"
                    className="motion-card h-full !rounded-panel"
                  >
                    <Link
                      href={`/c/${cat.code}`}
                      className="flex h-full min-h-52 flex-col justify-between gap-6 rounded-[inherit] p-7"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span
                          className="font-mono text-xs tracking-[0.16em]"
                          style={{ color: cat.color }}
                        >
                          {cat.short}
                        </span>
                        {catCounts && (
                          <span className="font-mono text-xs text-faint">
                            {catCounts[cat.code] ?? 0} live
                          </span>
                        )}
                      </span>
                      <span className="flex flex-col gap-2">
                        <span className="text-[28px] font-semibold tracking-[-0.03em]">
                          {cat.label}
                        </span>
                        <span className="text-sm text-muted">{cat.desc}</span>
                      </span>
                    </Link>
                  </Spot>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        <Reveal>
          <section aria-labelledby="how-heading">
            <SectionHead
              id="how-heading"
              kicker="How buying works"
              title="Four steps,"
              accent="no surprises."
            />
            <ol className="stagger relative mt-10 grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
              <li
                aria-hidden="true"
                className="pointer-events-none absolute top-[54px] right-[12%] left-[12%] hidden h-px list-none bg-gradient-to-r from-accent/0 via-accent/50 to-accent/0 lg:block"
              />
              {(
                [
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
                ] as const
              ).map(([title, body], index) => {
                const Icon = STEP_ICONS[index] ?? ScanSearch;
                return (
                  <li
                    key={title}
                    className="motion-card relative flex list-none flex-col gap-4 rounded-[22px] border border-line bg-surface/70 p-6"
                  >
                    <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-line bg-accent-bg text-accent">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="font-mono text-xs text-faint">STEP 0{index + 1}</span>
                    <h3 className="m-0 text-xl font-semibold tracking-tight">{title}</h3>
                    <p className="m-0 text-sm text-muted">{body}</p>
                  </li>
                );
              })}
            </ol>
          </section>
        </Reveal>

        <Reveal>
          <section
            aria-labelledby="creators-heading"
            data-testid="top-creators"
            className="grid items-start gap-10 lg:grid-cols-[1fr_1.4fr]"
          >
            <div>
              <SectionHead
                id="creators-heading"
                kicker="Leaderboard"
                title="Top creators"
                accent="this month"
              />
              <p className="mt-4 max-w-sm text-sm text-ink-2">
                Ranked on released sales, verified-buyer reviews and weighted upvotes. Paid
                featuring never changes a rank.
              </p>
              <Link
                href="/creators"
                className="mt-4 inline-block text-sm text-accent underline-offset-4 hover:underline"
              >
                Full leaderboard →
              </Link>
            </div>
            <div className="rounded-panel border border-line bg-surface p-3">
              <PillGroup role="tablist" aria-label="Top creators">
                {HOME_TABS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={creatorTab === value}
                    onClick={() => setCreatorTab(value)}
                    className={pillClass(creatorTab === value)}
                  >
                    {TAB_LABEL[value]}
                  </button>
                ))}
              </PillGroup>
              <div className="mt-3">
                {board === null ? (
                  <p className="m-0 p-3 text-muted">Loading creators…</p>
                ) : board === 'error' ? (
                  <p className="m-0 p-3 text-muted">Creator rankings are unavailable right now.</p>
                ) : board.rows.length === 0 ? (
                  <p className="m-0 p-3 text-muted" data-testid="top-creators-empty">
                    {creatorTab === 'earners'
                      ? 'No creator payouts in the last 30 days yet. The first released order puts a creator here.'
                      : creatorTab === 'rated'
                        ? `No creator has ${board.rules.topRatedMinReviews}+ verified reviews yet.`
                        : `No creator has ${board.rules.risingMinSales}+ sales this month yet.`}
                  </p>
                ) : (
                  <CreatorCards rows={board.rows} tab={creatorTab} centsPerSol={cents} />
                )}
              </div>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section aria-labelledby="fees-heading">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHead
                id="fees-heading"
                kicker="$TRENCH"
                title="Hold $TRENCH,"
                accent="pay less."
              />
              <Link
                href="/token"
                className="text-sm text-accent underline-offset-4 hover:underline"
              >
                See tiers and savings →
              </Link>
            </div>
            <p className="mt-4 max-w-xl text-ink-2">
              Buyers pay a 5% fee on top of the listing price. Your $TRENCH tier cuts it, down to
              zero for OG holders. Creators keep 100% of the listing price.
            </p>
            <div className="mt-8 rounded-panel border border-line bg-surface p-5">
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
            <div className="mt-10 grid gap-4 md:grid-cols-3">
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
              ].map(([title, body], index) => {
                const [Icon, color] = TRUST_ICONS[index] ?? [ShieldCheck, '#C6F432'];
                return (
                  <Spot
                    key={title}
                    color={color}
                    alpha="33"
                    className="motion-card !rounded-[22px]"
                  >
                    <div className="flex flex-col gap-4 p-7">
                      <Icon size={26} style={{ color }} aria-hidden="true" />
                      <h3 className="m-0 text-xl font-semibold tracking-tight">{title}</h3>
                      <p className="m-0 text-muted">{body}</p>
                    </div>
                  </Spot>
                );
              })}
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section
            aria-labelledby="sell-cta-heading"
            data-testid="sell-cta"
            className="relative overflow-hidden rounded-[36px] border border-accent/25 bg-[#080a06]"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(198,244,50,0.16),transparent_70%)]"
            />
            <CtaRays />
            <div className="relative flex flex-col items-center gap-6 px-6 py-24 text-center">
              <Wallet size={28} className="text-accent" aria-hidden="true" />
              <h2
                id="sell-cta-heading"
                className="m-0 text-[clamp(40px,6.5vw,88px)] font-semibold leading-[0.95] tracking-[-0.05em]"
              >
                Have an edge? <Serif className="text-accent">Sell it.</Serif>
              </h2>
              <p className="m-0 max-w-lg text-lg text-ink-2">
                Upload a file and watch the automated review run live. 0% commission, payouts in
                SOL.
              </p>
              <PrimaryCta href="/sell">
                Start selling <span aria-hidden="true">→</span>
              </PrimaryCta>
            </div>
          </section>
        </Reveal>
      </div>
    </div>
  );
}

const WRAP = 'mx-auto max-w-7xl px-4 sm:px-6';

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
    <div className="flex flex-col gap-3">
      <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-accent-label">
        {kicker}
      </span>
      <h2
        id={id}
        className="m-0 text-[clamp(30px,4vw,52px)] font-semibold leading-[1.02] tracking-[-0.035em]"
      >
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

function ReviewReceipt({ escrowHours }: { escrowHours: number }) {
  const steps: [string, string][] = [
    ['Static scan', '14 rules · 0 findings'],
    ['Sandboxed run', 'axiom.trade/pulse · allowlisted hosts'],
    ['Rules engine', 'rules@1.0.0 · approve'],
    ['LLM review', 'can only tighten'],
  ];
  return (
    <figure className="m-0">
      <GlowPanel className="shadow-[0_30px_80px_-40px_rgba(198,244,50,0.25)]">
        <div className="flex flex-col gap-5 p-6 font-mono text-[13px]">
          <div className="flex items-center justify-between border-b border-dashed border-white/12 pb-4">
            <span className="tracking-[0.16em] text-muted">REVIEW RECEIPT</span>
            <Tag tone="ok">
              <span aria-hidden="true">✓</span> PASSED · 4.9s
            </Tag>
          </div>
          <div className="font-sans">
            <div className="text-lg font-semibold tracking-tight">axiom-pulse-filter.user.js</div>
            <div className="text-sm text-muted">Userscript · Axiom</div>
          </div>
          <ol className="m-0 flex flex-col gap-2.5 p-0">
            {steps.map(([name, detail], index) => (
              <li key={name} className="flex list-none items-center justify-between gap-3">
                <span className="min-w-0 text-ink-2">
                  <span className="text-muted">0{index + 1}</span> {name}{' '}
                  <span className="text-muted">· {detail}</span>
                </span>
                <span className="shrink-0 text-accent">
                  <span aria-hidden="true">✓</span> PASS
                </span>
              </li>
            ))}
          </ol>
          <div className="rounded-xl border border-white/8 bg-black/40 p-3.5">
            <div className="mb-1 text-[11px] text-muted">SHA-256 PINNED</div>
            <div className="break-all text-info">9f2c4be1…e41a</div>
          </div>
          <div className="flex justify-between rounded-xl bg-white/[.04] p-3.5">
            <span className="text-muted">Escrow</span>
            <span className="text-ink-2">
              {escrowWindowShort(escrowHours)} · download once paid
            </span>
          </div>
        </div>
      </GlowPanel>
      <figcaption className="mt-2 text-center text-xs text-muted">
        Example review receipt (illustration)
      </figcaption>
    </figure>
  );
}

// Stat tiles show SOL large (sans, one line) with the USD value as a small caption.
const STAT_MONEY =
  '!font-sans whitespace-nowrap [&>[data-testid=usd-amount]]:mt-1 [&>[data-testid=usd-amount]]:font-mono [&>[data-testid=usd-amount]]:text-sm';

function LandingStats({ stats, failed }: { stats: Stats | null; failed: boolean }) {
  const tiles: [string, ReactNode][] = stats
    ? [
        ['Live listings', stats ? <StatCount key="listings" value={stats.listings} /> : null],
        ['Creators', stats ? <StatCount key="creators" value={stats.creators} /> : null],
        ['Orders paid', stats ? <StatCount key="orders" value={stats.orders} /> : null],
        [
          'Volume traded',
          <Money
            key="v"
            lamports={stats.volume.lamports}
            usdCents={stats.volume.usdCents}
            stacked
            className={STAT_MONEY}
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
                className={STAT_MONEY}
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
        className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line lg:grid-cols-5"
      >
        {tiles.map(([label, value], index) => (
          <div
            key={label}
            className="flex flex-col gap-1 bg-surface p-6 last:col-span-2 lg:last:col-span-1"
          >
            <div
              className={`tabular order-1 text-[28px] font-semibold tracking-[-0.03em] sm:text-4xl ${index === 4 ? 'text-accent' : 'text-ink'}`}
            >
              {value ?? (failed ? '—' : <Skeleton className="h-9 w-24" />)}
            </div>
            <span className="order-2 text-sm text-muted">{label}</span>
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
