'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type FormEvent, type ReactNode } from 'react';
import { useWallet, WalletProvider } from '@/lib/wallet';

function Nav() {
  const wallet = useWallet();
  const router = useRouter();
  useEffect(() => {
    void wallet.refresh();
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const q = String(data.get('q') ?? '').trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  }

  return (
    <header data-testid="nav" className="border-b border-line">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" className="font-mono text-sm tracking-wide text-accent">
          TRENCHMART
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/">Explore</Link>
          <Link href="/sell">Sell</Link>
          <Link href="/token">$TRENCH</Link>
          <Link href="/creators">Creators</Link>
        </nav>
        <form onSubmit={search} className="ml-auto flex min-w-48 flex-1">
          <input
            data-testid="search"
            name="q"
            aria-label="Search listings"
            placeholder="Search listings"
            className="w-full rounded-md border border-line bg-inset px-3 py-2 text-sm"
          />
        </form>
        {wallet.session ? (
          <span
            data-testid="tier-pill"
            className="rounded-full border border-line px-3 py-1 text-xs"
          >
            {wallet.session.tier}
          </span>
        ) : null}
        <button
          data-testid="connect"
          type="button"
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-onaccent"
          onClick={() => void (wallet.session ? wallet.logout() : wallet.connect())}
          disabled={wallet.busy}
        >
          {wallet.session
            ? wallet.session.wallet.slice(0, 4)
            : wallet.busy
              ? 'Signing…'
              : 'Connect wallet'}
        </button>
      </div>
      {wallet.error ? <p className="px-4 pb-2 text-sm text-red-300">{wallet.error}</p> : null}
    </header>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </WalletProvider>
  );
}
