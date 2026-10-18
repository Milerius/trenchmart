import type { Hono } from 'hono';
import { bayesianRating, CATEGORIES, jsonSafe, utcDay } from '@trenchmart/shared';
import type { Deps } from './logic';
import { featuredToday } from './featuring';
import { loadRankConfig } from './ranking';
import {
  identityColumns,
  identityRow,
  loadSocialConfig,
  type Row,
  type SocialVars,
} from './social';

/**
 * Site-wide social data: the creator leaderboard (/creators), "Paid to creators", and the live
 * activity feed behind the home band and ticker. Everything is computed from released escrow
 * orders, visible reviews and counted upvotes; nothing is sampled or invented.
 */

const DAY_MS = 86_400_000;
const TABS = ['earners', 'rated', 'rising', 'upvoted'] as const;
const RANGES = { '7d': 7, '30d': 30, all: null } as const;
type Tab = (typeof TABS)[number];
type Range = keyof typeof RANGES;

/** Released orders only: refunds and upheld disputes never reach `released`. */
export async function paidToCreators(deps: Deps) {
  const now = deps.now();
  const [row] = await deps.sql<Row[]>`
    select
      coalesce(sum(price), 0)::bigint as total,
      coalesce(sum(price) filter (where released_at > ${new Date(now.getTime() - DAY_MS)}), 0)::bigint as day,
      coalesce(sum(price) filter (where released_at > ${new Date(now.getTime() - 30 * DAY_MS)}), 0)::bigint as d30,
      coalesce(sum(price) filter (where released_at > ${new Date(now.getTime() - 60 * DAY_MS)}
        and released_at <= ${new Date(now.getTime() - 30 * DAY_MS)}), 0)::bigint as prev30,
      count(*)::int as orders
    from orders where status = 'released'
  `;
  return {
    lamports: BigInt(row?.total ?? 0),
    last24h: BigInt(row?.day ?? 0),
    last30d: BigInt(row?.d30 ?? 0),
    prior30d: BigInt(row?.prev30 ?? 0),
    orders: (row?.orders as number) ?? 0,
  };
}

type Board = {
  tab: Tab;
  range: Range;
  rows: Row[];
  total: number;
};

