import { asBigint } from './money';

export type FeeQuote = {
  price: bigint;
  fee: bigint;
  rebate: bigint;
  total: bigint;
  netFee: bigint;
};

/** Floor division in basis points. All amounts are whole lamports. */
export function quote(price: bigint, feeBps: number, rebateBps: number): FeeQuote {
  if (feeBps < 0 || rebateBps < 0) throw new Error('bps must be >= 0');
  const fee = (price * BigInt(feeBps)) / 10_000n;
  const rebate = (fee * BigInt(rebateBps)) / 10_000n;
  const total = price + fee - rebate;
  return { price, fee, rebate, total, netFee: fee - rebate };
}

/**
 * Split a net fee by basis points. Rounding dust goes to `ops`
 * so the parts always sum to `netFee`.
 */
export function splitFee(netFee: bigint, split: Record<string, number>): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  let used = 0n;
  for (const [k, bps] of Object.entries(split)) {
    out[k] = (netFee * BigInt(bps)) / 10_000n;
    used += out[k]!;
  }
  const dust = netFee - used;
  out.ops = (out.ops ?? 0n) + dust;
  return out;
}

export function sumSplit(parts: Record<string, bigint>): bigint {
  return Object.values(parts).reduce((a, b) => a + b, 0n);
}

export function quoteFromConfig(
  price: bigint | string | number,
  feeBps: number,
  rebateBps: number,
): FeeQuote {
  return quote(asBigint(price), feeBps, rebateBps);
}
