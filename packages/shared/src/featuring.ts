import { clampInt } from './social';
import type { Tier } from './tier';

/**
 * Paid featuring ("Featured · Sponsored" slots). Pure pricing, calendar and refund rules so the
 * API, the studio booking page and the tests agree. Every number here is a default; the config
 * rows `feature_slots`, `feature_discount_bps` and `feature_rules` win (admin-editable).
 *
 * Featuring is advertising: it never changes a listing's or creator's rank.
 */

export const FEATURE_KINDS = ['home', 'category', 'band'] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export type FeatureSlot = { perDay: number; lamportsPerDay: bigint };

export type FeatureRules = {
  /** Longest run, in consecutive days, for one listing in one placement. */
  maxConsecutiveDays: number;
  /** How far ahead a run may end, in days from today (UTC). */
  maxDaysAhead: number;
  /** Minimum average rating (x10, so 40 = 4.0) once the listing has reviews. */
  minRatingX10: number;
  /** Minutes a booking is held while the creator pays. */
  holdMinutes: number;
  /** A paid booking cancelled this many hours before it starts is refunded in full. */
  cancelHours: number;
  /** One home slot per creator per day. */
  homePerCreatorPerDay: number;
};

export type FeatureConfig = {
  slots: Record<FeatureKind, FeatureSlot>;
  /** Discount on featuring by $TRENCH tier, in basis points (the existing Scout/Trencher/OG tiers). */
  discountBps: Record<Tier, number>;
  rules: FeatureRules;
};

export const FEATURE_DEFAULTS: FeatureConfig = {
  slots: {
    home: { perDay: 3, lamportsPerDay: 1_500_000_000n },
    category: { perDay: 2, lamportsPerDay: 600_000_000n },
    band: { perDay: 6, lamportsPerDay: 200_000_000n },
  },
  discountBps: { none: 0, scout: 1000, trencher: 2000, og: 3000 },
  rules: {
    maxConsecutiveDays: 7,
    maxDaysAhead: 28,
    minRatingX10: 40,
    holdMinutes: 15,
    cancelHours: 24,
    homePerCreatorPerDay: 1,
  },
};

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  home: 'Home · Featured row',
  category: 'Category page · top row',
  band: 'Live activity band chip',
};

function lamportsOf(value: unknown, fallback: bigint): bigint {
  try {
    if (typeof value === 'bigint') return value >= 0n ? value : fallback;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d{1,19}$/.test(value)) return BigInt(value);
  } catch {
    // fall through
  }
  return fallback;
}

function objectOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Reads the three config rows; unknown or invalid fields keep their defaults. */
export function parseFeatureConfig(raw: {
  slots?: unknown;
  discountBps?: unknown;
  rules?: unknown;
}): FeatureConfig {
  const slotsRaw = objectOf(raw.slots);
  const slots = {} as Record<FeatureKind, FeatureSlot>;
  for (const kind of FEATURE_KINDS) {
    const d = FEATURE_DEFAULTS.slots[kind];
    const s = objectOf(slotsRaw[kind]);
    slots[kind] = {
      perDay: clampInt(s.perDay, d.perDay, 0, 50),
      lamportsPerDay: lamportsOf(s.lamportsPerDay, d.lamportsPerDay),
    };
  }
  const discRaw = objectOf(raw.discountBps);
  const discountBps = {} as Record<Tier, number>;
  for (const tier of ['none', 'scout', 'trencher', 'og'] as const) {
    // Capped at 90%: featuring is never free.
    discountBps[tier] = clampInt(discRaw[tier], FEATURE_DEFAULTS.discountBps[tier], 0, 9000);
  }
  const r = objectOf(raw.rules);
  const d = FEATURE_DEFAULTS.rules;
  return {
    slots,
    discountBps,
    rules: {
      maxConsecutiveDays: clampInt(r.maxConsecutiveDays, d.maxConsecutiveDays, 1, 31),
      maxDaysAhead: clampInt(r.maxDaysAhead, d.maxDaysAhead, 1, 90),
      minRatingX10: clampInt(r.minRatingX10, d.minRatingX10, 0, 50),
      holdMinutes: clampInt(r.holdMinutes, d.holdMinutes, 5, 120),
      cancelHours: clampInt(r.cancelHours, d.cancelHours, 0, 24 * 14),
      homePerCreatorPerDay: clampInt(r.homePerCreatorPerDay, d.homePerCreatorPerDay, 1, 10),
    },
  };
}