async function leaderboard(
  deps: Deps,
  q: {
    tab: Tab;
    range: Range;
    category: string | null;
    verified: boolean;
    offset: number;
    limit: number;
  },
): Promise<Board> {
  const now = deps.now();
  const social = await loadSocialConfig(deps);
  const rank = await loadRankConfig(deps);
  const days = RANGES[q.range];
  const start = days ? new Date(now.getTime() - days * DAY_MS) : new Date(0);
  // Rising compares this range with the one before it ("all" compares the last 30 days).
  const span = (days ?? 30) * DAY_MS;
  const riseStart = new Date(now.getTime() - span);
  const prevStart = new Date(now.getTime() - 2 * span);
  const funderSince = new Date(now.getTime() - social.funderWindowDays * DAY_MS);
  const [site] = await deps.sql<{ avg: number | null }[]>`
    select avg(rating)::float as avg from listing_reviews where hidden_at is null
  `;
  const prior = site?.avg ?? null;

  const rows = await deps.sql<Row[]>`
    with counted as (
      select o.listing_id, l.creator_id, o.price, o.released_at
      from orders o
      join listings l on l.id = o.listing_id
      join users b on b.id = o.buyer_id
      join users cu on cu.id = l.creator_id
      left join wallet_intel wi on wi.wallet = b.wallet
      where o.status = 'released' and o.buyer_id <> l.creator_id
        and (${q.category}::text is null or l.category::text = ${q.category})
        and not exists (
          select 1 from jsonb_array_elements(coalesce(wi.funders, '[]'::jsonb)) f
          where f->>'wallet' = cu.wallet and (f->>'at')::timestamptz >= ${funderSince}
        )
    ),
    per as (
      select creator_id,
        count(*) filter (where released_at >= ${start})::int as sales,
        coalesce(sum(price) filter (where released_at >= ${start}), 0)::bigint as paid,
        count(*) filter (where released_at >= ${riseStart})::int as rise_now,
        count(*) filter (where released_at >= ${prevStart} and released_at < ${riseStart})::int as rise_prev,
        min(released_at) as first_sale
      from counted group by creator_id
    ),
    live as (
      select creator_id, count(*)::int as listings,
        coalesce(sum(upvote_weight), 0)::int as upvote_weight, coalesce(sum(upvote_count), 0)::int as upvote_count
      from listings
      where delisted_at is null and live_version_id is not null
        and (${q.category}::text is null or category::text = ${q.category})
      group by creator_id
    ),
    rated as (
      select l.creator_id, count(*)::int as n, avg(r.rating)::float as avg
      from listing_reviews r join listings l on l.id = r.listing_id
      where r.hidden_at is null and (${q.category}::text is null or l.category::text = ${q.category})
      group by l.creator_id
    )
    select u.id, ${deps.sql.unsafe(identityColumns('u', ''))}, u.created_at,
      coalesce(p.sales, 0) as sales, coalesce(p.paid, 0) as paid, coalesce(p.rise_now, 0) as rise_now,
      coalesce(p.rise_prev, 0) as rise_prev, p.first_sale,
      coalesce(lv.listings, 0) as listings, coalesce(lv.upvote_weight, 0) as upvote_weight,
      coalesce(lv.upvote_count, 0) as upvote_count,
      coalesce(rt.n, 0) as reviews, rt.avg as rating_avg,
      cr.rank as overall_rank, cr.prev_rank
    from users u
    left join per p on p.creator_id = u.id
    left join live lv on lv.creator_id = u.id
    left join rated rt on rt.creator_id = u.id
    left join creator_rank cr on cr.creator_id = u.id
    where u.banned_at is null and (p.creator_id is not null or lv.creator_id is not null)
      and (${q.verified} = false or (u.x_user_id is not null and u.x_user_id not like 'dev:%'))
  `;

  const scored = rows
    .map((r) => {
      const bayes = bayesianRating(
        r.reviews as number,
        (r.rating_avg as number | null) ?? null,
        rank.bayesM,
        prior,
      );
      const prev = r.rise_prev as number;
      const rise = (r.rise_now as number) / Math.max(1, prev);
      return { ...(r as Row), bayes, rise } as Row & { bayes: number | null; rise: number };
    })
    .filter((r) => {
      if (q.tab === 'earners') return BigInt(r.paid as string | number) > 0n;
      if (q.tab === 'rated') return (r.reviews as number) >= rank.topRatedMinReviews;
      if (q.tab === 'rising') return (r.rise_now as number) >= rank.risingMinSales;
      return (r.upvote_weight as number) > 0;
    });
  const key = (r: (typeof scored)[number]): number[] => {
    if (q.tab === 'earners') return [Number(r.paid), r.sales as number];
    if (q.tab === 'rated') return [r.bayes ?? 0, r.reviews as number];
    if (q.tab === 'rising') return [r.rise, r.rise_now as number];
    return [r.upvote_weight as number, r.upvote_count as number];
  };
  scored.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return kb[0]! - ka[0]! || kb[1]! - ka[1]! || String(a.id).localeCompare(String(b.id));
  });
  const page = scored.slice(q.offset, q.offset + q.limit);
  const ids = page.map((r) => r.id as string);
  const tops = new Map<string, Row>();
  const sparks = new Map<string, number[]>();
  if (ids.length) {
    const top = await deps.sql<Row[]>`
      select distinct on (l.creator_id) l.creator_id, l.title, l.slug, count(o.id)::int as n
      from listings l left join orders o on o.listing_id = l.id and o.status = 'released' and o.released_at >= ${start}
      where l.creator_id in ${deps.sql(ids)} and l.delisted_at is null and l.live_version_id is not null
      group by l.creator_id, l.id
      order by l.creator_id, count(o.id) desc, l.created_at asc
    `;
    for (const t of top) tops.set(t.creator_id as string, t);
    const sparkDays = 14;
    const from = new Date(now.getTime() - sparkDays * DAY_MS);
    const daily = await deps.sql<Row[]>`
      select l.creator_id, floor(extract(epoch from (o.released_at - ${from}::timestamptz)) / 86400)::int as d,
        sum(o.price)::bigint as paid
      from orders o join listings l on l.id = o.listing_id
      where o.status = 'released' and o.released_at >= ${from} and l.creator_id in ${deps.sql(ids)}
      group by 1, 2
    `;
    for (const id of ids)
      sparks.set(
        id,
        Array.from({ length: sparkDays }, () => 0),
      );
    for (const d of daily) {
      const arr = sparks.get(d.creator_id as string);
      const i = d.d as number;
      if (arr && i >= 0 && i < arr.length) arr[i] = Number(BigInt(d.paid as string | number)) / 1e9;
    }
  }
  return {
    tab: q.tab,
    range: q.range,
    total: scored.length,
    rows: page.map((r, i) => {
      const top = tops.get(r.id as string);
      return {
        position: q.offset + i + 1,
        creator: identityRow(r),
        sales: r.sales,
        paidLamports: BigInt(r.paid as string | number),
        rating: r.reviews
          ? { avg: Math.round((r.rating_avg as number) * 10) / 10, count: r.reviews }
          : null,
        bayes: r.bayes === null ? null : Math.round(r.bayes * 100) / 100,
        upvotes: {
          counted: Math.round(((r.upvote_weight as number) / 10_000) * 10) / 10,
          raw: r.upvote_count,
        },
        rising:
          q.tab === 'rising'
            ? { now: r.rise_now, prev: r.rise_prev, ratio: Math.round(r.rise * 10) / 10 }
            : null,
        listings: r.listings,
        topListing: top ? { title: top.title, slug: top.slug } : null,
        isNew: Boolean(
          r.first_sale && new Date(r.first_sale as string).getTime() >= start.getTime() && days,
        ),
        movement:
          q.tab === 'earners' && r.overall_rank && r.prev_rank
            ? (r.prev_rank as number) - (r.overall_rank as number)
            : null,
        spark: sparks.get(r.id as string) ?? [],
      };
    }),
  };
}

