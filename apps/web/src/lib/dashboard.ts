/** Pure helpers for the creator dashboard at /studio. */

export type OverviewListing = {
  id: string;
  slug: string;
  title: string;
  category: string;
  price: string;
  updatePrice: string;
  delisted: boolean;
  paused: boolean;
  coverUrl: string | null;
  live: { semver: string; status: string } | null;
  latest: { id: string; semver: string; status: string; at: string } | null;
  sales: number;
  sales7d: number;
  subscribers: number;
  rating: { avg: number; count: number } | null;
};

export type Overview = {
  days: number;
  since: string;
  creator: {
    wallet: string;
    handle: string | null;
    memberSince: string;
    displayName: string | null;
    avatarUrl: string | null;
    xHandle: string | null;
    xVerified: boolean;
    profileFilled: { done: number; of: number };
  };
  revenue: { total: string; daily: string[] };
  sales: { total30d: number; last7d: number; daily: number[] };
  updates: { paying: number; monthly: string; inFreeMonth: number };
  rating: { avg: number; count: number; distribution: number[] } | null;
  disputes: { open: number; upheld: number };
  payouts: {
    sent: string;
    inMultisig: string;
    queued: string;
    inEscrow: string;
    nextRelease: string | null;
  };
  listings: OverviewListing[];
};

export type Bucket = 'live' | 'review' | 'draft' | 'off';

const REVIEWING = new Set(['uploading', 'scanning', 'in_review', 'needs_creator']);

/** Status shown for a listing: the newest version while it is under review, else the live one. */
export function statusOf(l: OverviewListing): string {
  if (l.delisted) return 'delisted';
  if (l.latest && REVIEWING.has(l.latest.status)) return l.latest.status;
  if (l.live) return 'live';
  return l.latest?.status ?? 'draft';
}

/** Filter tab a listing belongs to. */
export function bucketOf(l: OverviewListing): Bucket {
  const status = statusOf(l);
  if (status === 'delisted' || status === 'rejected') return l.live && !l.delisted ? 'live' : 'off';
  if (REVIEWING.has(status)) return l.live ? 'review' : status === 'uploading' ? 'draft' : 'review';
  if (status === 'live') return 'live';
  return 'draft';
}

export type Action = {
  label: string;
  href: string;
  testid: string;
  tone: 'secondary' | 'warn' | 'primary';
};

/** The one next step a creator can take on a listing row. */
export function actionFor(l: OverviewListing): Action | null {
  const status = statusOf(l);
  const version = l.latest ? `/studio/listings/${l.id}/versions/${l.latest.id}` : null;
  if (status === 'needs_creator' && version)
    return { label: 'Add review note', href: version, testid: 'add-note', tone: 'warn' };
  if ((status === 'scanning' || status === 'in_review') && version)
    return { label: 'Watch review', href: version, testid: 'watch-review', tone: 'secondary' };
  if (status === 'uploading')
    return {
      label: 'Finish upload',
      href: `/studio/listings/${l.id}/versions/new`,
      testid: 'finish-upload',
      tone: 'primary',
    };
  if (l.live && !l.delisted)
    return {
      label: 'Upload new version',
      href: `/studio/listings/${l.id}/versions/new`,
      testid: 'upload-new-version',
      tone: 'secondary',
    };
  return null;
}

/** Second line under the status tag. */
export function statusNote(l: OverviewListing, now = Date.now()): string {
  const status = statusOf(l);
  const since = l.latest ? ago(l.latest.at, now) : '';
  if (status === 'needs_creator')
    return l.live ? `v${l.live.semver} stays live meanwhile` : 'waiting on you';
  if (status === 'scanning' || status === 'in_review')
    return l.live ? `v${l.live.semver} stays live meanwhile` : 'automated review running';
  if (status === 'live') return since ? `live · updated ${since}` : 'live';
  if (status === 'rejected') return 'see the review for why';
  if (status === 'delisted') return 'hidden from the market';
  if (l.paused) return 'paused: bond below the minimum';
  return 'not published';
}

export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/** SVG polyline points for a sparkline; null when every value is zero (nothing to draw). */
export function sparkPoints(
  values: readonly (number | string | bigint)[],
  width = 160,
  height = 32,
): string | null {
  const nums = values.map((v) => Number(v));
  const max = Math.max(0, ...nums);
  if (!nums.length || max === 0) return null;
  const step = nums.length > 1 ? width / (nums.length - 1) : 0;
  return nums
    .map((v, i) => `${round(i * step)},${round(height - 2 - (v / max) * (height - 4))}`)
    .join(' ');
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Share of a rating bar, 0–100. */
export function barShare(count: number, all: readonly number[]): number {
  const total = all.reduce((a, b) => a + b, 0);
  return total ? Math.round((count / total) * 100) : 0;
}
