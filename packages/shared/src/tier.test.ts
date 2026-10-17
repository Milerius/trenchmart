import { describe, expect, it } from 'vitest';
import { minBalanceInWindow, parseThreshold, tierFor, type BalanceRow } from './tier';

const thresholds = {
  scout: 100n,
  trencher: 1_000n,
  og: 10_000n,
};

function row(amount: bigint, hoursAgo: number, source: BalanceRow['source']): BalanceRow {
  return { amount, ts: new Date(Date.now() - hoursAgo * 3_600_000), source };
}

describe('tierFor', () => {
  it('picks the highest enabled tier', () => {
    expect(tierFor(0n, thresholds)).toBe('none');
    expect(tierFor(100n, thresholds)).toBe('scout');
    expect(tierFor(1_000n, thresholds)).toBe('trencher');
    expect(tierFor(10_000n, thresholds)).toBe('og');
  });

  it('treats placeholder thresholds as disabled', () => {
    expect(parseThreshold('[X]')).toBeUndefined();
    expect(parseThreshold('[Y]')).toBeUndefined();
    expect(parseThreshold('[Z]')).toBeUndefined();
    expect(tierFor(1_000_000_000n, { scout: parseThreshold('[X]') })).toBe('none');
  });
});

describe('minBalanceInWindow', () => {
  const now = new Date();

  it('uses the lowest balance inside 72h, so a sale drops the tier immediately', () => {
    const rows = [row(10_000n, 80, 'snapshot'), row(0n, 1, 'webhook')];
    expect(minBalanceInWindow(rows, now, 72)).toBe(0n);
    expect(tierFor(minBalanceInWindow(rows, now, 72), thresholds)).toBe('none');
  });

  it('ignores a dip older than the window', () => {
    const rows = [row(0n, 100, 'snapshot'), row(10_000n, 80, 'webhook')];
    expect(minBalanceInWindow(rows, now, 72)).toBe(10_000n);
    expect(tierFor(minBalanceInWindow(rows, now, 72), thresholds)).toBe('og');
  });

  it('counts a flash buy as starting from 0 when the first row is a webhook', () => {
    const rows = [row(10_000n, 1, 'webhook')];
    expect(minBalanceInWindow(rows, now, 72)).toBe(0n);
  });

  it('trusts a first snapshot inside the window', () => {
    const rows = [row(1_000n, 1, 'snapshot')];
    expect(minBalanceInWindow(rows, now, 72)).toBe(1_000n);
    expect(tierFor(1_000n, thresholds)).toBe('trencher');
  });

  it('returns 0 when there is no history', () => {
    expect(minBalanceInWindow([], now, 72)).toBe(0n);
  });
});
