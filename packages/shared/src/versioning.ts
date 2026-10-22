import { quote, type FeeQuote } from './fee';
import { shortId } from './state';

/**
 * Seller updates, buyer update entitlement, and the daily upload / verification limits.
 * Pure helpers: the API reads the config and the rows, these decide.
 */

export const DAY_MS = 86_400_000;

export type Semver = { major: number; minor: number; patch: number };

export function parseSemver(value: string): Semver | null {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Negative when a < b, 0 when equal, positive when a > b. Invalid versions sort first. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}

/** The form's suggestion for the next version: a patch bump of the highest one. */
export function nextPatch(current: string | null | undefined): string {
  const parsed = current ? parseSemver(current) : null;
  if (!parsed) return '1.0.0';
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function highestSemver(values: string[]): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (!parseSemver(value)) continue;
    if (best === null || compareSemver(value, best) > 0) best = value;
  }
  return best;
}

/** Midnight UTC of the day `now` falls in. Limits reset there. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcDay(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + DAY_MS);
}

export type UploadLimits = { updatesPerListingPerDay: number; uploadsPerCreatorPerDay: number };

export type SupplementReason = 'listing_update_limit' | 'creator_upload_limit';

/**
 * Why this upload needs the SOL supplement, if it does. `updatesToday` counts the listing's
 * updates already created this UTC day, `uploadsToday` every version upload by the creator.
 * Only an update (a listing that already went live) counts against the per-listing limit.
 */
export function uploadSupplementReasons(input: {
  isUpdate: boolean;
  updatesToday: number;
  uploadsToday: number;
  limits: UploadLimits;
}): SupplementReason[] {
  const reasons: SupplementReason[] = [];
  if (input.isUpdate && input.updatesToday >= input.limits.updatesPerListingPerDay) {
    reasons.push('listing_update_limit');
  }
  if (input.uploadsToday >= input.limits.uploadsPerCreatorPerDay) {
    reasons.push('creator_upload_limit');
  }
  return reasons;
}

export const SUPPLEMENT_REASON_TEXT: Record<SupplementReason | 'verify_limit', string> = {
  listing_update_limit: 'This listing already had its free update today (UTC).',
  creator_upload_limit: 'You already used your free uploads today (UTC).',
  verify_limit: 'You already used your free verification today (UTC).',
};

/** A free verification is left only when neither the wallet nor its network used one today. */
export function freeVerificationLeft(input: {
  walletUsedToday: number;
  ipUsedToday: number;
  freePerDay: number;
}): boolean {
  return input.walletUsedToday < input.freePerDay && input.ipUsedToday < input.freePerDay;
}

export function supplementMemo(id: string): string {
  return `sup:${shortId(id)}`;
}

export function renewalMemo(id: string): string {
  return `upd:${shortId(id)}`;
}

/** Suggested monthly update price: a share of the listing price, in basis points. */
export function defaultUpdatePrice(price: bigint, bps: number): bigint {
  if (price <= 0n || bps <= 0) return 0n;
  return (price * BigInt(bps)) / 10_000n;
}

/** A renewal starts where the current entitlement ends, or now if it already lapsed. */
export function renewalWindow(
  now: Date,
  currentUntil: Date | null,
  periodDays: number,
): { startsAt: Date; endsAt: Date } {
  const start =
    currentUntil && currentUntil.getTime() > now.getTime() ? currentUntil : new Date(now);
  return { startsAt: start, endsAt: new Date(start.getTime() + periodDays * DAY_MS) };
}

/** Same fee math as a purchase: platform fee on top, cut by the buyer's $MART tier. */
export function renewalQuote(updatePrice: bigint, feeBps: number, rebateBps: number): FeeQuote {
  return quote(updatePrice, feeBps, rebateBps);
}

export type Period = { startsAt: Date; endsAt: Date };
export type VersionLife = { id: string; liveAt: Date | null; supersededAt: Date | null };

/**
 * A buyer may download a version if it is the one they bought, if updates are free forever,
 * or if the version was the live one at some moment while their updates were active. That
 * covers versions released inside a window and the version that was live when they renewed.
 */
export function versionEntitled(
  version: VersionLife,
  input: { purchasedVersionId: string; forever: boolean; periods: Period[] },
): boolean {
  if (version.id === input.purchasedVersionId) return true;
  if (input.forever) return true;
  if (!version.liveAt) return false;
  const liveFrom = version.liveAt.getTime();
  const liveTo = version.supersededAt ? version.supersededAt.getTime() : Infinity;
  return input.periods.some(
    (period) => liveFrom <= period.endsAt.getTime() && liveTo >= period.startsAt.getTime(),
  );
}

export function updatesActive(input: {
  forever: boolean;
  updatesUntil: Date | null;
  now: Date;
}): boolean {
  if (input.forever) return true;
  return input.updatesUntil !== null && input.updatesUntil.getTime() > input.now.getTime();
}
