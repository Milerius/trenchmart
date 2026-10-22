export const TIERS = ['none', 'scout', 'trencher', 'og'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_RANK: Record<Tier, number> = {
  none: 0,
  scout: 1,
  trencher: 2,
  og: 3,
};

export type TierThresholds = {
  scout?: bigint;
  trencher?: bigint;
  og?: bigint;
};

export type BalanceSource = 'webhook' | 'snapshot' | 'reconcile';

export type BalanceRow = {
  amount: bigint;
  ts: Date;
  source: BalanceSource;
};

/** A value that is not an integer string (e.g. "off") disables that tier. */
export function parseThreshold(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value >= 0n ? value : undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value !== 'string') return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  return BigInt(value);
}

export function parseThresholds(raw: {
  scout?: unknown;
  trencher?: unknown;
  og?: unknown;
}): TierThresholds {
  return {
    scout: parseThreshold(raw.scout),
    trencher: parseThreshold(raw.trencher),
    og: parseThreshold(raw.og),
  };
}

export function tierFor(minBalance: bigint, t: TierThresholds): Tier {
  if (t.og !== undefined && minBalance >= t.og) return 'og';
  if (t.trencher !== undefined && minBalance >= t.trencher) return 'trencher';
  if (t.scout !== undefined && minBalance >= t.scout) return 'scout';
  return 'none';
}

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

export function nextTierNeed(
  minBalance: bigint,
  t: TierThresholds,
): { nextTier: Tier | null; needed: bigint } {
  const order: (keyof TierThresholds)[] = ['scout', 'trencher', 'og'];
  for (const name of order) {
    const th = t[name];
    if (th === undefined) continue;
    if (minBalance < th) return { nextTier: name, needed: th - minBalance };
  }
  return { nextTier: null, needed: 0n };
}

/**
 * Lowest balance in effect during the last `windowHours`.
 *
 * Missing history before the window counts as 0 only when the first row is a
 * webhook (the wallet acquired tokens during the window). A first snapshot or
 * reconcile is trusted — we simply had not indexed that wallet yet.
 */
export function minBalanceInWindow(rows: BalanceRow[], now: Date, windowHours: number): bigint {
  const startMs = now.getTime() - windowHours * 3_600_000;
  const sorted = [...rows].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  if (sorted.length === 0) return 0n;

  const before = sorted.filter((r) => r.ts.getTime() <= startMs);
  const inside = sorted.filter((r) => r.ts.getTime() > startMs);
  const amounts: bigint[] = [];

  if (before.length > 0) {
    amounts.push(before[before.length - 1]!.amount);
  } else {
    const first = sorted[0]!;
    if (first.source === 'webhook') amounts.push(0n);
  }

  for (const row of inside) amounts.push(row.amount);
  return amounts.reduce((m, a) => (a < m ? a : m));
}

export function requiredBondLamports(
  categories: string[],
  byCategory: Record<string, bigint>,
  tier: Tier,
  ogDiscountBps: number,
): bigint {
  let max = 0n;
  for (const c of categories) {
    const v = byCategory[c] ?? 0n;
    if (v > max) max = v;
  }
  if (tier === 'og') {
    max = (max * BigInt(10_000 - ogDiscountBps)) / 10_000n;
  }
  return max;
}

/**
 * Bond a creator needs to list: the bond for their live categories, and at least the
 * cheapest category bond, because a new listing must meet its own category bond.
 */
export function bondToList(
  liveCategories: string[],
  byCategory: Record<string, bigint>,
  tier: Tier,
  ogDiscountBps: number,
): bigint {
  const live = requiredBondLamports(liveCategories, byCategory, tier, ogDiscountBps);
  const cheapest = Object.keys(byCategory)
    .map((category) => requiredBondLamports([category], byCategory, tier, ogDiscountBps))
    .reduce<bigint | null>((min, value) => (min === null || value < min ? value : min), null);
  return cheapest !== null && cheapest > live ? cheapest : live;
}

/** "1000000" (whole tokens) → "1,000,000 $MART". A value that is not an integer → "not set". */
export function formatTrench(wholeTokens: unknown): string {
  const value = parseThreshold(wholeTokens);
  if (value === undefined) return 'not set';
  return `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} $MART`;
}
