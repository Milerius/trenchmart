import type { Hono } from 'hono';
import {
  bayesianRating,
  categoryMeta,
  jsonSafe,
  parseRankConfig,
  rankRows,
  WEIGHT_REASON_TEXT,
  weightLabel,
  type RankConfig,
} from '@trenchmart/shared';
import { z } from 'zod';
import { HttpError, type Deps } from './logic';
import {
  loadSocialConfig,
  parseBody,
  requestIntel,
  signedIn,
  voterWeight,
  type Row,
  type SocialVars,
} from './social';

/**
 * Listing upvotes (weighted, capped per wallet per day) and the ranking job that turns counted
 * sales, Bayesian rating and counted upvotes into category and overall ranks, plus the creator
 * leaderboard snapshot. Admin-tunable through the `rank_config` config row.
 */

const upvoteBody = z.object({ up: z.boolean() });
const DAY_MS = 86_400_000;

export async function loadRankConfig(deps: Deps): Promise<RankConfig> {
  const rows = await deps.sql<
    { value: unknown }[]
  >`select value from config where key = 'rank_config'`;
  return parseRankConfig(rows[0]?.value);
}

export async function tallyUpvotes(deps: Deps, listingId: string): Promise<void> {
  await deps.sql`
    update listings l set upvote_count = t.n, upvote_weight = t.w
    from (
      select count(*)::int as n, coalesce(sum(weight_bps), 0)::int as w
      from listing_upvotes where listing_id = ${listingId}
    ) t
    where l.id = ${listingId}
  `;
}

/** Recomputes the stored weight of every upvote cast by this user (wallet-intel cron). */
export async function reweighUpvotesOf(deps: Deps, user: Row): Promise<void> {
  const config = await loadSocialConfig(deps);
  const rows = await deps.sql<Row[]>`
    select u.listing_id, l.creator_id from listing_upvotes u join listings l on l.id = u.listing_id
    where u.user_id = ${user.id}
  `;
  for (const row of rows) {
    const weight = await voterWeight(deps, user, row.creator_id as string, config);
    await deps.sql`
      update listing_upvotes set weight_bps = ${weight.bps}
      where listing_id = ${row.listing_id} and user_id = ${user.id}
    `;
    await tallyUpvotes(deps, row.listing_id as string);
  }
}

async function listingBySlug(deps: Deps, slug: string) {
  const rows = await deps.sql<Row[]>`
    select id, creator_id, category, upvote_count, upvote_weight, rank_score, rank_category,
      rank_overall, rank_parts, ranked_at, live_version_id, delisted_at
    from listings where slug = ${slug}
  `;
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
  return rows[0];
}