export async function activityFeed(deps: Deps, limit = 24) {
  const since = new Date(deps.now().getTime() - 14 * DAY_MS);
  const rows = await deps.sql<Row[]>`
    (select 'sale' as kind, o.paid_at as at, l.title, l.slug, l.category::text as category, o.price as amount, null::int as rating, null::text as semver
      from orders o join listings l on l.id = o.listing_id
      where o.status in ('paid', 'released') and o.paid_at > ${since} and o.buyer_id <> l.creator_id
      order by o.paid_at desc limit ${limit})
    union all
    (select 'review', r.created_at, l.title, l.slug, l.category::text, null, r.rating, null
      from listing_reviews r join listings l on l.id = r.listing_id
      where r.hidden_at is null and r.created_at > ${since}
      order by r.created_at desc limit ${limit})
    union all
    (select 'new', l.first_live_at, l.title, l.slug, l.category::text, l.price, null, null
      from listings l
      where l.first_live_at > ${since} and l.delisted_at is null and l.live_version_id is not null
      order by l.first_live_at desc limit ${limit})
    union all
    (select 'featured', greatest(b.start_day::timestamptz, b.paid_at), l.title, l.slug, l.category::text, null, null, b.kind
      from feature_bookings b join listings l on l.id = b.listing_id
      where b.status in ('paid', 'completed') and b.start_day <= ${utcDay(deps.now())}::date and b.start_day > ${utcDay(since)}::date
        and l.delisted_at is null
      order by b.start_day desc limit ${limit})
    union all
    (select 'update', v.created_at, l.title, l.slug, l.category::text, null, null, v.semver
      from versions v join listings l on l.id = v.listing_id
      where v.status = 'live' and v.created_at > ${since} and l.delisted_at is null
        and v.id = l.live_version_id and l.first_live_at < v.created_at
      order by v.created_at desc limit ${limit})
    order by at desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    kind: r.kind as 'sale' | 'review' | 'new' | 'update' | 'featured',
    at: r.at,
    listing: { title: r.title, slug: r.slug, category: r.category },
    amountLamports: r.amount === null ? null : BigInt(r.amount as string | number),
    rating: r.rating ?? null,
    semver: r.kind === 'featured' ? null : (r.semver ?? null),
    placement: r.kind === 'featured' ? (r.semver as string) : null,
  }));
}

export function registerLeaderboardRoutes(api: Hono<SocialVars>, deps: Deps): void {
  api.get('/creators/leaderboard', async (c) => {
    const tab = (TABS as readonly string[]).includes(c.req.query('tab') ?? '')
      ? (c.req.query('tab') as Tab)
      : 'earners';
    const rangeRaw = c.req.query('range') ?? '';
    const range: Range = Object.hasOwn(RANGES, rangeRaw) ? (rangeRaw as Range) : '30d';
    const categoryRaw = c.req.query('category') ?? '';
    const category = CATEGORIES.some((cat) => cat.code === categoryRaw) ? categoryRaw : null;
    const verified = c.req.query('verified') === '1';
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 10));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const [board, paid, ranked, rank, social] = await Promise.all([
      leaderboard(deps, { tab, range, category, verified, offset, limit }),
      paidToCreators(deps),
      deps.sql<{ n: number; x: number }[]>`
        select count(*)::int as n,
          count(*) filter (where u.x_user_id is not null and u.x_user_id not like 'dev:%')::int as x
        from creator_rank cr join users u on u.id = cr.creator_id where cr.rank is not null
      `,
      loadRankConfig(deps),
      loadSocialConfig(deps),
    ]);
    return c.json(
      jsonSafe({
        ...board,
        category,
        verified,
        offset,
        summary: {
          paidLamports: paid.lamports,
          paid30dLamports: paid.last30d,
          paidPrior30dLamports: paid.prior30d,
          rankedCreators: ranked[0]?.n ?? 0,
          xVerifiedCreators: ranked[0]?.x ?? 0,
        },
        rules: {
          bayesM: rank.bayesM,
          topRatedMinReviews: rank.topRatedMinReviews,
          risingMinSales: rank.risingMinSales,
          minWalletAgeDays: social.minWalletAgeDays,
          funderWindowDays: social.funderWindowDays,
          weights: {
            buyer: social.weightBuyerBps / 10_000,
            holder: social.weightHolderBps / 10_000,
          },
          holderMinTier: social.holderMinTier,
          recomputeMinutes: rank.recomputeMinutes,
        },
      }),
    );
  });

  api.get('/activity', async (c) => {
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 24));
    const sponsored = await featuredToday(deps, 'band', null);
    const cards = sponsored.length
      ? await deps.sql<Row[]>`
          select id, title, slug, category::text as category from listings
          where id in ${deps.sql(sponsored.map((s) => s.listingId))}
        `
      : [];
    return c.json(
      jsonSafe({
        events: await activityFeed(deps, limit),
        // Paid "band" slots for today, in hourly rotation; always labelled as sponsored.
        sponsored: sponsored.flatMap((s) => {
          const card = cards.find((row) => row.id === s.listingId);
          return card
            ? [
                {
                  bookingId: s.bookingId,
                  listing: { title: card.title, slug: card.slug, category: card.category },
                },
              ]
            : [];
        }),
      }),
    );
  });
}
