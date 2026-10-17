'use client';

import { useEffect, useRef, useState } from 'react';
import { Tag } from '@/components/ui';
import {
  buildWalletChoices,
  walletConnectQr,
  type DetectedWalletInfo,
  type WalletChoice,
} from '@/lib/wallet-catalog';

const MARK: Record<string, { fill: string; letter: string; ink: string }> = {
  phantom: { fill: '#AB9FF2', letter: 'P', ink: '#0A0B0A' },
  walletconnect: { fill: '#3B99FC', letter: 'W', ink: '#0A0B0A' },
  solflare: { fill: '#FC822B', letter: 'S', ink: '#0A0B0A' },
  trust: { fill: '#0500FF', letter: 'T', ink: '#EDEFEA' },
  glow: { fill: '#14F195', letter: 'G', ink: '#0A0B0A' },
  coinbase: { fill: '#0052FF', letter: 'C', ink: '#EDEFEA' },
  backpack: { fill: '#E33E3F', letter: 'B', ink: '#EDEFEA' },
};

function Mark({ id, name }: { id: string; name: string }) {
  const mark = MARK[id] ?? {
    fill: '#262A26',
    letter: name.slice(0, 1).toUpperCase(),
    ink: '#EDEFEA',
  };
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 rounded-ctl" aria-hidden="true">
      <rect width="36" height="36" rx="10" fill={mark.fill} />
      <text
        x="18"
        y="24"
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fill={mark.ink}
        fontFamily="Geist, ui-sans-serif, system-ui, sans-serif"
      >
        {mark.letter}
      </text>
    </svg>
  );
}

