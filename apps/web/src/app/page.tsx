'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { CATEGORIES } from '@trenchmart/shared';
import { TierTable } from '@/components/fees';
import { ListingGrid, TERMINALS, type Listing } from '@/components/listings';
import {
  ButtonLink,
  Label,
  Money,
  PreviewNotice,
  ShieldIcon,
  Skeleton,
  Tag,
} from '@/components/ui';
import { api } from '@/lib/api';
import { usePublicConfig } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

type Stats = {
  source: 'mock' | 'live';
  note?: string;
  listings: number;
  creators: number;
  orders: number;
  volume: { lamports: string; sol: string; usdCents: string | null };
  solUsd: { centsPerSol: string | null };
};

type Creator = { handle: string | null; wallet: string; volume: string; listings: number };

export default function HomePage() {
  const wallet = useWallet();
  const config = usePublicConfig();
  const [terminal, setTerminal] = useState('All');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [creators, setCreators] = useState<Creator[]>([]);

  useEffect(() => {
    const query =
      terminal === 'All' ? '' : `?terminal=${encodeURIComponent(terminal)}&sort=trending`;
    void api<Listing[]>(`/listings${query}`)
      .then(setListings)
      .catch(() => setListings([]));
  }, [terminal, wallet.session?.wallet]);

  useEffect(() => {
    void api<Stats>('/stats')
      .then(setStats)
      .catch(() => setStatsFailed(true));
    void api<Creator[]>('/creators/top')
      .then(setCreators)
      .catch(() => setCreators([]));
  }, []);

  const cents = stats?.solUsd.centsPerSol ?? null;
  const escrowHours = config?.escrowHours ?? 48;

  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="m-0 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Solana marketplace · AI-verified · escrowed
          </p>
          <h1 className="mt-4 text-[42px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[58px]">
            The verified edge, for sale.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Buy and sell trading scripts, terminal filters and wallet lists. Every version is
            scanned, run in a sandbox and checked by AI verification in seconds. Your SOL waits in
            escrow until the trade is done.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="#market" size="lg">
              Browse the market
            </ButtonLink>
            <ButtonLink href="/sell" variant="secondary" size="lg">
              Sell your tooling
            </ButtonLink>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-ink-2">
            <li className="flex items-center gap-2">
              <Check /> 5% buyer fee, up to 100% off with $TRENCH
            </li>
            <li className="flex items-center gap-2">
              <Check /> 0% creator commission
            </li>
            <li className="flex items-center gap-2">
              <Check /> {escrowHours}h escrow on every order
            </li>
          </ul>
        </div>
        <ReviewReceipt />
      </section>

      <LandingStats stats={stats} failed={statsFailed} />

      <section aria-labelledby="how-heading">
        <SectionHead id="how-heading" kicker="How buying works" title="Four steps, no surprises." />
        <ol className="mt-8 grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              'Pick a verified tool',
              'Every listing shows its AI verification result, the checks it passed and the file hash.',
            ],
            [
              'See your exact price',
              'Price, 5% fee, your tier discount and 0% creator commission, itemised before you sign.',
            ],
            [
              'Pay into escrow',
              `Your SOL is held in escrow for ${escrowHours} hours. Open a dispute any time in that window.`,
            ],
            [
              'Download on release',
              'When escrow releases, the download unlocks: a copy watermarked to your wallet.',
            ],
          ].map(([title, body], index) => (
            <li key={title} className="list-none rounded-card border border-line bg-surface p-5">
              <span className="font-mono text-xs text-accent">0{index + 1}</span>
              <h3 className="mt-3 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-ink-2">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="market" aria-labelledby="market-heading" className="scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead id="market-heading" kicker="Market" title="Trending this week" />
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
                className={`h-9 rounded-full border px-3.5 text-[13px] transition-colors ${
                  terminal === name
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-line-control text-ink-2 hover:text-ink'
                }`}
                onClick={() => setTerminal(name)}
              >
                {name}
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

      <section aria-labelledby="cat-heading">
        <SectionHead id="cat-heading" kicker="Categories" title="Find your edge" />
        <ul className="mt-8 grid gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <li key={cat.code} className="list-none">
              <Link
                href={`/c/${cat.code}`}
                className="flex h-full flex-col gap-2 rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong"
              >
                <span className="font-mono text-[11px] tracking-wide" style={{ color: cat.color }}>
                  {cat.short}
                </span>
                <span className="text-base font-semibold">{cat.label}</span>
                <span className="text-sm text-ink-2">{cat.desc}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="fees-heading" className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <SectionHead id="fees-heading" kicker="Fees" title="Hold $TRENCH, pay less." />
          <p className="mt-4 max-w-md text-ink-2">
            Buyers pay a 5% fee on top of the listing price. Your $TRENCH tier cuts it, down to zero
            for OG holders. Creators keep 100% of the listing price.
          </p>
          <ButtonLink href="/token" variant="secondary" className="mt-6">
            See tiers and savings
          </ButtonLink>
        </div>
        <div className="rounded-panel border border-line bg-surface p-5">
          <TierTable config={config} current={wallet.session?.tier} />
        </div>
      </section>

      <section aria-labelledby="trust-heading">
        <SectionHead
          id="trust-heading"
          kicker="Trust"
          title="Built so you don't have to trust anyone."
        />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            [
              'Escrow on every order',
              `The creator is paid only after ${escrowHours} hours with no dispute. A dispute freezes the funds until it is settled.`,
            ],
            [
              'Squads multisig vault',
              'Escrowed SOL sits in a Squads multisig vault. The app holds no key that can move it; payouts need multisig signers.',
            ],
            [
              'Sandboxed AI review',
              'Each file is statically scanned, run in an isolated sandbox with logged network calls, then reviewed by AI.',
            ],
          ].map(([title, body]) => (
            <div key={title} className="rounded-card border border-line bg-surface p-5">
              <ShieldIcon className="text-accent" />
              <h3 className="mt-3 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-ink-2">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="creators-heading">
        <SectionHead id="creators-heading" kicker="Creators" title="Top verified creators" />
        {creators.length === 0 ? (
          <p className="mt-6 text-muted">No creator volume yet.</p>
        ) : (
          <ol className="mt-6 grid gap-2 p-0 md:grid-cols-2">
            {creators.slice(0, 6).map((creator, index) => (
              <li key={creator.wallet} className="list-none">
                <Link
                  href={`/u/${creator.handle ?? creator.wallet}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 hover:border-line-strong"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 font-mono text-xs text-muted">{index + 1}</span>
                    <span className="font-medium">
                      @{creator.handle ?? creator.wallet.slice(0, 4)}
                    </span>
                    <span className="text-xs text-muted">
                      {creator.listings} listing{creator.listings === 1 ? '' : 's'}
                    </span>
                  </span>
                  <Money lamports={creator.volume} centsPerSol={cents} className="text-sm" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-6 rounded-panel border border-accent-line bg-accent-bg p-8">
        <div>
          <h2 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Have an edge? Sell it.</h2>
          <p className="mt-2 max-w-lg text-ink-2">
            Upload a file and watch AI verification run live. 0% commission, payouts in SOL.
          </p>
        </div>
        <ButtonLink href="/sell" size="lg">
          Start selling
        </ButtonLink>
      </section>
    </div>
  );
}

function SectionHead({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <div>
      <Label className="text-accent-label">{kicker}</Label>
      <h2 id={id} className="mt-2 text-[28px] font-semibold tracking-[-0.025em]">
        {title}
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
    ['AI verdict', 'Behaviour matches description', '2.6s'],
  ];
  return (
    <figure className="m-0 overflow-hidden rounded-panel border border-line bg-surface shadow-[0_30px_80px_-40px_rgba(198,244,50,0.25)]">
      <div className="flex items-center justify-between border-b border-line-soft bg-inset px-5 py-3">
        <span className="font-mono text-xs text-muted">ai-review · axiom-pulse-filter.user.js</span>
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
          <span className="text-ink-2">48h · download on release</span>
        </div>
      </div>
      <figcaption className="border-t border-line-soft px-5 py-2.5 text-xs text-muted">
        Example AI review receipt
      </figcaption>
    </figure>
  );
}

function LandingStats({ stats, failed }: { stats: Stats | null; failed: boolean }) {
  const tiles: [string, ReactNode][] = stats
    ? [
        ['Live listings', stats.listings.toLocaleString('en-US')],
        ['Verified creators', stats.creators.toLocaleString('en-US')],
        ['Orders paid', stats.orders.toLocaleString('en-US')],
        [
          'Volume traded',
          <Money
            key="v"
            lamports={stats.volume.lamports}
            usdCents={stats.volume.usdCents}
            stacked
          />,
        ],
      ]
    : [
        ['Live listings', null],
        ['Verified creators', null],
        ['Orders paid', null],
        ['Volume traded', null],
      ];
  return (
    <section data-testid="dashboard" aria-label="Marketplace stats">
      <div
        data-testid="landing-stats"
        data-source={stats?.source ?? 'none'}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4"
      >
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-surface p-5">
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
