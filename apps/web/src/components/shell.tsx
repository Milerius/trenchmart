'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NetworkBanner } from '@/components/ui';
import { type ActivityEvent, activityText, type SponsoredChip } from '@/components/activity';
import { api } from '@/lib/api';
import { tierChip, usePublicConfig } from '@/lib/config';
import { useWallet, WalletProvider } from '@/lib/wallet';
import { ESCROW_PROGRAM_ID, explorerAddress, shortKey } from '@/lib/protocol-facts';

/** Same geometry as brand/logo-mark.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#C6F432" />
      <g fill="none" stroke="#0A0B0A" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M17 15 27 23 17 31" />
        <path d="M11 43H23V51H41V43H53" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="TrenchMart home">
      <LogoMark className="h-8 w-8" />
      <span className="text-lg font-bold tracking-[-0.02em]">trenchmart</span>
    </Link>
  );
}

const TICKER_FACTS = [
  'Solana devnet · live',
  'Holders: up to 100% off the 5% fee',
  'Creators: 0% commission',
  'Every version scanned; scripts sandboxed; AI review: rules engine + LLM',
];

function Ticker() {
  const [items, setItems] = useState(TICKER_FACTS);

  useEffect(() => {
    let stop = false;
    const fromListings = () =>
      api<{ title: string }[]>('/listings')
        .then((rows) => {
          const titles = rows
            .map((row) => row.title)
            .filter(Boolean)
            .slice(0, 8)
            .map((title) => `Listing · ${title}`);
          if (titles.length && !stop) setItems([...TICKER_FACTS, ...titles]);
        })
        .catch(() => undefined);
    // Real marketplace events first; listing titles only while nothing has happened yet.
    void api<{ events: ActivityEvent[]; sponsored?: SponsoredChip[] }>('/activity?limit=12')
      .then((body) => {
        const events = Array.isArray(body?.events) ? body.events : [];
        const sponsored = Array.isArray(body?.sponsored) ? body.sponsored : [];
        if (stop) return;
        const paid = sponsored.map((chip) => `FEATURED · SPONSORED · ${chip.listing.title}`);
        if (events.length || paid.length)
          setItems([...paid, ...events.map(activityText), ...TICKER_FACTS]);
        else void fromListings();
      })
      .catch(() => void fromListings());
    return () => {
      stop = true;
    };
  }, []);

  const row = (copy: string) =>
    items.map((item, index) => (
      <span key={`${copy}-${index}`} className="inline-flex items-center gap-2 whitespace-nowrap">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
        {item}
      </span>
    ));

  return (
    <div
      data-testid="ticker"
      className="hidden h-8 overflow-hidden border-b border-line-soft bg-inset font-mono text-xs text-muted sm:block"
    >
      <div data-testid="ticker-track" className="ticker-track h-8 items-center px-6">
        <span className="ticker-set inline-flex items-center gap-8">{row('a')}</span>
        <span className="ticker-set inline-flex items-center gap-8" aria-hidden="true">
          {row('b')}
        </span>
      </div>
    </div>
  );
}

function Nav() {
  const wallet = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const config = usePublicConfig();
  useEffect(() => {
    void wallet.refresh();
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const q = String(data.get('q') ?? '').trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  }

  const links = [
    { href: '/', label: 'Explore' },
    { href: '/sell', label: 'Sell' },
    { href: '/token', label: '$TRENCH' },
    ...(wallet.session
      ? [
          { href: '/me/purchases', label: 'Purchases' },
          { href: '/studio', label: 'Studio' },
        ]
      : [{ href: '/creators', label: 'Creators' }]),
  ];
  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header data-testid="nav" className="border-b border-line-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6 sm:py-4">
        <Logo />
        <nav
          aria-label="Primary"
          className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:ml-3 sm:w-auto"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active(link.href) ? 'page' : undefined}
              className={`motion-nav rounded-lg px-3 py-2.5 whitespace-nowrap ${active(link.href) ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <form
          onSubmit={search}
          role="search"
          className="order-4 flex min-w-0 flex-1 sm:order-none sm:min-w-56"
        >
          <label className="flex h-11 w-full items-center gap-2.5 rounded-ctl border border-line-control bg-surface px-3.5">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9BA19A"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              data-testid="search"
              name="q"
              type="search"
              aria-label="Search listings"
              placeholder="Search scripts, wallet lists, filters, creators…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </label>
        </form>
        <div className="ml-auto flex items-center gap-2">
          {wallet.session ? (
            <span
              data-testid="tier-pill"
              className="hidden h-11 items-center rounded-ctl border border-accent-line bg-accent-bg px-3 font-mono text-xs text-accent md:flex"
            >
              {tierChip(wallet.session.tier, config)}
            </span>
          ) : null}
          <button
            data-testid="connect"
            type="button"
            className="motion-press h-11 rounded-ctl bg-accent px-4 font-mono text-sm font-semibold text-onaccent hover:bg-accent-hover disabled:opacity-100"
            onClick={() => void (wallet.session ? wallet.logout() : wallet.connect())}
            disabled={wallet.busy}
            aria-busy={wallet.busy || undefined}
          >
            {wallet.session
              ? `${wallet.session.wallet.slice(0, 4)}…${wallet.session.wallet.slice(-4)}`
              : wallet.busy
                ? 'Check your wallet…'
                : 'Connect wallet'}
          </button>
        </div>
      </div>
      {wallet.error ? (
        <p
          role="alert"
          data-testid="toast"
          className="toast mx-auto max-w-7xl px-6 pb-3 text-sm text-danger"
        >
          {wallet.error}
        </p>
      ) : null}
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-line-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-x-7 gap-y-3 px-6 py-7 text-[13px] text-muted">
        <span className="flex items-center gap-2 font-bold text-ink">
          <LogoMark className="h-5 w-5" />
          trenchmart
        </span>
        <Link href="/verify" className="hover:text-ink">
          Verify &amp; proof
        </Link>
        <a
          href={explorerAddress(ESCROW_PROGRAM_ID)}
          target="_blank"
          rel="noreferrer"
          className="font-mono hover:text-ink"
          data-testid="footer-program"
        >
          Escrow program (devnet) {shortKey(ESCROW_PROGRAM_ID)} ↗
        </a>
        <Link href="/token" className="hover:text-ink">
          Fees &amp; $TRENCH
        </Link>
        <Link href="/sell" className="hover:text-ink">
          How automated review works
        </Link>
        <Link href="/docs" className="hover:text-ink">
          Docs
        </Link>
        <Link href="/terms" className="hover:text-ink">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <span className="sm:ml-auto">
          Devnet POC. Not financial advice. Tools don&apos;t guarantee profits.
        </span>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-ctl focus:bg-accent focus:px-4 focus:py-2 focus:text-onaccent"
      >
        Skip to content
      </a>
      <NetworkBanner />
      <Ticker />
      <Nav />
      <main id="content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
      <Footer />
    </WalletProvider>
  );
}
