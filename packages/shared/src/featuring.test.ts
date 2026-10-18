import { describe, expect, it } from 'vitest';
import {
  FEATURE_DEFAULTS,
  addDays,
  checkRun,
  dayRange,
  featureMemo,
  featureRefund,
  isDay,
  longestRun,
  parseFeatureConfig,
  quoteFeature,
  rotateHourly,
} from './featuring';

const NOW = new Date('2026-10-18T10:00:00Z');
const rules = FEATURE_DEFAULTS.rules;

describe('featuring config', () => {
  it('keeps defaults for missing or invalid fields', () => {
    expect(parseFeatureConfig({})).toEqual(FEATURE_DEFAULTS);
    const c = parseFeatureConfig({
      slots: { home: { perDay: 5, lamportsPerDay: '2000000000' }, band: { lamportsPerDay: -1 } },
      discountBps: { og: 9999, scout: 'x', trencher: 2500 },
      rules: { maxConsecutiveDays: 99, holdMinutes: 1 },
    });
    expect(c.slots.home).toEqual({ perDay: 5, lamportsPerDay: 2_000_000_000n });
    expect(c.slots.band.lamportsPerDay).toBe(200_000_000n);
    expect(c.discountBps).toEqual({ none: 0, scout: 1000, trencher: 2500, og: 9000 });
    expect(c.rules.maxConsecutiveDays).toBe(31);
    expect(c.rules.holdMinutes).toBe(5);
  });
});

describe('quoteFeature', () => {
  it('applies the tier discount from config', () => {
    const q = quoteFeature({ kind: 'home', days: 3, tier: 'trencher', config: FEATURE_DEFAULTS });
    expect(q).toMatchObject({
      perDayLamports: 1_500_000_000n,
      subtotal: 4_500_000_000n,
      discountBps: 2000,
      discount: 900_000_000n,
      total: 3_600_000_000n,
    });
    expect(
      quoteFeature({ kind: 'band', days: 1, tier: 'none', config: FEATURE_DEFAULTS }).total,
    ).toBe(200_000_000n);
  });
});

describe('calendar rules', () => {
  it('validates days', () => {
    expect(isDay('2026-10-18')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(dayRange('2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('checks a run', () => {
    expect(checkRun({ start: '2026-10-18', days: 1, now: NOW, rules })).toBeNull();
    expect(checkRun({ start: '2026-10-17', days: 1, now: NOW, rules })).toBe('IN_PAST');
    expect(checkRun({ start: '2026-10-19', days: 8, now: NOW, rules })).toBe('TOO_LONG');
    expect(checkRun({ start: '2026-11-14', days: 2, now: NOW, rules })).toBeNull();
    expect(checkRun({ start: '2026-11-15', days: 2, now: NOW, rules })).toBe('TOO_FAR');
    expect(checkRun({ start: 'nope', days: 1, now: NOW, rules })).toBe('BAD_DATE');
    expect(checkRun({ start: '2026-10-19', days: 0, now: NOW, rules })).toBe('BAD_DATE');
  });

  it('measures back-to-back runs', () => {
    expect(longestRun([], dayRange('2026-10-20', 3))).toBe(3);
    expect(longestRun(dayRange('2026-10-20', 5), dayRange('2026-10-25', 3))).toBe(8);
    expect(longestRun(dayRange('2026-10-20', 5), dayRange('2026-10-26', 3))).toBe(5);
  });
});

describe('featureRefund', () => {
  const base = { start: '2026-10-20', days: 4, total: 4_000n, cancelHours: 24 };
  it('refunds a cancel in full only before the cutoff', () => {
    expect(featureRefund({ ...base, reason: 'cancel', now: NOW })).toBe(4_000n);
    expect(
      featureRefund({ ...base, reason: 'cancel', now: new Date('2026-10-19T01:00:00Z') }),
    ).toBe(0n);
  });
  it('refunds unserved days when the listing is pulled', () => {
    expect(featureRefund({ ...base, reason: 'pulled', now: NOW })).toBe(4_000n);
    expect(
      featureRefund({ ...base, reason: 'pulled', now: new Date('2026-10-20T05:00:00Z') }),
    ).toBe(3_000n);
    expect(
      featureRefund({ ...base, reason: 'pulled', now: new Date('2026-10-22T05:00:00Z') }),
    ).toBe(1_000n);
    expect(
      featureRefund({ ...base, reason: 'pulled', now: new Date('2026-10-25T05:00:00Z') }),
    ).toBe(0n);
  });
});

describe('rotateHourly', () => {
  it('gives each item the lead in turn', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 18, h));
    const leads = [0, 1, 2, 3].map((h) => rotateHourly(['a', 'b', 'c'], at(h))[0]);
    expect(new Set(leads)).toEqual(new Set(['a', 'b', 'c']));
    expect(rotateHourly(['a'], NOW)).toEqual(['a']);
  });
  it('builds the memo', () => {
    expect(featureMemo('abc')).toBe('tm:feat:abc');
  });
});
