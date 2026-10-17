import { describe, expect, it } from 'vitest';
import { quote, quoteFromConfig, splitFee, sumSplit } from './fee';
import { solToLamports } from './money';

const SPLIT = { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 };

describe('quote', () => {
  it('matches the 1.5 SOL Trencher example', () => {
    const price = solToLamports('1.5');
    const q = quote(price, 500, 6000);
    expect(q.fee).toBe(75_000_000n);
    expect(q.rebate).toBe(45_000_000n);
    expect(q.total).toBe(1_530_000_000n);
    expect(q.netFee).toBe(30_000_000n);
  });

  it('charges nothing extra at OG (100% rebate)', () => {
    const q = quote(solToLamports('1.5'), 500, 10_000);
    expect(q.total).toBe(q.price);
    expect(q.netFee).toBe(0n);
  });

  it('zero price stays zero', () => {
    const q = quote(0n, 500, 6000);
    expect(q.total).toBe(0n);
    expect(q.fee).toBe(0n);
  });

  it('floors fee math', () => {
    expect(quote(1n, 500, 0).fee).toBe(0n);
    expect(quote(10_001n, 500, 0).fee).toBe(500n);
  });

  it('rejects negative basis points and accepts string prices', () => {
    expect(() => quote(1n, -1, 0)).toThrow(/bps/);
    expect(() => quote(1n, 0, -1)).toThrow(/bps/);
    expect(quoteFromConfig('10000', 500, 0).fee).toBe(500n);
  });
});

describe('splitFee', () => {
  it('splits the Trencher net fee with no dust', () => {
    const parts = splitFee(30_000_000n, SPLIT);
    expect(parts.buyback).toBe(12_000_000n);
    expect(parts.ai_verification).toBe(7_500_000n);
    expect(parts.ops).toBe(6_000_000n);
    expect(parts.safety).toBe(4_500_000n);
    expect(sumSplit(parts)).toBe(30_000_000n);
  });

  it('gives rounding dust to ops', () => {
    const parts = splitFee(10n, SPLIT);
    expect(sumSplit(parts)).toBe(10n);
    expect(parts.ops).toBe(3n);
  });

  it('zero net fee splits to zero', () => {
    expect(sumSplit(splitFee(0n, SPLIT))).toBe(0n);
  });

  it('creates an ops line for dust when the split omits ops', () => {
    const parts = splitFee(3n, { buyback: 5000 });
    expect(parts.buyback).toBe(1n);
    expect(parts.ops).toBe(2n);
    expect(sumSplit(parts)).toBe(3n);
    expect(sumSplit({})).toBe(0n);
  });
});
