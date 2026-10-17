'use client';

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { solText, usdFor, usdText } from '@/lib/money';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-onaccent font-semibold hover:bg-accent-hover',
  secondary: 'border border-line-control text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'border border-danger-line text-danger hover:bg-danger-bg',
};
const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
  xl: 'h-13 px-6 text-base',
};
const DISABLED =
  'disabled:cursor-not-allowed disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-faint disabled:hover:bg-surface-2';

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `motion-press inline-flex items-center justify-center gap-2 rounded-ctl whitespace-nowrap ${VARIANT[variant]} ${SIZE[size]} ${DISABLED} ${extra}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
const TONE: Record<Tone, string> = {
  ok: 'text-accent border-accent-line bg-accent-bg',
  warn: 'text-warn border-warn-line bg-warn-bg',
  danger: 'text-danger border-danger-line bg-danger-bg',
  info: 'text-info border-info-line bg-info-bg',
  neutral: 'text-ink-2 border-line bg-surface',
};

export function Tag({
  tone = 'neutral',
  children,
  className = '',
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-tag border px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide ${TONE[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

const STATUS: Record<string, [string, string, Tone]> = {
  pending: ['○', 'AWAITING PAYMENT', 'neutral'],
  paid: ['●', 'PAID · IN ESCROW', 'ok'],
  disputed: ['!', 'DISPUTED', 'danger'],
  released: ['✓', 'RELEASED', 'ok'],
  refunded: ['↺', 'REFUNDED', 'info'],
  expired: ['⌛', 'EXPIRED', 'neutral'],
  uploading: ['↑', 'UPLOADING', 'neutral'],
  scanning: ['◑', 'AI REVIEW · CHECKS', 'info'],
  needs_creator: ['!', 'NEEDS YOUR NOTE', 'warn'],
  in_review: ['◑', 'AI REVIEW · VERDICT', 'info'],
  live: ['✓', 'AI-VERIFIED', 'ok'],
  rejected: ['×', 'REJECTED', 'danger'],
  superseded: ['↷', 'SUPERSEDED', 'neutral'],
  delisted: ['⊘', 'DELISTED', 'danger'],
  draft: ['○', 'DRAFT', 'neutral'],
  pass: ['✓', 'PASS', 'ok'],
  warn: ['!', 'WARN', 'warn'],
  fail: ['×', 'FAIL', 'danger'],
  na: ['–', 'N/A', 'neutral'],
};

const PAYOUT_STATUS: Record<string, [string, string, Tone]> = {
  pending: ['◷', 'QUEUED', 'warn'],
  proposed: ['◷', 'IN MULTISIG', 'info'],
  sent: ['✓', 'SENT', 'ok'],
  failed: ['×', 'FAILED', 'danger'],
};

export function StatusTag({ status, kind }: { status: string; kind?: 'payout' }) {
  const map = kind === 'payout' ? PAYOUT_STATUS : STATUS;
  const [symbol, label, tone] = map[status] ?? ['○', status.toUpperCase(), 'neutral'];
  return (
    <Tag tone={tone} data-testid="status-tag" data-status={status}>
      <span aria-hidden="true">{symbol}</span> {label}
    </Tag>
  );
}

export function toneOf(status: string): Tone {
  return STATUS[status]?.[2] ?? 'neutral';
}

const SQUARE: Record<Tone, string> = {
  ok: 'bg-accent text-onaccent',
  warn: 'bg-warn text-onaccent',
  danger: 'bg-danger text-onaccent',
  info: 'bg-info text-onaccent',
  neutral: 'border border-line-strong text-ink-2',
};

export function Square({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-tag font-mono text-xs font-bold ${SQUARE[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`rounded-card border border-line bg-surface ${className}`} {...props} />;
}

const PANEL: Record<Tone, string> = {
  ok: 'border-accent-line bg-accent-bg',
  warn: 'border-warn-line bg-warn-bg',
  danger: 'border-danger-line bg-danger-bg',
  info: 'border-info-line bg-info-bg',
  neutral: 'border-line bg-surface',
};

export function Panel({
  tone = 'neutral',
  className = '',
  ...props
}: ComponentProps<'div'> & { tone?: Tone }) {
  return <div className={`rounded-card border ${PANEL[tone]} ${className}`} {...props} />;
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-muted ${className}`}
    >
      {children}
    </span>
  );
}

