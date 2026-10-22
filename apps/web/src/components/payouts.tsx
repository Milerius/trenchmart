'use client';

import Link from 'next/link';
import { CreatorAvatar, profileHref } from '@/components/leaderboard';
import { Skeleton } from '@/components/ui';
import { solExact, usdText } from '@/lib/money';
import {
  KIND_RING,
  kindLine,
  payoutAgo,
  shortSig,
  solscanTx,
  useRecentPayouts,
  type RecentPayout,
} from '@/components/payouts-data';

/** "Recent payouts" card for /status and the treasury docs. Hidden-free: shows an empty state
 * rather than invented rows. */

function Tx({ sig }: { sig: string }) {
  return (
    <a
      href={solscanTx(sig)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="payout-tx"
      className="font-mono text-xs text-info hover:underline"
      aria-label={`Transaction ${shortSig(sig)} on Solscan (devnet)`}
    >
      {shortSig(sig)} ↗
    </a>
  );
}

function Who({ p, size }: { p: RecentPayout; size: string }) {
  return (
    <Link href={profileHref(p.creator)} className="flex min-w-0 items-center gap-2.5">
      <CreatorAvatar
        who={p.creator}
        className={`${size} shrink-0 text-xs ring-1 ${KIND_RING[p.creator.kind]}`}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink" data-testid="payout-name">
          {p.creator.name}
        </span>
        <span className="hidden font-mono text-xs text-faint sm:block">{kindLine(p.creator)}</span>
      </span>
    </Link>
  );
}

function Amount({ p, align = '' }: { p: RecentPayout; align?: string }) {
  const usd = usdText(p.amount.usdCents, p.amount.lamports);
  return (
    <span className={align}>
      <span className="font-mono text-sm font-semibold text-accent" data-testid="payout-amount">
        ◎ {solExact(p.amount.lamports)}
      </span>
      {usd ? <span className="ml-1.5 font-mono text-xs text-muted max-sm:block">{usd}</span> : null}
    </span>
  );
}

export function PayoutsCard({
  title = 'Recent payouts',
  limit = 10,
}: {
  title?: string;
  limit?: number;
}) {
  const data = useRecentPayouts(limit);
  const rows = Array.isArray(data) ? data : [];
  const day = rows.filter((p) => Date.now() - new Date(p.at).getTime() < 86_400_000);
  const dayLamports = day.reduce((s, p) => s + BigInt(p.amount.lamports), 0n);
  return (
    <section
      data-testid="payouts-card"
      aria-labelledby="payouts-heading"
      className="overflow-hidden rounded-[22px] border border-line bg-surface"
    >
      <div className="px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 id="payouts-heading" className="m-0 text-xl font-semibold tracking-[-0.02em]">
            {title}
          </h2>
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-accent">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            LIVE
          </span>
        </div>
        <p className="m-0 mt-1 text-sm text-muted">
          Creator payouts from the Squads vault, newest first. Fee-wallet transfers are not shown.
        </p>
      </div>
      {data === null ? (
        <div className="space-y-2 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : data === 'error' ? (
        <p className="m-0 border-t border-line-soft px-5 py-4 text-sm text-ink-2">
          Payouts could not be loaded right now.
        </p>
      ) : rows.length === 0 ? (
        <p
          data-testid="payouts-empty"
          className="m-0 border-t border-line-soft px-5 py-4 text-sm text-ink-2"
        >
          No creator payouts yet.
        </p>
      ) : (
        <>
          <table className="hidden w-full border-collapse sm:table">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
                <th className="px-5 py-2 font-medium">Creator</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-5 py-2 font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} data-testid="payout-row" className="border-t border-line-soft">
                  <td className="px-5 py-3">
                    <Who p={p} size="h-7 w-7" />
                  </td>
                  <td className="px-4 py-3">
                    <Amount p={p} />
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-muted">
                    <time dateTime={p.at}>{payoutAgo(p.at)}</time>
                  </td>
                  <td className="px-5 py-3">
                    <Tx sig={p.txSig} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="m-0 list-none p-0 sm:hidden">
            {rows.map((p) => (
              <li
                key={p.id}
                data-testid="payout-row-m"
                className="grid grid-cols-[1fr_auto] items-center gap-2.5 border-t border-line-soft px-4 py-3"
              >
                <div className="min-w-0">
                  <Who p={p} size="h-8 w-8" />
                  <div className="mt-0.5 pl-[42px] font-mono text-xs text-faint">
                    <time dateTime={p.at}>{payoutAgo(p.at)}</time> · <Tx sig={p.txSig} />
                  </div>
                </div>
                <Amount p={p} align="text-right" />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t border-line-soft px-5 py-3 text-xs text-faint">
        <span>
          {day.length
            ? `Last 24h: ◎ ${solExact(dayLamports)} · ${day.length} payout${day.length === 1 ? '' : 's'}`
            : 'Shown at least 10 minutes after sending, times rounded to 15 minutes.'}
        </span>
        <a
          className="text-info hover:underline"
          href="https://api.trenchmart.fun/api/v1/payouts/recent"
        >
          JSON ↗
        </a>
      </div>
    </section>
  );
}
