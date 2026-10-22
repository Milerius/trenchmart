import type { Hono } from 'hono';
import {
  cleanReviewText,
  jsonSafe,
  ratingSummary,
  replyBody,
  replyTextProblem,
  reviewMessage,
  reviewPostBody,
  reviewReportBody,
  reviewTextProblem,
  reviewVoteBody,
  verifySiwsSignature,
  WEIGHT_REASON_TEXT,
  weightLabel,
} from '@trenchmart/shared';
import { z } from 'zod';
import { audit, HttpError, sha256Hex, type Deps } from './logic';
import {
  adminOnly,
  identityColumns,
  identityRow,
  loadSocialConfig,
  parseBody,
  requestIntel,
  signedIn,
  tallyReviewVotes,
  voterWeight,
  type Row,
  type SocialVars,
} from './social';

/**
 * Verified-buyer reviews: one per released order, signed by the buying wallet, tagged with a
 * version that wallet downloaded. Creators reply once (editable), never hide. Helpful votes and
 * reports are weighted (buyer 1.0×, $MART holder 0.5×, everyone else 0×).
 */

const SORTS = ['helpful', 'newest', 'lowest', 'highest'] as const;
const FILTERS = ['all', '5', 'critical', 'replied', 'current'] as const;

const moderateBody = z.object({
  action: z.enum(['hide', 'restore']),
  reason: z.string().max(200).optional(),
});