async function upvoteState(deps: Deps, listing: Row, viewer: Row | null) {
  const social = await loadSocialConfig(deps);
  const rank = await loadRankConfig(deps);
  const [mix] = await deps.sql<Row[]>`
    select
      count(*) filter (where weight_bps >= ${social.weightBuyerBps} and weight_bps > 0)::int as buyers,
      count(*) filter (where weight_bps > 0 and weight_bps < ${social.weightBuyerBps})::int as holders,
      count(*) filter (where weight_bps = 0)::int as others
    from listing_upvotes where listing_id = ${listing.id}
  `;
  let mine: Row | null = null;
  let weight: { bps: number; reason: keyof typeof WEIGHT_REASON_TEXT } | null = null;
  let usedToday = 0;
  if (viewer) {
    const rows = await deps.sql<Row[]>`
      select weight_bps, created_at from listing_upvotes
      where listing_id = ${listing.id} and user_id = ${viewer.id}
    `;
    mine = rows[0] ?? null;
    weight = await voterWeight(deps, viewer, listing.creator_id as string, social);
    const [used] = await deps.sql<{ n: number }[]>`
      select count(*)::int as n from listing_upvotes
      where user_id = ${viewer.id} and created_at > ${new Date(deps.now().getTime() - DAY_MS)}
    `;
    usedToday = used?.n ?? 0;
  }
  const label = categoryMeta(listing.category as string).label;
  return {
    count: listing.upvote_count as number,
    counted: Math.round(((listing.upvote_weight as number) / 10_000) * 10) / 10,
    mix: { buyers: mix?.buyers ?? 0, holders: mix?.holders ?? 0, others: mix?.others ?? 0 },
    weights: {
      buyer: weightLabel(social.weightBuyerBps),
      holder: weightLabel(social.weightHolderBps),
      holderMinTier: social.holderMinTier,
    },
    rank:
      listing.rank_parts && listing.ranked_at
        ? {
            category: listing.rank_category ?? null,
            overall: listing.rank_overall ?? null,
            categoryLabel: label,
            score: listing.rank_score === null ? null : Number(listing.rank_score),
            parts: listing.rank_parts,
            rankedAt: listing.ranked_at,
            weights: {
              sales: rank.weightSalesBps / 10_000,
              rating: rank.weightRatingBps / 10_000,
              upvotes: rank.weightUpvotesBps / 10_000,
            },
            windowDays: rank.windowDays,
          }
        : null,
    viewer: viewer
      ? {
          upvoted: Boolean(mine),
          isCreator: listing.creator_id === viewer.id,
          weight: weight
            ? {
                bps: weight.bps,
                label: weightLabel(weight.bps),
                reason: WEIGHT_REASON_TEXT[weight.reason],
              }
            : null,
          usedToday,
          perDay: rank.upvotesPerDay,
        }
      : null,
  };
}

export function registerUpvoteRoutes(api: Hono<SocialVars>, deps: Deps): void {
  api.get('/listings/:slug/upvotes', async (c) => {
    const listing = await listingBySlug(deps, c.req.param('slug'));
    return c.json(jsonSafe(await upvoteState(deps, listing, c.get('user'))));
  });

  /** One upvote per wallet per listing; weighted; capped per wallet per day. */
  api.post('/listings/:slug/upvote', async (c) => {
    const user = signedIn(c);
    const body = await parseBody(upvoteBody, c);
    const listing = await listingBySlug(deps, c.req.param('slug'));
    if (listing.creator_id === user.id)
      throw new HttpError(403, 'OWN_LISTING', 'You cannot upvote your own listing.');
    if (!body.up) {
      await deps.sql`delete from listing_upvotes where listing_id = ${listing.id} and user_id = ${user.id}`;
    } else {
      if (listing.delisted_at || !listing.live_version_id)
        throw new HttpError(400, 'NOT_LIVE', 'Only live listings can be upvoted.');
      const rank = await loadRankConfig(deps);
      const [used] = await deps.sql<{ n: number }[]>`
        select count(*)::int as n from listing_upvotes
        where user_id = ${user.id} and created_at > ${new Date(deps.now().getTime() - DAY_MS)}
      `;
      const [already] = await deps.sql`
        select 1 from listing_upvotes where listing_id = ${listing.id} and user_id = ${user.id}
      `;
      if (!already && (used?.n ?? 0) >= rank.upvotesPerDay)
        throw new HttpError(
          429,
          'UPVOTE_LIMIT',
          `You can upvote ${rank.upvotesPerDay} listings a day. Try again tomorrow.`,
        );
      const social = await loadSocialConfig(deps);
      const weight = await voterWeight(deps, user, listing.creator_id as string, social, {
        refreshTier: true,
      });
      await deps.sql`
        insert into listing_upvotes (listing_id, user_id, weight_bps, created_at)
        values (${listing.id}, ${user.id}, ${weight.bps}, ${deps.now()})
        on conflict (listing_id, user_id) do update set weight_bps = excluded.weight_bps
      `;
      await requestIntel(deps, user.wallet as string);
    }
    await tallyUpvotes(deps, listing.id as string);
    const fresh = await listingBySlug(deps, c.req.param('slug'));
    return c.json(jsonSafe(await upvoteState(deps, fresh, user)));
  });
}

