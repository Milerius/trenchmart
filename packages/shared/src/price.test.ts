import { describe, expect, it } from 'vitest';
import { lamportsToUsdCents, moneyView, parseUsdCents } from './price';

describe('SOL/USD display math', () => {
  it('parses a dollar string into cents and converts lamports without floats', () => {
    expect(parseUsdCents('')).toBeNull();
    expect(parseUsdCents('nope')).toBeNull();
    expect(parseUsdCents('100')).toBe(10_000n);
    expect(parseUsdCents('100.5')).toBe(10_050n);
    expect(lamportsToUsdCents(1_500_000_000n, 10_050n)).toBe(15_075n);
    expect(moneyView(1_500_000_000n, null, '1.500').usdCents).toBeNull();
    expect(() => lamportsToUsdCents(-1n, 1n)).toThrow(/amounts/);
  });
});
