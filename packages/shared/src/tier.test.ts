import { describe, expect, it } from 'vitest';
import {
  minBalanceInWindow,
  nextTierNeed,
  parseThreshold,
  parseThresholds,
  requiredBondLamports,
  tierAtLeast,
  tierFor,
  type BalanceRow,
} from './tier';

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
    expect(parseThreshold(10n)).toBe(10n);
    expect(parseThreshold(-1n)).toBeUndefined();
    expect(parseThreshold(25)).toBe(25n);
    expect(parseThreshold(-2)).toBeUndefined();
    expect(parseThreshold(1.5)).toBeUndefined();
    expect(parseThreshold({})).toBeUndefined();
    expect(parseThreshold('')).toBeUndefined();
    expect(tierFor(1_000_000_000n, { scout: parseThreshold('[X]') })).toBe('none');
    expect(tierFor(10n, {})).toBe('none');
    expect(tierFor(10n, { scout: 5n })).toBe('scout');
    expect(tierFor(10n, { trencher: 5n })).toBe('trencher');
    expect(parseThresholds({ scout: '5', trencher: '[Y]', og: 9 })).toEqual({
      scout: 5n,
      trencher: undefined,
      og: 9n,
    });
  });

  it('reports the next threshold and bond requirements', () => {
    expect(tierAtLeast('og', 'trencher')).toBe(true);
    expect(tierAtLeast('scout', 'trencher')).toBe(false);
    expect(nextTierNeed(0n, thresholds)).toEqual({ nextTier: 'scout', needed: 100n });
    expect(nextTierNeed(100n, thresholds).nextTier).toBe('trencher');
    expect(nextTierNeed(10_000n, thresholds)).toEqual({ nextTier: null, needed: 0n });
    expect(nextTierNeed(0n, {})).toEqual({ nextTier: null, needed: 0n });
    expect(requiredBondLamports(['filter', 'missing'], { filter: 100n }, 'none', 5000)).toBe(100n);
    expect(requiredBondLamports(['userscript'], { userscript: 100n }, 'og', 5000)).toBe(50n);
    expect(requiredBondLamports([], {}, 'none', 5000)).toBe(0n);
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

  it('trusts a first snapshot or reconcile inside the window', () => {
    const rows = [row(1_000n, 1, 'snapshot')];
    expect(minBalanceInWindow(rows, now, 72)).toBe(1_000n);
    expect(minBalanceInWindow([row(800n, 2, 'reconcile'), row(50n, 1, 'webhook')], now, 72)).toBe(
      50n,
    );
    expect(minBalanceInWindow([row(50n, 3, 'snapshot'), row(800n, 1, 'webhook')], now, 72)).toBe(
      50n,
    );
    expect(tierFor(1_000n, thresholds)).toBe('trencher');
  });

  it('returns 0 when there is no history', () => {
    expect(minBalanceInWindow([], now, 72)).toBe(0n);
  });
});
