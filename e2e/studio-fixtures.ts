// Shared /studio/overview stub for the dashboard specs. Every field is what the API returns.

export type ListingStub = Partial<{
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
}>;

export function studioListing(over: ListingStub = {}) {
  return {
    id: 'L1',
    slug: 'pack',
    title: 'Pack',
    category: 'userscript',
    price: '100000000',
    updatePrice: '10000000',
    delisted: false,
    paused: false,
    coverUrl: null,
    live: null,
    latest: null,
    sales: 0,
    sales7d: 0,
    subscribers: 0,
    rating: null,
    ...over,
  };
}

export function studioOverview(
  wallet: string,
  over: Record<string, unknown> = {},
  listings: ReturnType<typeof studioListing>[] = [],
) {
  const zeros = Array.from({ length: 30 }, () => '0');
  return {
    days: 30,
    since: '2026-09-19T00:00:00.000Z',
    creator: {
      wallet,
      handle: null,
      memberSince: '2026-03-02T00:00:00.000Z',
      displayName: null,
      avatarUrl: null,
      xHandle: null,
      xVerified: false,
      profileFilled: { done: 0, of: 5 },
    },
    revenue: { total: '0', daily: zeros },
    sales: { total30d: 0, last7d: 0, daily: zeros.map(() => 0) },
    updates: { paying: 0, monthly: '0', inFreeMonth: 0 },
    rating: null,
    disputes: { open: 0, upheld: 0 },
    payouts: { sent: '0', inMultisig: '0', queued: '0', inEscrow: '0', nextRelease: null },
    listings,
    ...over,
  };
}
