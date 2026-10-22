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
// ---------------------------------------------------------------------------------------------
// Epoch math, sampling, ranking, allocation and batching (pure, unit tested).

export const REWARD_DEFAULTS = {
  epochSeconds: 10_800,
  samplesPerEpoch: 6,
  topN: 1000,
  /** 0.05% of supply, in bps of 10_000 (5 = 0.05%). */
  minSupplyBps: 5,
  /** Shares below this carry over (0.01 SOL). */
  minPayoutLamports: 10_000_000n,
  /** Wallet must have qualified in the previous epoch too (2-epoch hold). */
  holdEpochs: 2,
  recipientsPerTx: 20,
  /** System transfer ≈ 150 CU; 20 of them plus overhead fits well under 10k. */
  computeUnits: 10_000,
  microLamportsPerUnit: 10_000n,
  /** Cron cadence: samples land on 5-minute ticks. */
  tickSeconds: 300,
} as const;

export function epochIdAt(ms: number, epochSeconds: number): number {
  return Math.floor(ms / 1000 / epochSeconds);
}
export function epochBounds(epochId: number, epochSeconds: number): { start: Date; end: Date } {
  return {
    start: new Date(epochId * epochSeconds * 1000),
    end: new Date((epochId + 1) * epochSeconds * 1000),
  };
}

/** Lamports a legacy tx with `signatures` signers and our compute budget pays. */
export function txFeeLamports(
  signatures: number,
  units: number = REWARD_DEFAULTS.computeUnits,
  microLamportsPerUnit: bigint = REWARD_DEFAULTS.microLamportsPerUnit,
): { network: bigint; priority: bigint } {
  return {
    network: 5000n * BigInt(signatures),
    priority: (BigInt(units) * microLamportsPerUnit + 999_999n) / 1_000_000n,
  };
}

/**
 * Distinct sample ticks in [0, ticks) from a 32-byte seed (hex). Ticks are 5-minute cron runs:
 * holders cannot know when their balance is read, so a buy just before "the snapshot" is useless.
 */
export function sampleTicks(seedHex: string, ticks: number, count: number): number[] {
  const n = Math.min(count, ticks);
  const bytes = seedHex.match(/../g)!.map((h) => parseInt(h, 16));
  const out = new Set<number>();
  let i = 0;
  while (out.size < n) {
    const a = bytes[i % bytes.length]!;
    const b = bytes[(i + 7) % bytes.length]!;
    out.add(((a << 8) | b) % ticks);
    i += 1;
    if (i > 4096) for (let t = 0; out.size < n; t++) out.add(t); // degenerate seed
  }
  return [...out].sort((x, y) => x - y);
}

export type Candidate = { owner: string; weight: bigint; firstSeenMs: number; ownerBytes: string };

/** Weight desc, then older holder first, then pubkey bytes asc: deterministic at rank N. */
export function rankHolders(candidates: Candidate[], topN: number): Candidate[] {
  return [...candidates]
    .filter((c) => c.weight > 0n)
    .sort((a, b) =>
      a.weight !== b.weight
        ? a.weight > b.weight
          ? -1
          : 1
        : a.firstSeenMs !== b.firstSeenMs
          ? a.firstSeenMs - b.firstSeenMs
          : a.ownerBytes < b.ownerBytes
            ? -1
            : a.ownerBytes > b.ownerBytes
              ? 1
              : 0,
    )
    .slice(0, topN);
}

export type Allocation = {
  owner: string;
  rank: number;
  weight: bigint;
  share: bigint;
  carryIn: bigint;
  lamports: bigint;
  status: 'pay' | 'carried';
};

/**
 * share_i = floor(pool * w_i / Σw). With the wallet's carried amount added, totals at or over
 * the minimum are paid; smaller totals carry over. Rounding dust returns to the next pool.
 */
export function allocate(
  pool: bigint,
  ranked: Candidate[],
  carries: Map<string, bigint>,
  minPayout: bigint,
): { rows: Allocation[]; dust: bigint; paid: bigint; carried: bigint } {
  const total = ranked.reduce((s, c) => s + c.weight, 0n);
  let distributed = 0n;
  let paid = 0n;
  let carried = 0n;
  const rows = ranked.map((c, i) => {
    const share = total > 0n ? (pool * c.weight) / total : 0n;
    distributed += share;
    const carryIn = carries.get(c.owner) ?? 0n;
    const sum = share + carryIn;
    const pay = sum >= minPayout;
    if (pay) paid += sum;
    else carried += sum;
    return {
      owner: c.owner,
      rank: i + 1,
      weight: c.weight,
      share,
      carryIn,
      lamports: sum,
      status: pay ? ('pay' as const) : ('carried' as const),
    };
  });
  return { rows, dust: pool - distributed, paid, carried };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Holders' half of a revenue item (before costs), capped by what the rewards vault received. */
export function holderGrossOf(netFee: bigint, slotLamports: bigint, holderBps = HOLDER_SHARE_BPS) {
  const half = (netFee * BigInt(holderBps)) / 10_000n;
  return half < slotLamports ? half : slotLamports;
}

/**
 * The 4-slot on-chain split when rewards are on: the buyback slot carries holders + buyback and
 * is paid to the rewards vault; the other three keep their (halved) proportions.
 */
export function onChainSplitBps(buckets: Partial<Record<keyof FeeSplitBps, number>>): FeeSplitBps {
  const s = displaySplitBps(buckets);
  return {
    buyback: s.holders + s.buyback,
    ai_verification: s.ai_verification,
    ops: s.ops,
    safety: s.safety,
  };
}
