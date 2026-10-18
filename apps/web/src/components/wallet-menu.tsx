'use client';

import Link from 'next/link';
import { Wallet as WalletIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { shortAddress } from '@/lib/wallet-session';

const PHASE_LABEL = {
  connecting: 'Connecting…',
  signing: 'Sign in your wallet…',
  verifying: 'Verifying…',
} as const;

const buttonClass =
  'motion-press inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold whitespace-nowrap text-onaccent hover:bg-accent-hover disabled:opacity-100';
const itemClass =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-ink hover:bg-surface-2 focus:bg-surface-2 focus:outline-none';

/**
 * The header wallet control. Three distinct states:
 * - signed out, no wallet → "Connect wallet" (opens the picker)
 * - wallet connected, not signed in → "Sign in" (one signature, no picker)
 * - signed in → the address; a click opens a menu. A click never disconnects.
 */
export function WalletMenu() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const session = wallet.session;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!session) setOpen(false);
  }, [session]);

  if (wallet.busy) {
    return (
      <button
        data-testid="connect"
        data-auth="pending"
        type="button"
        className={buttonClass}
        disabled
        aria-busy
      >
        {PHASE_LABEL[wallet.phase as keyof typeof PHASE_LABEL] ?? 'Check your wallet…'}
      </button>
    );
  }

  if (!session) {
    const connected = wallet.walletAddress;
    return (
      <button
        data-testid="connect"
        data-auth={connected ? 'wallet-connected' : 'signed-out'}
        type="button"
        className={buttonClass}
        title={connected ? `Sign in as ${connected}` : undefined}
        aria-label={connected ? undefined : 'Connect wallet'}
        onClick={() => void wallet.connect()}
      >
        {connected ? (
          'Sign in'
        ) : (
          <>
            <WalletIcon size={15} aria-hidden="true" />
            Connect<span className="hidden sm:inline"> wallet</span>
          </>
        )}
      </button>
    );
  }

  async function copy() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.wallet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the full address is shown in the menu */
    }
  }

  const profileHref = session.handle ? `/u/${session.handle}` : '/studio/profile';
  const mismatch = wallet.walletMismatch && wallet.walletAddress;

  return (
    <div ref={root} className="relative">
      <button
        data-testid="connect"
        data-auth={wallet.status}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="wallet-menu"
        className={`${buttonClass} font-mono`}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          aria-hidden="true"
          data-testid="auth-dot"
          className={`h-2 w-2 rounded-full ${mismatch ? 'bg-warn' : 'bg-onaccent'} ${wallet.status === 'restoring' ? 'opacity-40' : ''}`}
        />
        <span>{shortAddress(session.wallet)}</span>
      </button>
      {open ? (
        <div
          id="wallet-menu"
          role="menu"
          data-testid="wallet-menu"
          className="absolute right-0 z-50 mt-2 w-72 rounded-ctl border border-line-control bg-surface p-1.5 shadow-xl"
        >
          <div className="px-3 pt-2 pb-2.5">
            <p className="flex items-center gap-2 text-xs text-muted" data-testid="auth-status">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
              {wallet.status === 'restoring' ? 'Restoring session…' : 'Signed in'}
            </p>
            <p className="mt-1 font-mono text-xs break-all text-ink" data-testid="menu-address">
              {session.wallet}
            </p>
          </div>
          {mismatch ? (
            <div
              data-testid="wallet-mismatch"
              className="mx-1.5 mb-1.5 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn"
            >
              Your wallet switched to{' '}
              <span className="font-mono">{shortAddress(wallet.walletAddress!)}</span>.
              <button
                type="button"
                role="menuitem"
                data-testid="menu-switch"
                className="mt-1.5 block font-semibold text-ink underline"
                onClick={() => {
                  setOpen(false);
                  void wallet.signIn();
                }}
              >
                Sign in as {shortAddress(wallet.walletAddress!)}
              </button>
            </div>
          ) : null}
          <div className="border-t border-line-soft pt-1.5">
            <button
              type="button"
              role="menuitem"
              data-testid="menu-copy"
              className={itemClass}
              onClick={() => void copy()}
            >
              {copied ? 'Copied' : 'Copy address'}
            </button>
            <Link
              href={profileHref}
              role="menuitem"
              data-testid="menu-profile"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              Profile
            </Link>
            <Link
              href="/studio"
              role="menuitem"
              data-testid="menu-studio"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              Studio
            </Link>
            <Link
              href="/me/purchases"
              role="menuitem"
              data-testid="menu-purchases"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              Purchases
            </Link>
          </div>
          <div className="mt-1.5 border-t border-line-soft pt-1.5">
            <button
              type="button"
              role="menuitem"
              data-testid="menu-disconnect"
              className={itemClass.replace('text-ink', 'text-danger')}
              onClick={() => {
                setOpen(false);
                void wallet.logout();
              }}
            >
              Disconnect
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="menu-logout-all"
              className={itemClass.replace('text-ink', 'text-danger')}
              onClick={() => {
                setOpen(false);
                void wallet.logoutEverywhere();
              }}
            >
              Log out everywhere
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
