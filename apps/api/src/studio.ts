import { creatorStats, isXVerified, loadOwnProfile } from './profile';
import { mediaUrl } from './content';
import type { Deps } from './logic';

type Row = Record<string, any>;

/** Days in the dashboard's revenue and sales series. */
export const OVERVIEW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Index of `at` in a series of `days` UTC days ending today; -1 when outside it. */
export function dayIndex(at: Date, now: Date, days = OVERVIEW_DAYS): number {
  const today = Math.floor(now.getTime() / DAY_MS);
  const day = Math.floor(at.getTime() / DAY_MS);
  const index = days - 1 - (today - day);
  return index >= 0 && index < days ? index : -1;
}

/** Signed-in creator's dashboard: every number comes from orders, renewals, reviews and payouts. */
// Hyperdrive reaches Supabase through the session-mode pooler (15 clients in total). Its
// origin_connection_limit was 20, so bursts got EMAXCONNSESSION; it is now 12, and Hyperdrive
// queues instead. Keep this request's share small anyway.
const OVERVIEW_PARALLEL = 3;

const TRANSIENT_DB =
  /EMAXCONNSESSION|max clients reached|Network connection lost|CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED|ECONNRESET/;

/**
 * Runs a read-only task again once (after 150 ms) when the database connection dropped or the
 * pooler was full. Live, about 1 in 15 overview reads failed this way ("Network connection
 * lost", EMAXCONNSESSION). postgres.js discards a dead connection, so the second attempt gets a
 * fresh one. Never for writes.
 */
export async function retryTransientRead<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (
      !(err instanceof Error) ||
      !TRANSIENT_DB.test(`${err.message} ${(err as { code?: string }).code ?? ''}`)
    )
      throw err;
    await new Promise((r) => setTimeout(r, 150));
    return task();
  }
}

/** Runs the tasks with at most `n` in flight; results keep the input order. */
export async function limited<T>(n: number, tasks: (() => PromiseLike<T> | T)[]): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