/** SOL amount with its USD estimate next to it. */
export function Money({
  lamports,
  usdCents,
  centsPerSol,
  className = '',
  stacked = false,
  strong = false,
}: {
  lamports: string | bigint;
  usdCents?: string | null;
  centsPerSol?: string | null;
  className?: string;
  stacked?: boolean;
  strong?: boolean;
}) {
  const cents = usdCents !== undefined ? usdCents : usdFor(lamports, centsPerSol ?? null);
  const usd = usdText(cents, lamports.toString());
  return (
    <span
      className={`tabular font-mono ${stacked ? 'inline-flex flex-col' : 'inline-flex flex-wrap items-baseline gap-x-2'} ${className}`}
    >
      <span className={strong ? 'font-semibold text-ink' : ''}>{solText(lamports)}</span>
      {usd ? (
        <span data-testid="usd-amount" className="text-[0.85em] font-normal text-muted">
          {usd}
        </span>
      ) : null}
    </span>
  );
}

export function Row({
  label,
  children,
  className = '',
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <dt className="text-ink-2">{label}</dt>
      <dd className="m-0 text-right">{children}</dd>
    </div>
  );
}

export function NetworkBanner() {
  return (
    <div
      role="note"
      data-testid="network-banner"
      className="border-b border-warn-line bg-warn-bg px-4 py-1.5 text-center font-mono text-xs text-warn"
    >
      DEVNET · test SOL only · nothing here has real value
    </div>
  );
}

export function PreviewNotice({
  onConnect,
  compact = false,
}: {
  onConnect?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="note"
      data-testid="preview-notice"
      className={`flex gap-3 rounded-card border border-info-line bg-info-bg p-4 ${compact ? 'flex-col' : 'flex-wrap items-center'}`}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Square tone="info">
          <span className="font-sans">i</span>
        </Square>
        <div className="min-w-0">
          <p className="m-0 font-semibold">Preview prices</p>
          <p className="m-0 text-[13px] text-ink-2">
            You&apos;re seeing list prices. Connect your wallet to see your exact price with your
            $TRENCH tier discount (up to 100% off the 5% fee).
          </p>
        </div>
      </div>
      {onConnect ? (
        <Button variant="secondary" size="sm" onClick={onConnect}>
          Connect to see your price
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-start gap-2 rounded-card border border-line bg-inset p-6"
    >
      <p className="m-0 font-semibold">{title}</p>
      <p className="m-0 text-sm text-ink-2">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className="flex flex-col items-start gap-2 rounded-card border border-danger-line bg-danger-bg p-4"
    >
      <p className="m-0 font-semibold">{title}</p>
      <p className="m-0 text-sm text-ink-2">{body}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span data-testid="skeleton" aria-hidden="true" className={`skeleton block ${className}`} />
  );
}

export function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}

const UTC = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function utc(iso: string): string {
  return `${UTC.format(new Date(iso))} UTC`;
}

export function remaining(iso: string, now = Date.now()): string {
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

export function DownloadButton({
  status,
  escrowUntil,
  busy,
  onDownload,
  className = '',
  size = 'sm',
}: {
  status: string;
  escrowUntil: string | null;
  busy?: boolean;
  onDownload: () => void;
  className?: string;
  size?: Size;
}) {
  if (status === 'released') {
    return (
      <Button
        data-testid="download-button"
        data-state={busy ? 'working' : 'ready'}
        size={size}
        className={className}
        aria-busy={busy || undefined}
        onClick={onDownload}
      >
        {busy ? '◑ Preparing your copy…' : 'Download'}
      </Button>
    );
  }
  if (status !== 'paid' && status !== 'disputed') return null;
  const label =
    status === 'disputed'
      ? 'Locked during dispute'
      : escrowUntil
        ? `Unlocks in ${remaining(escrowUntil)}`
        : 'Unlocks after release';
  return (
    <Button
      data-testid="download-button"
      data-state="locked"
      size={size}
      disabled
      className={className}
      title={escrowUntil ? `Download unlocks ${utc(escrowUntil)}` : undefined}
    >
      <LockIcon /> {label}
    </Button>
  );
}
