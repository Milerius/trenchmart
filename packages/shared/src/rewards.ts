// $MART holder rewards (docs/ops/holder-rewards.md). Holders take 50% of NET platform revenue
// (revenue minus ledgered costs) first; the other 50% is split across the existing fee buckets
// in their configured proportions.
import type { FeeSplitBps } from './payouts';

export const HOLDER_SHARE_BPS = 5000;
export type DisplaySplitBps = { holders: number } & FeeSplitBps;

/** Share of each net-fee lamport, in bps of 10_000: holders first, buckets scaled to the rest. */
export function displaySplitBps(
  input: Partial<Record<keyof FeeSplitBps, number>>,
  holderBps = HOLDER_SHARE_BPS,
): DisplaySplitBps {
  const buckets = {
    buyback: input.buyback ?? 0,
    ai_verification: input.ai_verification ?? 0,
    ops: input.ops ?? 0,
    safety: input.safety ?? 0,
  };
  const rest = 10_000 - holderBps;
  const total = buckets.buyback + buckets.ai_verification + buckets.ops + buckets.safety || 1;
  const scale = (v: number) => Math.round((v * rest) / total);
  const out = {
    holders: holderBps,
    buyback: scale(buckets.buyback),
    ai_verification: scale(buckets.ai_verification),
    ops: scale(buckets.ops),
    safety: scale(buckets.safety),
  };
  // Rounding dust goes to buyback so the parts always sum to 10_000.
  out.buyback += 10_000 - (out.holders + out.buyback + out.ai_verification + out.ops + out.safety);
  return out;
}
