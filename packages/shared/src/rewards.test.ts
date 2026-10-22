import { describe, expect, it } from 'vitest';
import {
  allocate,
  chunk,
  displaySplitBps,
  epochIdAt,
  holderGrossOf,
  onChainSplitBps,
  rankHolders,
  sampleTicks,
  txFeeLamports,
} from './rewards';

describe('displaySplitBps', () => {
  it('gives holders 50% and keeps the bucket proportions on the rest', () => {
    expect(
      displaySplitBps({ buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 }),
    ).toEqual({ holders: 5000, buyback: 2000, ai_verification: 1250, ops: 1000, safety: 750 });
  });
  it('always sums to 10_000', () => {
    const s = displaySplitBps({ buyback: 3333, ai_verification: 3333, ops: 3334, safety: 0 });
    expect(s.holders + s.buyback + s.ai_verification + s.ops + s.safety).toBe(10_000);
  });
});

const c = (owner: string, weight: bigint, firstSeenMs = 0) => ({
  owner,
  weight,
  firstSeenMs,
  ownerBytes: owner,
});

describe('rewards math', () => {
  it('epochs are 3 h buckets', () => {
    expect(epochIdAt(0, 10_800)).toBe(0);
    expect(epochIdAt(10_800_000 - 1, 10_800)).toBe(0);
    expect(epochIdAt(10_800_000, 10_800)).toBe(1);
  });
  it('picks distinct, sorted, in-range sample ticks; same seed same ticks', () => {
    const seed = 'ab'.repeat(32);
    const a = sampleTicks(seed, 36, 6);
    expect(a).toEqual(sampleTicks(seed, 36, 6));
    expect(new Set(a).size).toBe(6);
    expect(a.every((t) => t >= 0 && t < 36)).toBe(true);
    expect(sampleTicks('00'.repeat(32), 36, 6)).toHaveLength(6);
    expect(sampleTicks('cd'.repeat(32), 3, 6)).toEqual([0, 1, 2]);
  });
  it('breaks ties at the cutoff by first-seen then pubkey bytes', () => {
    const r = rankHolders([c('b', 5n, 2), c('a', 5n, 2), c('z', 5n, 1), c('x', 9n), c('y', 0n)], 3);
    expect(r.map((x) => x.owner)).toEqual(['x', 'z', 'a']);
  });
  it('allocates pro-rata, carries shares under the minimum, returns dust', () => {
    const ranked = [c('a', 700n), c('b', 299n), c('c', 1n)];
    const out = allocate(100_000_000n, ranked, new Map([['c', 9_950_000n]]), 10_000_000n);
    expect(out.rows.map((r) => [r.owner, r.status, r.lamports])).toEqual([
      ['a', 'pay', 70_000_000n],
      ['b', 'pay', 29_900_000n],
      ['c', 'pay', 10_050_000n],
    ]);
    const small = allocate(15_000_000n, ranked, new Map(), 10_000_000n);
    expect(small.rows.filter((r) => r.status === 'carried').map((r) => r.owner)).toEqual([
      'b',
      'c',
    ]);
    expect(small.paid + small.carried + small.dust).toBe(15_000_000n);
  });
  it('batches 1000 recipients into 50 txs of 20', () => {
    expect(
      chunk(
        Array.from({ length: 1000 }, (_, i) => i),
        20,
      ),
    ).toHaveLength(50);
  });
  it('fee per batch tx is 5000 + priority', () => {
    expect(txFeeLamports(1)).toEqual({ network: 5000n, priority: 100n });
  });
  it('holders get half the net fee, never more than the slot', () => {
    expect(holderGrossOf(1_000n, 700n)).toBe(500n);
    expect(holderGrossOf(1_000n, 0n)).toBe(0n);
  });
  it('on-chain 4-slot split carries holders in the buyback slot', () => {
    expect(
      onChainSplitBps({ buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 }),
    ).toEqual({
      buyback: 7000,
      ai_verification: 1250,
      ops: 1000,
      safety: 750,
    });
  });
});