export async function studioOverview(deps: Deps, user: Row) {
  const now = deps.now();
  const since = new Date(now.getTime() - (OVERVIEW_DAYS - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const creatorId = user.id as string;

  const salesQ = deps.sql<Row[]>`
    select o.price, o.paid_at from orders o join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId} and o.status in ('paid', 'released')
      and o.paid_at >= ${since}
  `;
  const renewalsQ = deps.sql<Row[]>`
    select r.price, r.paid_at from update_renewals r
    join orders o on o.id = r.order_id join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId} and r.status = 'paid' and r.paid_at >= ${since}
  `;
  // Updates: paying renewers now, and buyers inside their free first month.
  const subsQ = deps.sql<Row[]>`
    select
      count(distinct r.order_id) filter (where r.ends_at > ${now})::int as paying,
      coalesce(sum(l.update_price) filter (where r.ends_at > ${now}), 0)::bigint as monthly
    from update_renewals r join orders o on o.id = r.order_id join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId} and r.status = 'paid'
  `;
  const freeQ = deps.sql<Row[]>`
    select count(*)::int as free from orders o join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId} and o.status in ('paid', 'released')
      and o.updates_until > ${now} and not o.updates_forever
      and not exists (select 1 from update_renewals r where r.order_id = o.id and r.status = 'paid')
  `;

  const ratingsQ = deps.sql<Row[]>`
    select r.rating, count(*)::int as n from listing_reviews r join listings l on l.id = r.listing_id
    where l.creator_id = ${creatorId} and r.hidden_at is null group by r.rating
  `;

  const disputesQ = deps.sql<Row[]>`
    select count(*) filter (where d.status = 'open')::int as open,
      count(*) filter (where d.status = 'upheld')::int as upheld
    from disputes d join orders o on o.id = d.order_id join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId}
  `;

  const payoutsQ = deps.sql<Row[]>`
    select
      coalesce(sum(amount) filter (where status = 'sent'), 0)::bigint as sent,
      coalesce(sum(amount) filter (where status = 'proposed'), 0)::bigint as proposed,
      coalesce(sum(amount) filter (where status = 'pending'), 0)::bigint as pending
    from payouts where recipient = ${user.wallet} and bucket = 'creator'
  `;
  const escrowQ = deps.sql<Row[]>`
    select coalesce(sum(o.price), 0)::bigint as held, min(o.escrow_until) as next_release
    from orders o join listings l on l.id = o.listing_id
    where l.creator_id = ${creatorId} and o.status = 'paid' and o.released_at is null
  `;

  const listingsQ = deps.sql<Row[]>`
    select l.id, l.slug, l.title, l.category, l.price, l.update_price, l.delisted_at, l.paused_at,
      l.live_version_id, lv.semver as live_semver, lv.status as live_status,
      latest.id as latest_id, latest.semver as latest_semver, latest.status as latest_status,
      latest.created_at as latest_at,
      coalesce(c.live->>'coverImageId', c.live->'gallery'->0->>'imageId') as cover_id,
      (select count(*)::int from orders o where o.listing_id = l.id and o.status in ('paid', 'released')) as sales,
      (select count(*)::int from orders o where o.listing_id = l.id and o.status in ('paid', 'released')
        and o.paid_at > ${new Date(now.getTime() - 7 * DAY_MS)}) as sales_7d,
      (select count(distinct r.order_id)::int from update_renewals r join orders o on o.id = r.order_id
        where o.listing_id = l.id and r.status = 'paid' and r.ends_at > ${now}) as subscribers,
      (select count(*)::int from listing_reviews r where r.listing_id = l.id and r.hidden_at is null) as rating_count,
      (select avg(r.rating)::float from listing_reviews r where r.listing_id = l.id and r.hidden_at is null) as rating_avg
    from listings l
    left join versions lv on lv.id = l.live_version_id
    left join listing_content c on c.listing_id = l.id
    left join lateral (
      select v.id, v.semver, v.status, v.created_at from versions v
      where v.listing_id = l.id order by v.created_at desc limit 1
    ) latest on true
    where l.creator_id = ${creatorId}
    order by l.created_at desc
  `;

  // Independent reads, at most OVERVIEW_PARALLEL at a time (they were 12 round trips in a
  // row). All 11 at once opened every pool connection through Hyperdrive at the same moment
  // and about 1 request in 6 failed live ("Network connection lost", CONNECTION_CLOSED).
  // postgres.js queries are lazy, so each one starts only when its slot awaits it.
  const [
    sales,
    renewals,
    [subs],
    [free],
    ratings,
    [disputes],
    [payouts],
    [escrow],
    listings,
    profile,
    stats,
  ] = (await limited<unknown>(OVERVIEW_PARALLEL, [
    () => salesQ,
    () => renewalsQ,
    () => subsQ,
    () => freeQ,
    () => ratingsQ,
    () => disputesQ,
    () => payoutsQ,
    () => escrowQ,
    () => listingsQ,
    () => loadOwnProfile(deps, creatorId),
    () => creatorStats(deps, creatorId),
  ])) as unknown as [
    Row[],
    Row[],
    Row[],
    Row[],
    Row[],
    Row[],
    Row[],
    Row[],
    Row[],
    Awaited<ReturnType<typeof loadOwnProfile>>,
    Awaited<ReturnType<typeof creatorStats>>,
  ];
  const revenueDaily = Array.from({ length: OVERVIEW_DAYS }, () => 0n);
  const salesDaily = Array.from({ length: OVERVIEW_DAYS }, () => 0);
  let sales7d = 0;
  for (const row of sales) {
    const i = dayIndex(row.paid_at as Date, now);
    if (i < 0) continue;
    revenueDaily[i]! += row.price as bigint;
    salesDaily[i]! += 1;
    if (i >= OVERVIEW_DAYS - 7) sales7d += 1;
  }
  for (const row of renewals) {
    const i = dayIndex(row.paid_at as Date, now);
    if (i >= 0) revenueDaily[i]! += row.price as bigint;
  }

  const distribution = [5, 4, 3, 2, 1].map(
    (stars) => ratings.find((r) => r.rating === stars)?.n ?? 0,
  );

  const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);

  return {
    days: OVERVIEW_DAYS,
    since: since.toISOString(),
    creator: {
      wallet: user.wallet,
      handle: user.handle ?? null,
      memberSince: user.created_at,
      displayName: profile.displayName,
      avatarUrl: profile.avatar?.url ?? null,
      xHandle: profile.xHandle,
      xVerified: isXVerified(user),
      profileFilled: profileFilled(profile),
    },
    revenue: { total: sum(revenueDaily), daily: revenueDaily },
    sales: { total30d: salesDaily.reduce((a, b) => a + b, 0), last7d: sales7d, daily: salesDaily },
    updates: {
      paying: subs?.paying ?? 0,
      monthly: (subs?.monthly as bigint | undefined) ?? 0n,
      inFreeMonth: free?.free ?? 0,
    },
    rating: stats.ratingCount
      ? { avg: stats.ratingAvg, count: stats.ratingCount, distribution }
      : null,
    disputes: { open: disputes?.open ?? 0, upheld: disputes?.upheld ?? 0 },
    payouts: {
      sent: payouts?.sent ?? 0n,
      inMultisig: payouts?.proposed ?? 0n,
      queued: payouts?.pending ?? 0n,
      inEscrow: escrow?.held ?? 0n,
      nextRelease: escrow?.next_release ?? null,
    },
    listings: listings.map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      category: l.category,
      price: l.price,
      updatePrice: l.update_price,
      delisted: Boolean(l.delisted_at),
      paused: Boolean(l.paused_at),
      coverUrl: l.cover_id ? mediaUrl(l.cover_id as string) : null,
      live: l.live_version_id ? { semver: l.live_semver, status: l.live_status } : null,
      latest: l.latest_id
        ? { id: l.latest_id, semver: l.latest_semver, status: l.latest_status, at: l.latest_at }
        : null,
      sales: l.sales,
      sales7d: l.sales_7d,
      subscribers: l.subscribers,
      rating: l.rating_count
        ? { avg: Math.round((l.rating_avg as number) * 10) / 10, count: l.rating_count }
        : null,
    })),
  };
}