function RowIcon({ choice }: { choice: WalletChoice }) {
  if (choice.icon) {
    return <img src={choice.icon} alt="" className="h-9 w-9 shrink-0 rounded-ctl object-cover" />;
  }
  return <Mark id={choice.id} name={choice.name} />;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-faint" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M16 16.5 20 20.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M14.5 6.5 8.5 12l6 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1.2.8-1.2 1.6V14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="11.5" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

const ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-ctl border border-line bg-inset px-3 py-2.5 text-left transition-colors hover:border-line-control hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60';

export function ConnectModal({
  open,
  busy,
  error,
  detected,
  lastUsedId,
  mobileUrl,
  onClose,
  onConnect,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  detected: readonly DetectedWalletInfo[];
  lastUsedId: string | null;
  mobileUrl: string | null;
  onClose: () => void;
  onConnect: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'help' | 'walletconnect'>('list');

  useEffect(() => {
    if (open) return;
    setQuery('');
    setView('list');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    const target =
      view === 'list'
        ? root?.querySelector<HTMLElement>('[data-testid=wallet-search]')
        : root?.querySelector<HTMLElement>('[data-testid=wallet-back]');
    target?.focus();
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (busy) return;
        if (view === 'list') onCloseRef.current();
        else setView('list');
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled])',
        ),
      ];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, view]);

  if (!open) return null;

  const choices = buildWalletChoices({ detected, query, lastUsedId });
  const qr = view === 'walletconnect' && mobileUrl ? walletConnectQr(mobileUrl) : null;
  const title =
    view === 'help'
      ? 'About signing in'
      : view === 'walletconnect'
        ? 'WalletConnect'
        : 'Select your wallet';

  function goBack() {
    if (busy) return;
    if (view === 'list') onClose();
    else setView('list');
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) goBack();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        aria-busy={busy || undefined}
        data-testid="connect-modal"
        data-state={view}
        className="max-h-[calc(100vh-2rem)] w-full max-w-[420px] overflow-y-auto rounded-panel border border-line bg-surface p-5"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="wallet-back"
            className="grid h-11 w-11 place-items-center rounded-ctl text-ink hover:bg-surface-2"
            aria-label="Back"
            onClick={goBack}
            disabled={busy}
          >
            <ArrowIcon />
          </button>
          <h2
            id="wallet-picker-title"
            className="m-0 flex-1 text-center text-lg font-semibold tracking-[-0.02em]"
          >
            {title}
          </h2>
          {view === 'list' ? (
            <button
              type="button"
              data-testid="wallet-help"
              className="grid h-11 w-11 place-items-center rounded-ctl text-ink-2 hover:bg-surface-2 hover:text-ink"
              aria-label="Help"
              onClick={() => setView('help')}
            >
              <HelpIcon />
            </button>
          ) : (
            <span className="h-11 w-11" />
          )}
        </div>

        {view === 'help' ? (
          <div className="mt-5 space-y-3 text-sm text-ink-2">
            <p className="m-0">
              You&apos;ll sign one message to sign in. It&apos;s not a transaction: nothing moves
              and nothing is approved.
            </p>
            <p className="m-0">
              Installed wallets are the ones this browser can see. Any other row opens that
              wallet&apos;s install page. WalletConnect opens a QR code for a phone.
            </p>
          </div>
        ) : null}

        {view === 'walletconnect' ? (
          <div className="mt-5 space-y-4 text-sm text-ink-2">
            <p className="m-0">
              Scan with your phone, or open TrenchMart in Phantom. You&apos;ll sign one message.
              Nothing moves and nothing is approved.
            </p>
            {qr ? (
              <div
                data-testid="wallet-qr"
                className="mx-auto w-fit rounded-ctl bg-white p-3"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            ) : (
              <p className="m-0">This page can&apos;t be opened from a wallet browser.</p>
            )}
            {mobileUrl ? (
              <a
                data-testid="wallet-deeplink"
                href={mobileUrl}
                className="flex h-12 items-center justify-center rounded-ctl bg-accent font-semibold text-onaccent hover:bg-accent-hover"
              >
                Open in Phantom
              </a>
            ) : null}
          </div>
        ) : null}

        {view === 'list' ? (
          <>
            <label className="mt-4 flex h-11 items-center gap-2 rounded-ctl border border-line-control bg-inset px-3">
              <SearchIcon />
              <input
                data-testid="wallet-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search wallet"
                aria-label="Search wallet"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              />
            </label>
            {error ? (
              <p role="alert" className="m-0 mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {choices.map((choice) => (
                <li key={choice.id}>
                  <ChoiceRow
                    choice={choice}
                    busy={busy}
                    onConnect={onConnect}
                    onWalletConnect={() => setView('walletconnect')}
                  />
                </li>
              ))}
            </ul>
            {choices.length === 0 ? (
              <p className="m-0 mt-3 text-sm text-muted">No wallets match that search.</p>
            ) : null}
            <p className="m-0 mt-4 text-center text-[12px] leading-5 text-muted">
              By connecting, you agree to the Terms of Service and Privacy Policy.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ChoiceRow({
  choice,
  busy,
  onConnect,
  onWalletConnect,
}: {
  choice: WalletChoice;
  busy: boolean;
  onConnect: (id: string) => void;
  onWalletConnect: () => void;
}) {
  const body = (
    <>
      <RowIcon choice={choice} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{choice.name}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {choice.installed ? <Tag tone="ok">Installed</Tag> : null}
        {choice.popular ? <Tag>Popular</Tag> : null}
      </span>
    </>
  );
  const testId = `wallet-option-${choice.id}`;
  if (!choice.installed && choice.kind === 'wallet' && choice.installUrl) {
    return (
      <a
        data-testid={testId}
        data-wallet={choice.id}
        data-installed="false"
        href={choice.installUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={ROW}
      >
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      data-wallet={choice.id}
      data-installed={choice.installed ? 'true' : 'false'}
      className={ROW}
      disabled={busy}
      onClick={() => {
        if (choice.kind === 'walletconnect' && !choice.installed) onWalletConnect();
        else onConnect(choice.id);
      }}
    >
      {body}
    </button>
  );
}
