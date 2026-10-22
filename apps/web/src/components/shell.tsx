'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { preload } from 'react-dom';
import { Menu, Search, X } from 'lucide-react';
import { NetworkBanner } from '@/components/ui';
import { type ActivityEvent, activityText, type SponsoredChip } from '@/components/activity';
import { api } from '@/lib/api';
import { tierChip, usePublicConfig } from '@/lib/config';
import { useWallet, WalletProvider } from '@/lib/wallet';
import { WalletMenu } from '@/components/wallet-menu';
import {
  DEVNET_ADDRESSES,
  ESCROW_PROGRAM_ID,
  explorerAddress,
  shortKey,
} from '@/lib/protocol-facts';

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
    <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="TrenchMart home">
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
    // The ticker is hidden below sm: phones skip its reads entirely.
    if (!window.matchMedia('(min-width: 640px)').matches) return;
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

function Nav({ social }: { social?: Social }) {
  const wallet = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const config = usePublicConfig();
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" jumps to search from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const q = String(data.get('q') ?? '').trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  }

  // Prototype nav: Explore, Creators, $TRENCH, Verify, Docs (+ Studio once signed in).
  const links = [
    { href: '/search', label: 'Explore' },
    { href: '/creators', label: 'Creators' },
    { href: '/token', label: '$TRENCH' },
    { href: '/verify', label: 'Verify' },
    { href: '/docs', label: 'Docs' },
    ...(wallet.session ? [{ href: '/studio', label: 'Studio' }] : []),
  ];
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  const searchForm = (mobile: boolean) => (
    <form
      onSubmit={search}
      role="search"
      className={
        mobile
          ? 'flex w-full'
          : 'ml-auto hidden min-w-0 md:flex md:w-56 md:shrink lg:w-44 xl:w-56 2xl:w-64'
      }
    >
      <label className="flex h-10 w-full items-center gap-2 rounded-full border border-line-control bg-inset px-3.5 focus-within:border-accent/60">
        <Search size={15} aria-hidden="true" className="shrink-0 text-muted" />
        <input
          ref={mobile ? undefined : searchRef}
          data-testid={mobile ? 'search-mobile' : 'search'}
          name="q"
          type="search"
          aria-label="Search listings"
          placeholder="Search scripts, wallets, filters"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
        {mobile ? null : (
          <kbd
            aria-hidden="true"
            className="rounded border border-line px-1.5 font-mono text-[10px] text-muted"
          >
            /
          </kbd>
        )}
      </label>
    </form>
  );

  return (
    // Glass and sticky only from md up: a backdrop blur over scrolling content is the
    // costliest paint on low-end phone GPUs.
    <header
      data-testid="nav"
      className="z-40 border-b border-line-soft bg-bg md:sticky md:top-0 md:border-white/[.06] md:bg-[rgba(16,18,16,0.6)] md:backdrop-blur-[18px] md:backdrop-saturate-[1.4]"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        <Logo />
        <nav
          aria-label="Primary"
          className="ml-4 hidden shrink-0 items-center gap-1 text-sm lg:flex"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active(link.href) ? 'page' : undefined}
              className={`motion-nav rounded-full px-3.5 py-2 whitespace-nowrap ${active(link.href) ? 'bg-white/[.08] text-ink' : 'text-ink-2 hover:bg-white/[.05] hover:text-ink'}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {searchForm(false)}
        <Link
          href="/sell"
          aria-current={active('/sell') ? 'page' : undefined}
          className={`motion-nav hidden rounded-full px-3.5 py-2 text-sm whitespace-nowrap sm:block ${active('/sell') ? 'bg-white/[.08] text-ink' : 'text-ink-2 hover:text-ink'}`}
        >
          Sell
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
          {/* Icon links only when there is room for them next to the nav and search. */}
          {social ? (
            <div data-testid="header-social" className="mr-1 hidden shrink-0 xl:block">
              {social.header}
            </div>
          ) : null}
          {wallet.session ? (
            <span
              data-testid="tier-pill"
              title={tierChip(wallet.session.tier, config)}
              className="hidden h-10 shrink-0 items-center rounded-full border border-accent-line bg-accent-bg px-4 font-mono text-xs whitespace-nowrap text-accent xl:flex"
            >
              {/* Short "5% fee" until 2xl; the tier name joins once the header has room. */}
              <span className="hidden 2xl:inline">
                {tierChip(wallet.session.tier, config).split(' · ')[0]} ·&nbsp;
              </span>
              {tierChip(wallet.session.tier, config).split(' · ').slice(1).join(' · ')}
            </span>
          ) : null}
          <WalletMenu />
          <button
            type="button"
            data-testid="menu-toggle"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:text-ink lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {menuOpen ? (
        <nav
          id="mobile-menu"
          data-testid="mobile-menu"
          aria-label="Mobile"
          className="flex flex-col gap-1 border-t border-line px-4 py-3 sm:px-6 lg:hidden"
        >
          <div className="pb-2 md:hidden">{searchForm(true)}</div>
          {[...links, { href: '/sell', label: 'Sell' }].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active(link.href) ? 'page' : undefined}
              className={`block rounded-lg px-3 py-3 ${active(link.href) ? 'bg-white/[.06] text-ink' : 'text-ink-2 hover:bg-white/5 hover:text-ink'}`}
            >
              {link.label}
            </Link>
          ))}
          {social?.menu}
        </nav>
      ) : null}
      {wallet.error ? (
        <p
          role="alert"
          data-testid="toast"
          className="toast mx-auto flex max-w-7xl items-start gap-3 px-6 pb-3 text-sm text-danger"
        >
          <span className="flex-1">{wallet.error}</span>
          <button
            type="button"
            data-testid="toast-dismiss"
            aria-label="Dismiss"
            className="text-muted hover:text-ink"
            onClick={wallet.clearError}
          >
            ×
          </button>
        </p>
      ) : null}
    </header>
  );
}

const FOOTER_COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: 'Market',
    links: [
      ['Explore', '/search'],
      ['Creators', '/creators'],
      ['Sell', '/sell'],
      ['Creator Studio', '/studio'],
    ],
  },
  {
    title: 'Trust',
    links: [
      ['Verify & proof', '/verify'],
      ['How automated review works', '/sell'],
      ['Fees & $TRENCH', '/token'],
      ['Status', '/status'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['Docs', '/docs'],
      ['Terms', '/terms'],
      ['Privacy', '/privacy'],
    ],
  },
];

function Footer({ social }: { social?: Social }) {
  const addresses: [string, string, string | undefined][] = [
    ['Escrow program (devnet)', ESCROW_PROGRAM_ID, 'footer-program'],
    ['Squads multisig', DEVNET_ADDRESSES.multisig, undefined],
    ['$TRENCH mint', DEVNET_ADDRESSES.trenchMint, undefined],
  ];
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-4">
          <span className="flex items-center gap-2.5 font-bold tracking-[-0.02em] text-ink">
            <LogoMark className="h-6 w-6" />
            trenchmart
          </span>
          <p className="m-0 max-w-xs text-sm text-muted">
            Reviewed trading tools, escrowed on Solana. 0% creator commission.
          </p>
          {social?.footer}
          <ul className="m-0 flex flex-col gap-1.5 p-0 font-mono text-xs text-muted">
            {addresses.map(([label, address, testId]) => (
              <li key={address} className="list-none">
                <a
                  href={explorerAddress(address)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink"
                  data-testid={testId}
                >
                  {label} · {shortKey(address)} <span aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title} className="flex flex-col gap-2.5">
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
              {column.title}
            </span>
            {column.links.map(([label, href]) => (
              <Link key={label} href={href} className="text-sm text-ink-2 hover:text-accent">
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <p className="m-0 border-t border-line-soft px-6 py-5 text-center font-mono text-xs text-muted">
        Devnet POC. Test SOL only. Not financial advice. Tools don&apos;t guarantee profits.
      </p>
    </footer>
  );
}

// Reads every page needs right away (session, fee config). Preloading them in the HTML starts
// them in parallel with the JS download. Below-the-fold reads (ticker, home sections) are not
// preloaded: on a phone they would compete with the first paint for the connection.
// The mode must match api(): same-origin with credentials ('use-credentials'), or the
// browser fetches twice. These are hints only; nothing here changes what is cached.
// Pages that draw their own full-width hero and content column.
const FULL_BLEED = new Set(['/', '/search', '/creators', '/token', '/verify', '/sell']);
const FULL_BLEED_PREFIXES = ['/c/', '/u/'];

const PRELOADED_READS = ['/api/v1/me', '/api/v1/config/public'];

/** Server-rendered link groups (see social-links.tsx): HTML only, no client JS. */
export type Social = { header: ReactNode; menu: ReactNode; footer: ReactNode };

export function Shell({ children, social }: { children: ReactNode; social?: Social }) {
  // Redesigned pages lay out their own full-width hero and column; the rest get the column.
  const path = usePathname();
  const fullBleed = FULL_BLEED.has(path) || FULL_BLEED_PREFIXES.some((p) => path.startsWith(p));
  for (const href of PRELOADED_READS)
    preload(href, { as: 'fetch', crossOrigin: 'use-credentials' });
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
      <Nav social={social} />
      {/* overflow-x-clip lets a page paint full-width glows without a horizontal scrollbar. */}
      <main id="content" className="overflow-x-clip">
        {fullBleed ? (
          children
        ) : (
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</div>
        )}
      </main>
      <Footer social={social} />
    </WalletProvider>
  );
}
