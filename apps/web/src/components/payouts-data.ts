'use client';

import type { PublicIdentity } from '@trenchmart/shared/social';
import { startTransition, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** GET /api/v1/payouts/recent: sent creator payout lines, at least 10 minutes old, times
 * rounded down to 15 minutes. No order, listing or buyer data ever comes back. */
export type RecentPayout = {
  id: string;
  at: string;
  amount: { lamports: string; sol: string; usdCents: string | null };
  txSig: string;
  creator: PublicIdentity;
};
export type RecentPayouts = { payouts: RecentPayout[] };

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
export const shortSig = (sig: string) => `${sig.slice(0, 4)}…${sig.slice(-4)}`;

/** Times are rounded server-side, so the copy says "about". */
export function payoutAgo(iso: string, nowMs = Date.now()): string {
  const m = Math.max(0, (nowMs - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `~${Math.max(15, Math.round(m / 15) * 15)}m ago`;
  if (m < 1440) return `~${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** Loads the feed once `enabled`, then refreshes every minute (the edge caches 60 s). */
export function useRecentPayouts(limit = 20, enabled = true) {
  const [data, setData] = useState<RecentPayout[] | null | 'error'>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const load = () =>
      void api<RecentPayouts>(`/payouts/recent?limit=${limit}`)
        .then(
          (body) =>
            !stop &&
            startTransition(() => setData(Array.isArray(body?.payouts) ? body.payouts : [])),
        )
        .catch(() => !stop && setData((prev) => (Array.isArray(prev) ? prev : 'error')));
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [limit, enabled]);
  return data;
}

export const KIND_RING: Record<PublicIdentity['kind'], string> = {
  x: 'ring-accent',
  pseudonym: 'ring-violet',
  wallet: 'ring-line-strong',
};

export function kindLine(who: PublicIdentity): string {
  if (who.kind === 'x') return who.handle ? `@${who.handle}` : 'X verified';
  if (who.kind === 'pseudonym') return 'pseudonym';
  return 'wallet';
}