/**
 * Ranking job. Counted sales in the window exclude refunds, self-buys, banned buyers, wallets
 * younger than the minimum age at purchase, and wallets the creator funded within the funder
 * window. Listings with too many creator-funded buyers are paused from ranking.
 */
export async function computeRanks(
  deps: Deps,
  options: { force?: boolean } = {},
): Promise<{ ranked: number; listings: number; creators: number } | null> {
  const config = await loadRankConfig(deps);
  const social = await loadSocialConfig(deps);
  const now = deps.now();
  if (!options.force) {
    const [last] = await deps.sql<{ at: Date | null }[]>`select max(ranked_at) as at from listings`;
    if (last?.at && now.getTime() - new Date(last.at).getTime() < config.recomputeMinutes * 60_000)
      return null;
  }
  const since = new Date(now.getTime() - config.windowDays * DAY_MS);
  const funderSince = new Date(now.getTime() - social.funderWindowDays * DAY_MS);
  const minAgeMs = social.minWalletAgeDays * DAY_MS;

  // Recent buyers get their wallets scanned (oldest activity, funders) by the intel step.
  await deps.sql`
    insert into wallet_intel (wallet, requested_at)
    select distinct u.wallet, ${now}::timestamptz from orders o join users u on u.id = o.buyer_id
    where o.status in ('paid', 'released') and o.paid_at > ${since}
    on conflict (wallet) do nothing
  `;

  const rows = await deps.sql<Row[]>`
    with sales as (
      select o.listing_id,
        count(*) filter (where o.buyer_id <> l.creator_id and u.banned_at is null
          and least(u.created_at, coalesce(wi.oldest_seen_at, u.created_at)) <= o.paid_at - ${`${minAgeMs} milliseconds`}::interval
          and not funded.yes)::int as counted,
        count(*) filter (where funded.yes)::int as funded,
        coalesce(sum(o.price) filter (where o.buyer_id <> l.creator_id and not funded.yes), 0)::bigint as volume
      from orders o
      join listings l on l.id = o.listing_id
      join users u on u.id = o.buyer_id
      join users cu on cu.id = l.creator_id
      left join wallet_intel wi on wi.wallet = u.wallet
      cross join lateral (
        select exists (
          select 1 from jsonb_array_elements(coalesce(wi.funders, '[]'::jsonb)) f
          where f->>'wallet' = cu.wallet and (f->>'at')::timestamptz >= ${funderSince}
        ) as yes
      ) funded
      where o.status in ('paid', 'released') and o.paid_at > ${since}
      group by o.listing_id
    ),
    reviews as (
      select listing_id, count(*)::int as n, avg(rating)::float as avg
      from listing_reviews where hidden_at is null group by listing_id
    )
    select l.id, l.category::text as category, l.creator_id, l.rank_overall,
      coalesce(s.counted, 0) as sales, coalesce(s.funded, 0) as funded, coalesce(s.volume, 0) as volume,
      coalesce(r.n, 0) as reviews, r.avg as rating_avg, l.upvote_weight
    from listings l
    left join sales s on s.listing_id = l.id
    left join reviews r on r.listing_id = l.id
    where l.delisted_at is null and l.paused_at is null and l.live_version_id is not null
  `;
  const [site] = await deps.sql<{ avg: number | null }[]>`
    select avg(rating)::float as avg from listing_reviews where hidden_at is null
  `;
  const prior = site?.avg ?? null;
  const ranked = rankRows(
    rows.map((r) => ({
      id: r.id as string,
      group: r.category as string,
      sales: r.sales as number,
      bayes: bayesianRating(
        r.reviews as number,
        (r.rating_avg as number | null) ?? null,
        config.bayesM,
        prior,
      ),
      upvotes: (r.upvote_weight as number) / 10_000,
      paused: (r.funded as number) >= config.washPauseSales,
    })),
    config,
  );
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  for (const r of ranked) {
    const src = byId.get(r.id)!;
    const parts = {
      sales: r.sales,
      bayes: r.bayes,
      upvotes: r.upvotes,
      salesPart: r.salesPart,
      ratingPart: r.ratingPart,
      upvotesPart: r.upvotesPart,
      leader: r.leader,
      reviews: src.reviews,
      paused: r.paused ? 'creator_funded_buyers' : null,
      prior,
    };
    await deps.sql`
      update listings set rank_score = ${r.rankGroup ? r.score : null}, rank_category = ${r.rankGroup},
        rank_overall = ${r.rankOverall}, rank_parts = ${deps.sql.json(parts as never)}, ranked_at = ${now}
      where id = ${r.id}
    `;
  }
  // "Sold this week" is the real 7-day count (it used to only ever increase).
  await deps.sql`
    update listings l set sales_7d = coalesce((
      select count(*)::int from orders o
      where o.listing_id = l.id and o.status in ('paid', 'released') and o.paid_at > ${new Date(now.getTime() - 7 * DAY_MS)}
    ), 0)
  `;

  // Creators: the same parts summed over their live listings.
  const creators = new Map<
    string,
    {
      sales: number;
      volume: bigint;
      reviews: number;
      sum: number;
      upvotes: number;
      listings: number;
    }
  >();
  for (const r of rows) {
    const c = creators.get(r.creator_id as string) ?? {
      sales: 0,
      volume: 0n,
      reviews: 0,
      sum: 0,
      upvotes: 0,
      listings: 0,
    };
    const paused = (r.funded as number) >= config.washPauseSales;
    if (!paused) {
      c.sales += r.sales as number;
      c.volume += BigInt(r.volume as string | number | bigint);
      c.upvotes += (r.upvote_weight as number) / 10_000;
    }
    c.reviews += r.reviews as number;
    c.sum += (r.reviews as number) * ((r.rating_avg as number | null) ?? 0);
    c.listings += 1;
    creators.set(r.creator_id as string, c);
  }
  const creatorRanked = rankRows(
    [...creators].map(([id, c]) => ({
      id,
      group: 'all',
      sales: c.sales,
      bayes: bayesianRating(c.reviews, c.reviews ? c.sum / c.reviews : null, config.bayesM, prior),
      upvotes: c.upvotes,
    })),
    config,
  );
  const previous = new Map(
    (await deps.sql<Row[]>`select creator_id, rank from creator_rank`).map((r) => [
      r.creator_id as string,
      r.rank as number | null,
    ]),
  );
  await deps.sql`delete from creator_rank where creator_id not in ${deps.sql(creatorRanked.length ? creatorRanked.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'])}`;
  for (const r of creatorRanked) {
    const c = creators.get(r.id)!;
    await deps.sql`
      insert into creator_rank (creator_id, rank, prev_rank, score, sales, volume, rating_count, rating_avg, bayes, upvotes, listings, parts, computed_at)
      values (${r.id}, ${r.rankOverall}, ${previous.get(r.id) ?? null}, ${r.score}, ${c.sales}, ${c.volume},
        ${c.reviews}, ${c.reviews ? Math.round((c.sum / c.reviews) * 100) / 100 : null}, ${r.bayes}, ${r.upvotes},
        ${c.listings}, ${deps.sql.json({ salesPart: r.salesPart, ratingPart: r.ratingPart, upvotesPart: r.upvotesPart, leader: r.leader } as never)}, ${now})
      on conflict (creator_id) do update set
        prev_rank = creator_rank.rank, rank = excluded.rank, score = excluded.score, sales = excluded.sales,
        volume = excluded.volume, rating_count = excluded.rating_count, rating_avg = excluded.rating_avg,
        bayes = excluded.bayes, upvotes = excluded.upvotes, listings = excluded.listings,
        parts = excluded.parts, computed_at = excluded.computed_at
    `;
  }
  return {
    ranked: ranked.filter((r) => r.rankOverall).length,
    listings: ranked.length,
    creators: creatorRanked.filter((r) => r.rankOverall).length,
  };
}
