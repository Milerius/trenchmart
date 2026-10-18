import { solText } from './money';

/** What the Purchases page knows about an order's updates (GET /me/orders → updates). */
export type OrderUpdates = {
  purchased: { id: string; semver: string } | null;
  current: { id: string; semver: string } | null;
  latest: { id: string; semver: string; changelog: string } | null;
  latestEntitled: { id: string; semver: string } | null;
  updateAvailable: boolean;
  entitledToLatest: boolean;
  changes: { semver: string; changelog: string }[];
  updatesUntil: string | null;
  forever: boolean;
  active: boolean;
  updatePrice: string;
  renewTotal: string;
  periodDays: number;
  versions: { id: string; semver: string; purchased: boolean }[];
};

export type UpdateBanner =
  | { kind: 'none' }
  | { kind: 'included'; from: string; to: string }
  | { kind: 'renew'; from: string; to: string; price: string };

/** "Update available vX → vY", and whether downloading it needs a renewal. */
export function updateBanner(updates: OrderUpdates | null | undefined): UpdateBanner {
  if (!updates || !updates.updateAvailable || !updates.latest || !updates.current) {
    return { kind: 'none' };
  }
  const from = updates.current.semver;
  const to = updates.latest.semver;
  if (updates.entitledToLatest) return { kind: 'included', from, to };
  return { kind: 'renew', from, to, price: updates.renewTotal };
}

/** One line under the order: until when updates are included. */
export function updatesStatus(updates: OrderUpdates | null | undefined, now = Date.now()): string {
  if (!updates) return '';
  if (updates.forever) return 'Free updates forever';
  if (!updates.updatesUntil) return 'Updates not included';
  const until = new Date(updates.updatesUntil);
  const day = until.toISOString().slice(0, 10);
  return until.getTime() > now ? `Updates included until ${day}` : `Updates ended ${day}`;
}

/** Listing page and docs: the seller's update policy in one sentence. */
export function updatePolicyText(updatePrice: string | null | undefined, freeDays: number): string {
  if (updatePrice === null || updatePrice === undefined || BigInt(updatePrice) === 0n) {
    return 'Free updates forever';
  }
  return `Free updates for ${freeDays} days, then ${solText(updatePrice)}/month`;
}

/** Supplement reasons; the upload count comes from the live config (quota.limits), never hard-coded. */
export function supplementReasons(uploadsPerCreatorPerDay?: number): Record<string, string> {
  const uploads =
    uploadsPerCreatorPerDay === undefined
      ? 'free uploads'
      : `${uploadsPerCreatorPerDay} free uploads`;
  return {
    listing_update_limit: 'This listing already had its free update today (UTC).',
    creator_upload_limit: `You already used your ${uploads} today (UTC).`,
    verify_limit: 'Your free verification for today (UTC) is used.',
  };
}

export function supplementReasonText(reasons: string[], uploadsPerCreatorPerDay?: number): string {
  const text = supplementReasons(uploadsPerCreatorPerDay);
  return reasons.map((reason) => text[reason] ?? reason).join(' ');
}