export type FeatureQuote = {
  kind: FeatureKind;
  days: number;
  perDayLamports: bigint;
  subtotal: bigint;
  tier: Tier;
  discountBps: number;
  discount: bigint;
  total: bigint;
};

export function quoteFeature(input: {
  kind: FeatureKind;
  days: number;
  tier: Tier;
  config: FeatureConfig;
}): FeatureQuote {
  const perDay = input.config.slots[input.kind].lamportsPerDay;
  const subtotal = perDay * BigInt(input.days);
  const discountBps = input.config.discountBps[input.tier] ?? 0;
  const discount = (subtotal * BigInt(discountBps)) / 10_000n;
  return {
    kind: input.kind,
    days: input.days,
    perDayLamports: perDay,
    subtotal,
    tier: input.tier,
    discountBps,
    discount,
    total: subtotal - discount,
  };
}

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, n: number): string {
  return utcDay(new Date(dayStartMs(day) + n * DAY_MS));
}

export function dayRange(start: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

export function isDay(value: unknown): value is string {
  return (
    typeof value === 'string' && DAY_RE.test(value) && utcDay(new Date(dayStartMs(value))) === value
  );
}

export type DateProblem = 'BAD_DATE' | 'IN_PAST' | 'TOO_LONG' | 'TOO_FAR';

/** A run may start today (UTC), lasts 1..maxConsecutiveDays, and ends within maxDaysAhead. */
export function checkRun(input: {
  start: string;
  days: number;
  now: Date;
  rules: FeatureRules;
}): DateProblem | null {
  if (!isDay(input.start) || !Number.isInteger(input.days) || input.days < 1) return 'BAD_DATE';
  const today = utcDay(input.now);
  if (input.start < today) return 'IN_PAST';
  if (input.days > input.rules.maxConsecutiveDays) return 'TOO_LONG';
  if (addDays(input.start, input.days - 1) > addDays(today, input.rules.maxDaysAhead))
    return 'TOO_FAR';
  return null;
}

/**
 * Longest consecutive run of days once `adding` joins the days already booked for the same
 * listing and placement. Back-to-back bookings cannot dodge the run limit.
 */
export function longestRun(booked: string[], adding: string[]): number {
  const all = [...new Set([...booked, ...adding])].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of all) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

/**
 * Refund owed on a paid booking.
 * - cancelled by the creator at least `cancelHours` before the start: everything;
 * - cancelled later: nothing (the slot was held for them);
 * - listing pulled (delisted, paused, disputed): the days not yet served, today included
 *   when it has not started.
 */
export function featureRefund(input: {
  reason: 'cancel' | 'pulled';
  start: string;
  days: number;
  total: bigint;
  now: Date;
  cancelHours: number;
}): bigint {
  const startMs = dayStartMs(input.start);
  if (input.reason === 'cancel') {
    return startMs - input.now.getTime() >= input.cancelHours * 3_600_000 ? input.total : 0n;
  }
  const today = utcDay(input.now);
  const served = Math.max(
    0,
    Math.min(input.days, Math.round((dayStartMs(today) - startMs) / DAY_MS) + 1),
  );
  // A run pulled on a day it already showed counts that day as served.
  const unserved = input.now.getTime() < startMs ? input.days : input.days - served;
  if (unserved <= 0) return 0n;
  return (input.total * BigInt(unserved)) / BigInt(input.days);
}

/** Hourly rotation: every booked listing gets the first position for an equal share of the day. */
export function rotateHourly<T>(items: T[], now: Date): T[] {
  if (items.length < 2) return items;
  const shift = Math.floor(now.getTime() / 3_600_000) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

export function featureMemo(bookingId: string): string {
  return `tm:feat:${bookingId}`;
}
