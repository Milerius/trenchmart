'use client';

import Link from 'next/link';
import { Skeleton } from '@/components/ui';
import { shortSig, solscanTx } from '@/components/payouts-data';
import { epochAgo, sol, useRewardEpochs, type RewardEpoch } from '@/components/rewards-data';

/** Last $MART holder distributions (for /rewards, /status and the treasury docs). */
export function RewardEpochsTable({ epochs }: { epochs: RewardEpoch[] }) {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="hidden grid-cols-[1fr_1.1fr_1fr_1fr_1.2fr_1fr] gap-4 border-b border-line-soft px-6 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted md:grid">
        <span>Epoch</span>
        <span>Revenue − costs</span>
        <span>To holders</span>
        <span>Paid</span>
        <span>Transactions</span>
        <span className="text-right">Funding tx</span>
      </div>
      {epochs.map((e) => (
        <div
          key={e.epoch}
          data-testid="reward-epoch"
          className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-line-soft px-6 py-4 last:border-0 md:grid-cols-[1fr_1.1fr_1fr_1fr_1.2fr_1fr] md:items-center"
        >
          <span className="font-semibold">
            #{e.epoch}{' '}
            <span className="font-mono text-[11px] font-normal text-muted">
              {e.status === 'paid' ? epochAgo(e.endsAt) : e.status}
            </span>
          </span>
          <span className="font-mono text-[13px] text-ink-2">
            ◎ {sol(e.revenue.lamports, 3)}{' '}
            <span className="text-muted">− {sol(e.costTotal, 4)}</span>
          </span>
          <span className="font-mono text-[13px] text-accent" data-testid="reward-pool">
            <span className="text-muted md:hidden">pool </span>◎ {sol(e.holderPool.lamports, 3)}
          </span>
          <PaidCell e={e} />
          <span className="font-mono text-[13px] text-ink-2">
            {e.batches.length} txs · {e.eligible} eligible
          </span>
          {e.fundSig ? (
            <a
              href={solscanTx(e.fundSig)}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="reward-fund-tx"
              className="font-mono text-[12px] text-info hover:underline md:text-right"
            >
              {shortSig(e.fundSig)} ↗
            </a>
          ) : (
            <span className="font-mono text-[12px] text-faint md:text-right">—</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Actual SOL sent to holders this epoch (incl. carry-in), or why nothing was sent. */
function PaidCell({ e }: { e: RewardEpoch }) {
  const paid = BigInt(e.paid?.lamports ?? '0');
  const counts = `${e.paidCount} paid · ${e.carriedCount} carried`;
  const pending = e.status === 'closed' || e.status === 'funding' || e.status === 'paying';
  return (
    <span data-testid="reward-paid" className="flex min-w-0 flex-col font-mono text-[13px]">
      {paid > 0n ? (
        <span className="text-ink">
          <span className="text-muted md:hidden">paid </span>◎ {sol(e.paid!.lamports, 3)}
        </span>
      ) : pending && e.paidCount > 0 ? (
        <span className="text-warn">sending…</span>
      ) : e.carriedCount > 0 ? (
        <span className="text-ink-2">carried</span>
      ) : (
        <span className="text-faint">—</span>
      )}
      {e.eligible > 0 ? <span className="text-[11px] text-muted">{counts}</span> : null}
    </span>
  );
}

export function RewardsCard({
  title = 'Holder rewards',
  limit = 5,
}: {
  title?: string;
  limit?: number;
}) {
  const data = useRewardEpochs(limit);
  return (
    <section
      data-testid="rewards-card"
      aria-labelledby="rewards-card-heading"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="rewards-card-heading" className="m-0 text-xl font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <Link href="/rewards" className="font-mono text-[12px] text-info hover:underline">
          $MART rewards →
        </Link>
      </div>
      <p className="m-0 text-sm text-muted">
        50% of net revenue, pushed every 3 hours to the top 1,000 $MART holders in SOL. Every
        transaction is public.
      </p>
      {data === null ? (
        <Skeleton className="h-24 w-full" />
      ) : data === 'error' ? (
        <p className="m-0 text-sm text-ink-2">Holder rewards could not be loaded right now.</p>
      ) : data.length === 0 ? (
        <p data-testid="rewards-empty" className="m-0 text-sm text-ink-2">
          No distributions yet.
        </p>
      ) : (
        <RewardEpochsTable epochs={data} />
      )}
    </section>
  );
}
