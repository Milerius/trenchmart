'use client';

import { CreatorAvatar } from '@/components/leaderboard';
import { solExact } from '@/lib/money';
import { KIND_RING, payoutAgo, solscanTx, useRecentPayouts } from '@/components/payouts-data';

/** Home "Paid to creators" band: same marquee as the activity band. Hidden when empty. */
export function PayoutsBand() {
  const data = useRecentPayouts(20);
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = (copy: 'a' | 'b') =>
    data.map((p) => (
      <a
        key={`${copy}-${p.id}`}
        href={solscanTx(p.txSig)}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={copy === 'b' ? -1 : undefined}
        data-testid={copy === 'a' ? 'payout-chip' : undefined}
        className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-ctl border border-line bg-surface px-3 py-2 hover:border-line-strong"
      >
        <span className="font-mono text-[11px] font-semibold text-accent">PAID</span>
        <CreatorAvatar
          who={p.creator}
          className={`h-5 w-5 text-[9px] ring-1 ${KIND_RING[p.creator.kind]}`}
        />
        <span className="text-[13px] text-ink">{p.creator.name}</span>
        <span className="font-mono text-[12px] text-ink-2">◎ {solExact(p.amount.lamports)}</span>
        <span className="font-mono text-[11px] text-muted">{payoutAgo(p.at)}</span>
        <span className="font-mono text-[11px] text-info">tx ↗</span>
      </a>
    ));
  return (
    <section data-testid="payouts-band" aria-label="Paid to creators" className="space-y-3">
      <p className="m-0 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-accent">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        Paid to creators
        <span className="hidden normal-case tracking-normal text-muted sm:inline">
          · recent payouts, each a Solana transaction
        </span>
      </p>
      <div className="activity-band relative overflow-hidden">
        <div className="activity-track flex w-max gap-3">
          <div className="flex gap-3">{row('a')}</div>
          <div className="flex gap-3" aria-hidden="true">
            {row('b')}
          </div>
        </div>
      </div>
    </section>
  );
}