/** Profile parts filled: display name, bio, avatar, banner, X. */
export function profileFilled(profile: Row): { done: number; of: number } {
  const parts = [
    Boolean(profile.displayName),
    Boolean(profile.bio),
    Boolean(profile.avatar),
    Boolean(profile.banner),
    Boolean(profile.xHandle),
  ];
  return { done: parts.filter(Boolean).length, of: parts.length };
}

/** Page size bounds shared by the creator data endpoints. */
function pageOf(limit: string | undefined, before: string | undefined) {
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  const at = before ? new Date(before) : null;
  return { limit: n, before: at && !Number.isNaN(at.getTime()) ? at : null };
}

/** Every completed sale of the creator's listings, newest first (paid, released, disputed, refunded). */
export async function studioSales(
  deps: Deps,
  user: Row,
  query: { limit?: string; before?: string },
) {
  const page = pageOf(query.limit, query.before);
  const rows = await deps.sql<Row[]>`
    select o.id, o.listing_id, l.slug, l.title, b.wallet as buyer, v.semver, o.price, o.fee, o.rebate,
      o.total, o.tier_at_purchase as tier, o.status, o.tx_sig, o.paid_at, o.escrow_until, o.released_at
    from orders o
    join listings l on l.id = o.listing_id
    join users b on b.id = o.buyer_id
    left join versions v on v.id = o.version_id
    where l.creator_id = ${user.id as string}
      and o.status in ('paid', 'released', 'disputed', 'refunded') and o.paid_at is not null
      and (${page.before}::timestamptz is null or o.paid_at < ${page.before}::timestamptz)
    order by o.paid_at desc limit ${page.limit}
  `;
  const last = rows.length === page.limit ? rows[rows.length - 1] : undefined;
  return { sales: rows, nextBefore: last ? (last.paid_at as Date).toISOString() : null };
}

/** Buyers who currently receive updates: forever, inside the free first period, or paying renewals. */
export async function studioSubscribers(deps: Deps, user: Row) {
  const now = deps.now();
  const rows = await deps.sql<Row[]>`
    select o.id as order_id, l.id as listing_id, l.slug, b.wallet as buyer, o.updates_forever,
      o.updates_until, max(r.ends_at) filter (where r.status = 'paid') as renewal_ends_at
    from orders o
    join listings l on l.id = o.listing_id
    join users b on b.id = o.buyer_id
    left join update_renewals r on r.order_id = o.id
    where l.creator_id = ${user.id as string} and o.status in ('paid', 'released')
    group by o.id, l.id, b.wallet
    having o.updates_forever or o.updates_until > ${now}
      or max(r.ends_at) filter (where r.status = 'paid') > ${now}
    order by l.slug, o.paid_at desc
    limit 1000
  `;
  const subscribers = rows.map((row) => {
    const renewal = row.renewal_ends_at as Date | null;
    const status = row.updates_forever ? 'forever' : renewal && renewal > now ? 'paying' : 'free';
    const until = row.updates_forever
      ? null
      : ([row.updates_until as Date | null, renewal]
          .filter((d): d is Date => !!d)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null);
    return {
      orderId: row.order_id,
      listingId: row.listing_id,
      slug: row.slug,
      buyer: row.buyer,
      status,
      until,
    };
  });
  return {
    counts: {
      forever: subscribers.filter((s) => s.status === 'forever').length,
      paying: subscribers.filter((s) => s.status === 'paying').length,
      free: subscribers.filter((s) => s.status === 'free').length,
    },
    subscribers,
  };
}

/** Visible reviews on the creator's listings with any reply; `unreplied` keeps only open ones. */
export async function studioReviews(
  deps: Deps,
  user: Row,
  query: { limit?: string; before?: string; unreplied?: string },
) {
  const page = pageOf(query.limit, query.before);
  const unreplied = query.unreplied === '1' || query.unreplied === 'true';
  const rows = await deps.sql<Row[]>`
    select r.id, r.listing_id, l.slug, l.title, r.rating, r.body, r.terminal, v.semver, u.wallet as reviewer,
      r.created_at, r.edited_at, rr.body as reply, rr.created_at as replied_at, rr.edited_at as reply_edited_at
    from listing_reviews r
    join listings l on l.id = r.listing_id
    left join users u on u.id = r.reviewer_id
    left join versions v on v.id = r.version_id
    left join review_replies rr on rr.review_id = r.id
    where l.creator_id = ${user.id as string} and r.hidden_at is null
      and (not ${unreplied} or rr.review_id is null)
      and (${page.before}::timestamptz is null or r.created_at < ${page.before}::timestamptz)
    order by r.created_at desc limit ${page.limit}
  `;
  const last = rows.length === page.limit ? rows[rows.length - 1] : undefined;
  return { reviews: rows, nextBefore: last ? (last.created_at as Date).toISOString() : null };
}
