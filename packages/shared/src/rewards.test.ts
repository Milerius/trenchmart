import { describe, expect, it } from 'vitest';
import { displaySplitBps } from './rewards';

describe('displaySplitBps', () => {
  it('gives holders 50% and keeps the bucket proportions on the rest', () => {
    expect(
      displaySplitBps({ buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 }),
    ).toEqual({
      holders: 5000,
      buyback: 2000,
      ai_verification: 1250,
      ops: 1000,
      safety: 750,
    });
  });
  it('always sums to 10_000', () => {
    const s = displaySplitBps({ buyback: 3333, ai_verification: 3333, ops: 3334, safety: 0 });
    expect(s.holders + s.buyback + s.ai_verification + s.ops + s.safety).toBe(10_000);
  });
});
