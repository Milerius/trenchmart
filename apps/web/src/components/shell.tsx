'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type FormEvent, type ReactNode } from 'react';
import { NetworkBanner } from '@/components/ui';
import { tierChip, usePublicConfig } from '@/lib/config';
import { useWallet, WalletProvider } from '@/lib/wallet';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="TrenchMart home">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0A0B0A"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 18 L9 8 L13 14 L16 9 L20 18" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-[-0.02em]">trenchmart</span>
    </Link>
  );
}

function Ticker() {
  return (
    <div className="hidden border-b border-line-soft bg-inset font-mono text-xs text-muted sm:block">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-7 gap-y-1 px-6 py-2">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          Solana devnet · live
        </span>
        <span>
          Holders: <span className="text-ink">up to 100% off the 5% fee</span>
        </span>
        <span>
          Creators: <span className="text-ink">0% commission</span>
        </span>
        <span className="ml-auto">Every version scanned, sandboxed and AI-verified in seconds</span>
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
              className={`rounded-lg px-3 py-2.5 whitespace-nowrap ${active(link.href) ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}
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
            className="h-11 rounded-ctl bg-accent px-4 font-mono text-sm font-semibold text-onaccent hover:bg-accent-hover disabled:opacity-100"
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
        <p role="alert" className="mx-auto max-w-7xl px-6 pb-3 text-sm text-danger">
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
        <span className="font-bold text-ink">trenchmart</span>
        <Link href="/verify" className="hover:text-ink">
          Verify a file
        </Link>
        <Link href="/token" className="hover:text-ink">
          Fees &amp; $TRENCH
        </Link>
        <Link href="/sell" className="hover:text-ink">
          How AI verification works
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