async function textSha(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

/** Visible reviews drive the listing's rating; hidden ones never count. */
export async function recomputeListingRating(deps: Deps, listingId: string): Promise<void> {
  await deps.sql`
    update listings set
      rating_count = (select count(*) from listing_reviews where listing_id = ${listingId} and hidden_at is null),
      rating_avg = (select round(avg(rating), 2) from listing_reviews where listing_id = ${listingId} and hidden_at is null)
    where id = ${listingId}
  `;
}

async function reviewForOrder(deps: Deps, orderId: string, userId: string) {
  const rows = await deps.sql<Row[]>`
    select o.*, l.creator_id, l.title, l.slug, l.terminals, l.live_version_id
    from orders o join listings l on l.id = o.listing_id
    where o.id = ${orderId} and o.buyer_id = ${userId}
  `;
  const order = rows[0];
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  return order;
}

/** Versions this order downloaded; the purchased version when it never downloaded. */
async function reviewableVersions(deps: Deps, order: Row) {
  const rows = await deps.sql<Row[]>`
    select v.id, v.semver, max(d.created_at) as downloaded_at
    from downloads d join versions v on v.id = d.version_id
    where d.order_id = ${order.id}
    group by v.id, v.semver order by max(d.created_at) desc
  `;
  if (rows.length) return rows;
  return deps.sql<
    Row[]
  >`select id, semver, null as downloaded_at from versions where id = ${order.version_id}`;
}

function assertReviewable(order: Row, userId: string) {
  if (order.status !== 'released')
    throw new HttpError(
      400,
      'NOT_RELEASED',
      order.status === 'paid'
        ? 'Reviews open when escrow releases.'
        : 'Only released orders can be reviewed.',
    );
  if (order.creator_id === userId)
    throw new HttpError(403, 'OWN_LISTING', 'Creators cannot review their own listings.');
}

export function registerReviewRoutes(api: Hono<SocialVars>, deps: Deps): void {
  api.get('/listings/:slug/reviews', async (c) => {
    const sort = (SORTS as readonly string[]).includes(c.req.query('sort') ?? '')
      ? (c.req.query('sort') as (typeof SORTS)[number])
      : 'helpful';
    const filter = (FILTERS as readonly string[]).includes(c.req.query('filter') ?? '')
      ? (c.req.query('filter') as (typeof FILTERS)[number])
      : 'all';
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 10));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const listings = await deps.sql<Row[]>`
      select id, creator_id, live_version_id from listings where slug = ${c.req.param('slug')}
    `;
    const listing = listings[0];
    if (!listing) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
    const viewer = c.get('user');
    const all = await deps.sql<Row[]>`
      select r.id, r.rating, r.version_id, v.semver, r.hidden_at, (rr.review_id is not null) as replied
      from listing_reviews r
      left join versions v on v.id = r.version_id
      left join review_replies rr on rr.review_id = r.id
      where r.listing_id = ${listing.id}
    `;
    const visible = all.filter((r) => !r.hidden_at);
    const summary = ratingSummary(visible.map((r) => r.rating as number));
    const versions = new Map<string, { semver: string; ratings: number[]; current: boolean }>();
    for (const r of visible) {
      if (!r.semver) continue;
      const entry = versions.get(r.semver as string) ?? {
        semver: r.semver as string,
        ratings: [],
        current: r.version_id === listing.live_version_id,
      };
      entry.ratings.push(r.rating as number);
      versions.set(r.semver as string, entry);
    }
    const counts = {
      all: visible.length,
      '5': visible.filter((r) => r.rating === 5).length,
      critical: visible.filter((r) => (r.rating as number) <= 3).length,
      replied: visible.filter((r) => r.replied).length,
      current: visible.filter((r) => r.version_id === listing.live_version_id).length,
    };
    const order =
      sort === 'newest'
        ? deps.sql`r.created_at desc`
        : sort === 'lowest'
          ? deps.sql`r.rating asc, r.created_at desc`
          : sort === 'highest'
            ? deps.sql`r.rating desc, r.created_at desc`
            : deps.sql`r.helpful_weight desc, r.helpful_count desc, r.created_at desc`;
    const where =
      filter === '5'
        ? deps.sql`and r.rating = 5`
        : filter === 'critical'
          ? deps.sql`and r.rating <= 3`
          : filter === 'replied'
            ? deps.sql`and rr.review_id is not null`
            : filter === 'current'
              ? deps.sql`and r.version_id = ${listing.live_version_id}`
              : deps.sql``;
    const rows = await deps.sql<Row[]>`
      select r.*, v.semver, o.released_at,
        ${deps.sql.unsafe(identityColumns('u', 'u_'))},
        rr.body as reply_body, rr.created_at as reply_created_at, rr.edited_at as reply_edited_at,
        ${deps.sql.unsafe(identityColumns('cu', 'c_'))}
      from listing_reviews r
      join orders o on o.id = r.order_id
      join users u on u.id = o.buyer_id
      left join versions v on v.id = r.version_id
      left join review_replies rr on rr.review_id = r.id
      left join users cu on cu.id = rr.creator_id
      where r.listing_id = ${listing.id} and r.hidden_at is null ${where}
      order by ${order}
      limit ${limit} offset ${offset}
    `;
    const config = await loadSocialConfig(deps);
    const votes = new Map<string, boolean>();
    if (viewer && rows.length) {
      const mine = await deps.sql<Row[]>`
        select review_id, helpful from review_votes
        where user_id = ${viewer.id} and review_id in ${deps.sql(rows.map((r) => r.id as string))}
      `;
      for (const v of mine) votes.set(v.review_id as string, v.helpful as boolean);
    }
    let eligibleOrderId: string | null = null;
    let ownReviewId: string | null = null;
    if (viewer) {
      const own = await deps.sql<Row[]>`
        select o.id, o.status, r.id as review_id from orders o
        left join listing_reviews r on r.order_id = o.id
        where o.buyer_id = ${viewer.id} and o.listing_id = ${listing.id}
        order by o.created_at desc
      `;
      ownReviewId = (own.find((o) => o.review_id)?.review_id as string | undefined) ?? null;
      if (listing.creator_id !== viewer.id)
        eligibleOrderId =
          (own.find((o) => o.status === 'released' && !o.review_id)?.id as string | undefined) ??
          null;
    }
    const editMs = config.reviewEditDays * 86_400_000;
    return c.json(
      jsonSafe({
        summary: {
          ...summary,
          hidden: all.length - visible.length,
          byVersion: [...versions.values()]
            .map((v) => ({
              semver: v.semver,
              current: v.current,
              ...(({ count, avg }) => ({ count, avg }))(ratingSummary(v.ratings)),
            }))
            .sort((a, b) => b.semver.localeCompare(a.semver, undefined, { numeric: true })),
        },
        counts,
        sort,
        filter,
        offset,
        reviews: rows.map((r) => ({
          id: r.id,
          rating: r.rating,
          body: r.body,
          terminal: r.terminal ?? null,
          createdAt: r.created_at,
          editedAt: r.edited_at ?? null,
          version: r.semver
            ? { semver: r.semver, current: r.version_id === listing.live_version_id }
            : null,
          reviewer: identityRow(r, 'u_'),
          order: { ref: `TM-${(r.order_id as string).slice(0, 8)}`, releasedAt: r.released_at },
          helpful: {
            count: r.helpful_count,
            unhelpful: r.unhelpful_count,
            score: r.helpful_weight,
          },
          reply: r.reply_body
            ? {
                body: r.reply_body,
                createdAt: r.reply_created_at,
                editedAt: r.reply_edited_at ?? null,
                creator: identityRow(r, 'c_'),
              }
            : null,
          viewer: viewer
            ? {
                vote: votes.has(r.id as string) ? votes.get(r.id as string) : null,
                mine: r.reviewer_id === viewer.id,
                editableUntil:
                  r.reviewer_id === viewer.id
                    ? new Date(new Date(r.created_at as string).getTime() + editMs)
                    : null,
                canReply: listing.creator_id === viewer.id,
              }
            : null,
        })),
        viewer: viewer
          ? {
              eligibleOrderId,
              ownReviewId,
              isCreator: listing.creator_id === viewer.id,
            }
          : null,
      }),
    );
  });

  /** Everything the review form needs: order, versions this wallet downloaded, rules. */
  api.get('/orders/:id/review-form', async (c) => {
    const user = signedIn(c);
    const order = await reviewForOrder(deps, c.req.param('id'), user.id as string);
    const config = await loadSocialConfig(deps);
    const [creator] = await deps.sql<Row[]>`select * from users where id = ${order.creator_id}`;
    const [existing] = await deps.sql<Row[]>`
      select r.*, v.semver from listing_reviews r left join versions v on v.id = r.version_id
      where r.order_id = ${order.id}
    `;
    const versions = await reviewableVersions(deps, order);
    return c.json(
      jsonSafe({
        order: {
          id: order.id,
          ref: `TM-${(order.id as string).slice(0, 8)}`,
          status: order.status,
          releasedAt: order.released_at ?? null,
          escrowUntil: order.escrow_until ?? null,
        },
        listing: { title: order.title, slug: order.slug, terminals: order.terminals ?? [] },
        creator: creator ? identityRow(creator) : null,
        poster: identityRow(user),
        versions: versions.map((v) => ({
          id: v.id,
          semver: v.semver,
          downloadedAt: v.downloaded_at,
        })),
        rules: {
          minChars: config.reviewMinChars,
          maxChars: config.reviewMaxChars,
          editDays: config.reviewEditDays,
        },
        canReview: order.status === 'released' && order.creator_id !== user.id,
        review: existing
          ? {
              id: existing.id,
              rating: existing.rating,
              body: existing.body,
              versionId: existing.version_id,
              semver: existing.semver,
              terminal: existing.terminal ?? null,
              createdAt: existing.created_at,
              editableUntil: new Date(
                new Date(existing.created_at as string).getTime() +
                  config.reviewEditDays * 86_400_000,
              ),
            }
          : null,
      }),
    );
  });

  /** Post (or, within the edit window, update) the review of a released order. */
  api.post('/orders/:id/review', async (c) => {
    const user = signedIn(c);
    const body = await parseBody(reviewPostBody, c);
    const order = await reviewForOrder(deps, c.req.param('id'), user.id as string);
    assertReviewable(order, user.id as string);
    const config = await loadSocialConfig(deps);
    const text = cleanReviewText(body.body);
    const problem = reviewTextProblem(text, config);
    if (problem) throw new HttpError(400, 'REVIEW_TEXT', problem);
    const versions = await reviewableVersions(deps, order);
    const version = versions.find((v) => v.id === body.versionId);
    if (!version) throw new HttpError(400, 'VERSION', 'Pick a version this wallet downloaded.');
    const terminal = body.terminal ? body.terminal.trim() : null;
    if (terminal && !((order.terminals as string[]) ?? []).includes(terminal))
      throw new HttpError(400, 'TERMINAL', 'Pick one of the listing terminals.');
    const message = reviewMessage({
      orderId: order.id as string,
      rating: body.rating,
      semver: version.semver as string,
      bodySha256: await textSha(text),
    });
    if (!verifySiwsSignature(message, body.signature, user.wallet as string))
      throw new HttpError(400, 'BAD_SIGNATURE', 'The wallet signature does not match this review.');
    const [existing] = await deps.sql<Row[]>`
      select id, created_at from listing_reviews where order_id = ${order.id}
    `;
    let id: string;
    if (existing) {
      const until =
        new Date(existing.created_at as string).getTime() + config.reviewEditDays * 86_400_000;
      if (deps.now().getTime() > until)
        throw new HttpError(
          403,
          'EDIT_CLOSED',
          `Reviews can be edited for ${config.reviewEditDays} days.`,
        );
      await deps.sql`
        update listing_reviews set rating = ${body.rating}, body = ${text}, version_id = ${version.id},
          terminal = ${terminal}, signature = ${body.signature}, edited_at = ${deps.now()}
        where id = ${existing.id}
      `;
      id = existing.id as string;
      await audit(deps.sql, user.id as string, 'review', id, 'edited', { rating: body.rating });
    } else {
      const inserted = await deps.sql<{ id: string }[]>`
        insert into listing_reviews (order_id, listing_id, reviewer_id, version_id, rating, body, terminal, signature, created_at)
        values (${order.id}, ${order.listing_id}, ${user.id}, ${version.id}, ${body.rating}, ${text}, ${terminal}, ${body.signature}, ${deps.now()})
        on conflict (order_id) do nothing
        returning id
      `;
      if (!inserted[0])
        throw new HttpError(409, 'ALREADY_REVIEWED', 'This order already has a review.');
      id = inserted[0].id;
      await audit(deps.sql, user.id as string, 'review', id, 'posted', { rating: body.rating });
    }
    await recomputeListingRating(deps, order.listing_id as string);
    await requestIntel(deps, user.wallet as string);
    return c.json({ ok: true, id });
  });

  /** The reviews this wallet wrote, keyed by order (Purchases page). */
  api.get('/me/reviews', async (c) => {
    const user = signedIn(c);
    const config = await loadSocialConfig(deps);
    const rows = await deps.sql<Row[]>`
      select id, order_id, rating, created_at, edited_at, hidden_at from listing_reviews
      where reviewer_id = ${user.id}
    `;
    return c.json(
      jsonSafe(
        rows.map((r) => ({
          id: r.id,
          orderId: r.order_id,
          rating: r.rating,
          createdAt: r.created_at,
          hidden: Boolean(r.hidden_at),
          editableUntil: new Date(
            new Date(r.created_at as string).getTime() + config.reviewEditDays * 86_400_000,
          ),
        })),
      ),
    );
  });

  async function reviewWithListing(id: string) {
    const rows = await deps.sql<Row[]>`
      select r.*, l.creator_id from listing_reviews r join listings l on l.id = r.listing_id
      where r.id = ${id}
    `;
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'review not found');
    return rows[0];
  }

  /** The listing's creator replies once; later calls edit the same reply. */
  api.put('/reviews/:id/reply', async (c) => {
    const user = signedIn(c);
    const body = await parseBody(replyBody, c);
    const review = await reviewWithListing(c.req.param('id'));
    if (review.creator_id !== user.id)
      throw new HttpError(403, 'FORBIDDEN', 'Only the creator of this listing can reply.');
    const text = cleanReviewText(body.body);
    const problem = replyTextProblem(text);
    if (problem) throw new HttpError(400, 'REPLY_TEXT', problem);
    await deps.sql`
      insert into review_replies (review_id, creator_id, body, created_at)
      values (${review.id}, ${user.id}, ${text}, ${deps.now()})
      on conflict (review_id) do update set body = excluded.body, edited_at = ${deps.now()}
    `;
    await audit(deps.sql, user.id as string, 'review', review.id as string, 'replied', {});
    return c.json({ ok: true });
  });

  /** Helpful / not helpful (null removes). Weighted; never on your own review or listing. */
  api.post('/reviews/:id/vote', async (c) => {
    const user = signedIn(c);
    const body = await parseBody(reviewVoteBody, c);
    const review = await reviewWithListing(c.req.param('id'));
    if (review.reviewer_id === user.id)
      throw new HttpError(403, 'OWN_REVIEW', 'You cannot vote on your own review.');
    if (review.creator_id === user.id)
      throw new HttpError(403, 'OWN_LISTING', 'Creators cannot vote on reviews of their listings.');
    const config = await loadSocialConfig(deps);
    if (body.helpful === null) {
      await deps.sql`delete from review_votes where review_id = ${review.id} and user_id = ${user.id}`;
      await tallyReviewVotes(deps, review.id as string);
      return c.json({ ok: true, vote: null });
    }
    const weight = await voterWeight(deps, user, review.creator_id as string, config, {
      refreshTier: true,
    });
    await deps.sql`
      insert into review_votes (review_id, user_id, helpful, weight_bps, created_at)
      values (${review.id}, ${user.id}, ${body.helpful}, ${weight.bps}, ${deps.now()})
      on conflict (review_id, user_id) do update set helpful = excluded.helpful, weight_bps = excluded.weight_bps
    `;
    await tallyReviewVotes(deps, review.id as string);
    await requestIntel(deps, user.wallet as string);
    return c.json({
      ok: true,
      vote: body.helpful,
      weight: {
        bps: weight.bps,
        label: weightLabel(weight.bps),
        reason: WEIGHT_REASON_TEXT[weight.reason],
      },
    });
  });

  /** One report per wallet. Enough counted reports hide the review until an admin decides. */
  api.post('/reviews/:id/report', async (c) => {
    const user = signedIn(c);
    const body = await parseBody(reviewReportBody, c);
    const review = await reviewWithListing(c.req.param('id'));
    if (review.reviewer_id === user.id)
      throw new HttpError(400, 'OWN_REVIEW', 'You cannot report your own review.');
    const config = await loadSocialConfig(deps);
    const weight = await voterWeight(deps, user, review.creator_id as string, config);
    // A creator's report is recorded for the admin but never counts toward auto-hide.
    const counted = review.creator_id === user.id ? 0 : weight.bps;
    await deps.sql`
      insert into review_reports (review_id, user_id, reason, weight_bps, created_at)
      values (${review.id}, ${user.id}, ${body.reason}, ${counted}, ${deps.now()})
      on conflict (review_id, user_id) do nothing
    `;
    const [tally] = await deps.sql<{ n: number }[]>`
      select count(*)::int as n from review_reports
      where review_id = ${review.id} and resolved_at is null and weight_bps > 0
    `;
    if (!review.hidden_at && (tally?.n ?? 0) >= config.reviewAutoHideReports) {
      await deps.sql`
        update listing_reviews set hidden_at = ${deps.now()}, hidden_reason = 'reports' where id = ${review.id}
      `;
      await recomputeListingRating(deps, review.listing_id as string);
      await audit(deps.sql, null, 'review', review.id as string, 'auto_hidden', {
        reports: tally?.n,
      });
    }
    return c.json({ ok: true });
  });

  api.get('/admin/reviews', async (c) => {
    adminOnly(c);
    const rows = await deps.sql<Row[]>`
      select r.id, r.rating, r.body, r.hidden_at, r.hidden_reason, r.created_at, l.title, l.slug,
        count(rp.user_id)::int as reports,
        count(rp.user_id) filter (where rp.weight_bps > 0)::int as counted_reports,
        array_agg(distinct rp.reason) filter (where rp.reason is not null) as reasons
      from listing_reviews r
      join listings l on l.id = r.listing_id
      left join review_reports rp on rp.review_id = r.id and rp.resolved_at is null
      group by r.id, l.title, l.slug
      having count(rp.user_id) > 0 or r.hidden_at is not null
      order by r.hidden_at desc nulls last, count(rp.user_id) desc
      limit 100
    `;
    return c.json(jsonSafe(rows));
  });

  api.post('/admin/reviews/:id/moderate', async (c) => {
    const admin = adminOnly(c);
    const body = await parseBody(moderateBody, c);
    const review = await reviewWithListing(c.req.param('id'));
    if (body.action === 'hide') {
      await deps.sql`
        update listing_reviews set hidden_at = ${deps.now()}, hidden_reason = ${body.reason ?? 'moderation'}
        where id = ${review.id}
      `;
    } else {
      await deps.sql`update listing_reviews set hidden_at = null, hidden_reason = null where id = ${review.id}`;
    }
    // Either way the open reports are settled, so they cannot re-hide a restored review.
    await deps.sql`
      update review_reports set resolved_at = ${deps.now()} where review_id = ${review.id} and resolved_at is null
    `;
    await recomputeListingRating(deps, review.listing_id as string);
    await audit(
      deps.sql,
      admin.id as string,
      'review',
      review.id as string,
      `moderated_${body.action}`,
      {
        reason: body.reason ?? null,
      },
    );
    return c.json({ ok: true });
  });
}
