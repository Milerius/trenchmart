'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ListingGrid, TERMINALS, type Listing } from '@/components/listings';
import { api } from '@/lib/api';
import { moneyText } from '@/lib/money';

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
  const [terminal, setTerminal] = useState('All');
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [creators, setCreators] = useState<Creator[]>([]);

  useEffect(() => {
    const query =
      terminal === 'All' ? '' : `?terminal=${encodeURIComponent(terminal)}&sort=trending`;
    void api<Listing[]>(`/listings${query}`)
      .then(setListings)
      .catch(() => setListings([]));
  }, [terminal]);

  useEffect(() => {
    void api<Stats>('/stats')
      .then(setStats)
      .catch(() => setStats(null));
    void api<Creator[]>('/creators/top')
      .then(setCreators)
      .catch(() => setCreators([]));
  }, []);

  const cents = stats?.solUsd.centsPerSol ?? null;

  return (
    <div className="space-y-10">
      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-accent">
            Solana first · more chains later
          </p>
          <h1 className="mt-3 text-4xl leading-tight">The verified edge, for sale.</h1>
          <p className="mt-4 max-w-xl text-muted">
            Scripts, filters, and wallet lists are scanned and checked by an automated AI verifier
            before they go live. Escrow holds the SOL until the trade finishes.
          </p>
          <div className="mt-6 flex gap-3">
            <a
              href="#market"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-onaccent"
            >
              Browse the market
            </a>
            <Link href="/sell" className="rounded-md border border-line px-4 py-2 text-sm">
              Sell your tooling
            </Link>
          </div>
        </div>
        <aside className="rounded-xl border border-line bg-surface p-4 font-mono text-xs text-muted">
          <p>AI verified · hash pinned · escrowed</p>
          <p className="mt-3 text-ink">No human review queue. Downloads unlock after release.</p>
        </aside>
      </section>

      <section data-testid="dashboard" className="grid gap-3 sm:grid-cols-4">
        <Stat label="Listings" value={String(stats?.listings ?? '—')} />
        <Stat label="Creators" value={String(stats?.creators ?? '—')} />
        <Stat label="Orders" value={String(stats?.orders ?? '—')} />
        <Stat
          label="Volume"
          value={stats ? moneyText(stats.volume.lamports, stats.volume.usdCents) : '—'}
        />
        {stats?.source === 'mock' ? (
          <p className="sm:col-span-4 text-sm text-faint">
            {stats.note ?? 'Sample figures until a listing goes live.'}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-xl">Categories</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {['userscript', 'wallet_list', 'filter', 'setup', 'strategy', 'alerts'].map((code) => (
            <li key={code}>
              <Link href={`/c/${code}`} className="block rounded-xl border border-line p-4">
                {code.replace('_', ' ')}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="market">
        <h2 className="text-xl">Trending this week</h2>
        <div data-testid="terminal-filter" className="mt-4 flex flex-wrap gap-2">
          {TERMINALS.map((name) => (
            <button
              key={name}
              type="button"
              className={`rounded-full border px-3 py-1 text-sm ${terminal === name ? 'border-accent text-accent' : 'border-line'}`}
              onClick={() => setTerminal(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <ListingGrid listings={listings} centsPerSol={cents} />
        </div>
      </section>

      <section>
        <h2 className="text-xl">Top verified creators</h2>
        <ol className="mt-4 space-y-2">
          {creators.map((creator, index) => (
            <li key={creator.wallet}>
              <Link
                href={`/u/${creator.handle ?? creator.wallet}`}
                className="flex justify-between rounded-lg border border-line px-3 py-2"
              >
                <span>
                  {index + 1}. @{creator.handle ?? creator.wallet.slice(0, 4)}
                </span>
                <span className="font-mono text-sm">{moneyText(creator.volume, null)}</span>
              </Link>
            </li>
          ))}
          {creators.length === 0 ? <li className="text-muted">No creator volume yet.</li> : null}
        </ol>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="mt-2 font-mono text-sm">{value}</p>
    </div>
  );
}
