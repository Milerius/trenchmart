import type { Hono } from 'hono';
import { z } from 'zod';
import {
  addDays,
  assessPayment,
  bondToList,
  checkRun,
  dayRange,
  FEATURE_KINDS,
  FEATURE_LABEL,
  featureConfigBody,
  featureMemo,
  featureRefund,
  jsonSafe,
  longestRun,
  parseFeatureConfig,
  quoteFeature,
  releasePayouts,
  rotateHourly,
  submittedBody,
  utcDay,
  type FeatureConfig,
  type FeatureKind,
} from '@trenchmart/shared';
import {
  activeBond,
  audit,
  buildVaultTx,
  HttpError,
  loadConfig,
  tierForWallet,
  type Deps,
} from './logic';
import { adminOnly, parseBody, signedIn, type Row, type SocialVars } from './social';

/**
 * Paid featuring: "Featured · Sponsored" slots on home, category pages and the live activity
 * band, booked by UTC day and paid in SOL to the vault (memo tm:feat:<id>). Featuring never
 * changes a rank. Prices, the $MART tier discount and every rule come from config rows
 * (`feature_slots`, `feature_discount_bps`, `feature_rules`), editable by admins.
 */

export const bookingBody = z.object({
  listingId: z.string().uuid(),
  kind: z.enum(FEATURE_KINDS),
  startDay: z.string(),
  days: z.number().int().min(1).max(31),
});
type BookingInput = z.infer<typeof bookingBody>;

export async function loadFeatureConfig(deps: Deps): Promise<FeatureConfig> {
  const rows = await deps.sql<{ key: string; value: unknown }[]>`
    select key, value from config where key in ('feature_slots', 'feature_discount_bps', 'feature_rules')
  `;
  const get = (key: string) => rows.find((row) => row.key === key)?.value;
  return parseFeatureConfig({
    slots: get('feature_slots'),
    discountBps: get('feature_discount_bps'),
    rules: get('feature_rules'),
  });
}

/** Home and band slots are site-wide; category slots are per category. */
function slotCategory(kind: FeatureKind, category: string): string {
  return kind === 'category' ? category : '';
}

async function bookedByDay(
  deps: Deps,
  kind: FeatureKind,
  category: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const rows = await deps.sql<{ day: string; n: number }[]>`
    select to_char(d.day, 'YYYY-MM-DD') as day, count(*)::int as n
    from feature_days d join feature_bookings b on b.id = d.booking_id
    where d.kind = ${kind} and d.category = ${category} and d.day between ${from} and ${to}
      and (b.status = 'paid' or (b.status = 'pending' and b.hold_until > ${deps.now()}))
    group by d.day
  `;
  return new Map(rows.map((row) => [row.day, row.n]));
}

export async function featureCalendar(deps: Deps, kind: FeatureKind, category: string) {
  const config = await loadFeatureConfig(deps);
  const today = utcDay(deps.now());
  const last = addDays(today, config.rules.maxDaysAhead);
  const cat = slotCategory(kind, category);
  const booked = await bookedByDay(deps, kind, cat, today, last);
  const capacity = config.slots[kind].perDay;
  return {
    kind,
    category: cat || null,
    capacity,
    lamportsPerDay: config.slots[kind].lamportsPerDay,
    days: dayRange(today, config.rules.maxDaysAhead + 1).map((day) => {
      const n = booked.get(day) ?? 0;
      return { day, booked: n, free: Math.max(0, capacity - n) };
    }),
  };
}

export type Problem = { code: string; message: string };

/** The facts behind each eligibility check, shown as the four check tiles in the studio. */
export type FeatureFacts = {
  semver: string | null;
  reviewedAt: Date | null;
  versionLive: boolean;
  openDisputes: number;
  disputes30d: number;
  ratingAvg: number | null;
  ratingCount: number;
  minRatingX10: number;
  bondLamports: bigint;
  bondRequired: bigint;
};

/** Why a listing may not be featured right now (empty when it may), with the facts behind it. */
export async function featureChecks(
  deps: Deps,
  listing: Row,
  creator: Row,
  config: FeatureConfig,
): Promise<{ problems: Problem[]; facts: FeatureFacts }> {
  const problems: Problem[] = [];
  const [version] = listing.live_version_id
    ? await deps.sql<Row[]>`
        select status, semver, created_at from versions where id = ${listing.live_version_id}
      `
    : [];
  if (listing.delisted_at || listing.paused_at || !listing.live_version_id) {
    problems.push({ code: 'NOT_LIVE', message: 'Only live listings can be featured.' });
  } else if (version?.status !== 'live') {
    problems.push({
      code: 'NOT_REVIEWED',
      message: 'The live version must have passed automated review.',
    });
  }
  const since = new Date(deps.now().getTime() - 30 * 86_400_000);
  const [disputes] = await deps.sql<{ open: number; recent: number }[]>`
    select count(*) filter (where d.status = 'open')::int as open,
      count(*) filter (where d.created_at > ${since})::int as recent
    from disputes d join orders o on o.id = d.order_id
    where o.listing_id = ${listing.id}
  `;
  if ((disputes?.open ?? 0) > 0)
    problems.push({
      code: 'OPEN_DISPUTE',
      message: 'Resolve the open dispute on this listing first.',
    });
  const count = Number(listing.rating_count ?? 0);
  const avg = Number(listing.rating_avg ?? 0);
  if (count > 0 && Math.round(avg * 10) < config.rules.minRatingX10)
    problems.push({
      code: 'LOW_RATING',
      message: `Featuring needs a rating of at least ${(config.rules.minRatingX10 / 10).toFixed(1)}.`,
    });
  const appConfig = await loadConfig(deps);
  const tier = (await tierForWallet(deps, creator.wallet as string, appConfig)).tier;
  const required = bondToList(
    [listing.category as string],
    appConfig.bond_lamports_by_category,
    tier,
    appConfig.og_bond_discount_bps,
  );
  const bond = await activeBond(deps.sql, creator.id as string);
  if (bond <= 0n || bond < required)
    problems.push({ code: 'NO_BOND', message: 'Stake your creator bond before featuring.' });
  return {
    problems,
    facts: {
      semver: (version?.semver as string | undefined) ?? null,
      reviewedAt: (version?.created_at as Date | undefined) ?? null,
      versionLive: version?.status === 'live',
      openDisputes: disputes?.open ?? 0,
      disputes30d: disputes?.recent ?? 0,
      ratingAvg: count > 0 ? avg : null,
      ratingCount: count,
      minRatingX10: config.rules.minRatingX10,
      bondLamports: bond,
      bondRequired: required,
    },
  };
}

export async function featureEligibility(
  deps: Deps,
  listing: Row,
  creator: Row,
  config: FeatureConfig,
): Promise<Problem[]> {
  return (await featureChecks(deps, listing, creator, config)).problems;
}

/** Calendar and limit checks for a run; the capacity part runs inside the booking lock. */
async function runProblems(
  deps: Deps,
  sql: Deps['sql'],
  input: BookingInput,
  listing: Row,
  creatorId: string,
  config: FeatureConfig,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  const dateProblem = checkRun({
    start: input.startDay,
    days: input.days,
    now: deps.now(),
    rules: config.rules,
  });
  if (dateProblem) {
    const message = {
      BAD_DATE: 'Pick a valid start day.',
      IN_PAST: 'That day has passed.',
      TOO_LONG: `A run lasts at most ${config.rules.maxConsecutiveDays} days.`,
      TOO_FAR: `Book at most ${config.rules.maxDaysAhead} days ahead.`,
    }[dateProblem];
    return [{ code: dateProblem, message }];
  }
  const capacity = config.slots[input.kind].perDay;
  if (capacity === 0)
    return [{ code: 'SLOT_CLOSED', message: 'This placement is not open for booking.' }];
  const days = dayRange(input.startDay, input.days);
  const last = days.at(-1)!;
  const now = deps.now();
  const cat = slotCategory(input.kind, listing.category as string);
  const full = await sql<{ day: string }[]>`
    select to_char(d.day, 'YYYY-MM-DD') as day
    from feature_days d join feature_bookings b on b.id = d.booking_id
    where d.kind = ${input.kind} and d.category = ${cat} and d.day between ${input.startDay} and ${last}
      and (b.status = 'paid' or (b.status = 'pending' and b.hold_until > ${now}))
    group by d.day having count(*) >= ${capacity}
  `;
  if (full.length)
    problems.push({
      code: 'SOLD_OUT',
      message: `Sold out on ${full.map((row) => row.day).join(', ')}.`,
    });
  const mine = await sql<{ day: string; listing_id: string }[]>`
    select to_char(d.day, 'YYYY-MM-DD') as day, b.listing_id
    from feature_days d join feature_bookings b on b.id = d.booking_id
    where d.kind = ${input.kind} and b.creator_id = ${creatorId}
      and d.day between ${addDays(input.startDay, -config.rules.maxConsecutiveDays)} and ${addDays(last, config.rules.maxConsecutiveDays)}
      and (b.status = 'paid' or (b.status = 'pending' and b.hold_until > ${now}))
  `;
  const sameListing = mine.filter((row) => row.listing_id === listing.id).map((row) => row.day);
  if (sameListing.some((day) => days.includes(day)))
    problems.push({
      code: 'ALREADY_BOOKED',
      message: 'This listing is already booked on some of these days.',
    });
  else if (longestRun(sameListing, days) > config.rules.maxConsecutiveDays)
    problems.push({
      code: 'TOO_LONG',
      message: `Back-to-back runs are limited to ${config.rules.maxConsecutiveDays} days in a row.`,
    });
  if (input.kind === 'home') {
    const perDay = new Map<string, number>();
    for (const row of mine)
      if (days.includes(row.day)) perDay.set(row.day, (perDay.get(row.day) ?? 0) + 1);
    const over = [...perDay]
      .filter(([, n]) => n >= config.rules.homePerCreatorPerDay)
      .map(([day]) => day);
    if (over.length)
      problems.push({
        code: 'HOME_LIMIT',
        message: `One home slot per creator per day (already booked: ${over.join(', ')}).`,
      });
  }
  return problems;
}

async function ownLiveListing(deps: Deps, listingId: string, userId: string): Promise<Row> {
  const [listing] = await deps.sql<Row[]>`
    select * from listings where id = ${listingId} and creator_id = ${userId}
  `;
  if (!listing) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
  return listing;
}

async function quoteFor(deps: Deps, user: Row, input: BookingInput) {
  const config = await loadFeatureConfig(deps);
  const listing = await ownLiveListing(deps, input.listingId, user.id as string);
  const tier = (await tierForWallet(deps, user.wallet as string, await loadConfig(deps))).tier;
  const quote = quoteFeature({ kind: input.kind, days: input.days, tier, config });
  const problems = [
    ...(await featureEligibility(deps, listing, user, config)),
    ...(await runProblems(deps, deps.sql, input, listing, user.id as string, config)),
  ];
  return { config, listing, quote, problems };
}

export async function createBooking(deps: Deps, user: Row, input: BookingInput) {
  const { config, listing, quote, problems } = await quoteFor(deps, user, input);
  if (problems.length) throw new HttpError(409, problems[0]!.code, problems[0]!.message);
  const holdUntil = new Date(deps.now().getTime() + config.rules.holdMinutes * 60_000);
  const cat = slotCategory(input.kind, listing.category as string);
  const days = dayRange(input.startDay, input.days);
  const booking = await deps.sql.begin(async (sql) => {
    // Serialise bookings per placement so two creators cannot take the last slot together.
    await sql`select pg_advisory_xact_lock(hashtext(${`feature:${input.kind}:${cat}`}))`;
    const late = await runProblems(deps, sql as never, input, listing, user.id as string, config);
    if (late.length) throw new HttpError(409, late[0]!.code, late[0]!.message);
    const [row] = await sql<Row[]>`
      insert into feature_bookings (listing_id, creator_id, kind, category, start_day, days, per_day,
        subtotal, tier, discount_bps, total, hold_until)
      values (${listing.id}, ${user.id}, ${input.kind}, ${listing.category}, ${input.startDay}, ${input.days},
        ${quote.perDayLamports}, ${quote.subtotal}, ${quote.tier}, ${quote.discountBps}, ${quote.total}, ${holdUntil})
      returning *
    `;
    for (const day of days) {
      await sql`
        insert into feature_days (booking_id, kind, category, day) values (${row!.id}, ${input.kind}, ${cat}, ${day})
      `;
    }
    return row!;
  });
  await audit(deps.sql, user.id as string, 'feature_booking', booking.id as string, 'created', {
    kind: input.kind,
    startDay: input.startDay,
    days: input.days,
    total: quote.total.toString(),
  });
  const tx = await buildVaultTx(
    deps,
    user.wallet as string,
    quote.total,
    featureMemo(booking.id as string),
  );
  return { booking: bookingView(booking), quote, tx };
}

export async function settleBooking(deps: Deps, user: Row, bookingId: string, txSig: string) {
  const [booking] = await deps.sql<Row[]>`
    select * from feature_bookings where id = ${bookingId} and creator_id = ${user.id}
  `;
  if (!booking) throw new HttpError(404, 'NOT_FOUND', 'booking not found');
  if (booking.tx_sig === txSig) return bookingView(booking);
  // A hold released before its payment landed still settles, as a full refund.
  const settleable = (row: Row) =>
    row.status === 'pending' ||
    row.status === 'expired' ||
    (row.status === 'cancelled' && row.tx_sig == null);
  if (!settleable(booking))
    throw new HttpError(409, 'NOT_PENDING', 'this booking is not waiting for payment');
  const tx = await deps.getTx(txSig);
  if (!tx) throw new HttpError(400, 'TX_NOT_FOUND', 'transaction not found');
  const assessment = assessPayment({
    status: 'pending',
    expectedLamports: booking.total as bigint,
    expectedMemo: featureMemo(booking.id as string),
    expectedSource: user.wallet as string,
    expectedDestination: deps.env.vaultAddress,
    transfers: tx.transfers,
    memos: tx.memos,
    expiresAt: booking.hold_until as Date,
    blockTimeMs: tx.blockTime === null ? null : tx.blockTime * 1000,
    txErr: tx.err != null,
    now: deps.now(),
  });
  if (!assessment.ok) throw new HttpError(400, assessment.code, assessment.message);
  const paidAt = new Date((tx.blockTime ?? Math.floor(deps.now().getTime() / 1000)) * 1000);
  const config = await loadFeatureConfig(deps);
  const result = await deps.sql.begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`feature:${booking.kind}:${slotCategory(booking.kind, booking.category)}`}))`;
    const [fresh] = await sql<
      Row[]
    >`select * from feature_bookings where id = ${bookingId} for update`;
    if (!fresh || !settleable(fresh))
      throw new HttpError(409, 'NOT_PENDING', 'this booking is not waiting for payment');
    const releasedFirst = fresh.status === 'cancelled';
    const lapsed =
      fresh.status === 'expired' || (fresh.hold_until as Date).getTime() <= deps.now().getTime();
    let slotLost = releasedFirst;
    const cat = slotCategory(fresh.kind as FeatureKind, fresh.category as string);
    const days = dayRange(utcDay(fresh.start_day as Date), fresh.days as number);
    if (!releasedFirst && lapsed) {
      // Paid after the hold lapsed: other bookings may have taken the days since. Keep the run
      // only if every day still has room (counting other bookings only), else refund in full.
      const full = await sql<Row[]>`
        select d.day from feature_days d join feature_bookings b on b.id = d.booking_id
        where d.kind = ${fresh.kind} and d.category = ${cat}
          and d.day in ${sql(days)}
          and b.id <> ${bookingId}
          and (b.status = 'paid' or (b.status = 'pending' and b.hold_until > ${deps.now()}))
        group by d.day having count(*) >= ${config.slots[fresh.kind as FeatureKind].perDay}
      `;
      slotLost = full.length > 0;
    }
    const [row] = await sql<Row[]>`
      update feature_bookings set
        status = ${slotLost ? 'cancelled' : 'paid'}, tx_sig = ${txSig}, paid_at = ${paidAt},
        refund_lamports = ${slotLost ? fresh.total : 0},
        refund_reason = ${releasedFirst ? 'released_before_payment' : slotLost ? 'slot_taken' : null},
        closed_at = ${slotLost ? (fresh.closed_at ?? deps.now()) : null}
      where id = ${bookingId} returning *
    `;
    await sql`
      insert into ledger (account, delta, ref_type, ref_id) values ('vault', ${fresh.total}, 'feature', ${bookingId})
    `;
    if (slotLost) {
      await sql`delete from feature_days where booking_id = ${bookingId}`;
      await sql`
        insert into payouts (order_id, recipient, bucket, amount, feature_booking_id)
        values (null, ${user.wallet}, 'refund', ${fresh.total}, ${bookingId})
      `;
    } else {
      // Maintenance drops the days of a lapsed hold; restore them for the paid run.
      for (const day of days)
        await sql`
          insert into feature_days (booking_id, kind, category, day)
          values (${bookingId}, ${fresh.kind}, ${cat}, ${day})
          on conflict (booking_id, day) do nothing
        `;
    }
    return row!;
  });
  await audit(
    deps.sql,
    user.id as string,
    'feature_booking',
    bookingId,
    result.status === 'paid' ? 'paid' : 'refunded',
    {
      txSig,
    },
  );
  return bookingView(result);
}

export async function cancelBooking(deps: Deps, user: Row, bookingId: string) {
  const config = await loadFeatureConfig(deps);
  const result = await deps.sql.begin(async (sql) => {
    const [booking] = await sql<Row[]>`
      select b.*, u.wallet from feature_bookings b join users u on u.id = b.creator_id
      where b.id = ${bookingId} and b.creator_id = ${user.id} for update
    `;
    if (!booking) throw new HttpError(404, 'NOT_FOUND', 'booking not found');
    if (booking.status === 'pending') {
      await sql`delete from feature_days where booking_id = ${bookingId}`;
      const [row] = await sql<Row[]>`
        update feature_bookings set status = 'cancelled', closed_at = ${deps.now()} where id = ${bookingId} returning *
      `;
      return row!;
    }
    if (booking.status !== 'paid')
      throw new HttpError(409, 'NOT_CANCELLABLE', 'this booking is closed');
    const start = utcDay(booking.start_day as Date);
    const refund = featureRefund({
      reason: 'cancel',
      start,
      days: booking.days as number,
      total: booking.total as bigint,
      now: deps.now(),
      cancelHours: config.rules.cancelHours,
    });
    if (refund === 0n)
      throw new HttpError(
        409,
        'TOO_LATE',
        `Cancel at least ${config.rules.cancelHours} hours before the start for a full refund.`,
      );
    await sql`delete from feature_days where booking_id = ${bookingId}`;
    const [row] = await sql<Row[]>`
      update feature_bookings set status = 'cancelled', refund_lamports = ${refund}, refund_reason = 'cancelled',
        closed_at = ${deps.now()}
      where id = ${bookingId} returning *
    `;
    await sql`
      insert into payouts (order_id, recipient, bucket, amount, feature_booking_id)
      values (null, ${booking.wallet}, 'refund', ${refund}, ${bookingId})
    `;
    return row!;
  });
  await audit(deps.sql, user.id as string, 'feature_booking', bookingId, 'cancelled', {
    refund: String(result.refund_lamports),
  });
  return bookingView(result);
}

/**
 * Cron: lapse unpaid holds, refund the unserved days of runs whose listing was pulled, and settle
 * finished runs into the fee buckets (like the platform fee).
 */
export async function featureMaintenance(deps: Deps) {
  const now = deps.now();
  const today = utcDay(now);
  const expired = await deps.sql<Row[]>`
    update feature_bookings set status = 'expired', closed_at = ${now}
    where status = 'pending' and hold_until <= ${now} returning id
  `;
  if (expired.length)
    await deps.sql`delete from feature_days where booking_id in ${deps.sql(expired.map((row) => row.id as string))}`;

  const config = await loadFeatureConfig(deps);
  const pulled = await deps.sql<Row[]>`
    select b.*, u.wallet from feature_bookings b
    join listings l on l.id = b.listing_id join users u on u.id = b.creator_id
    where b.status = 'paid' and b.start_day + b.days > ${today}::date
      and (l.delisted_at is not null or l.paused_at is not null or l.live_version_id is null)
  `;
  for (const booking of pulled) {
    const refund = featureRefund({
      reason: 'pulled',
      start: utcDay(booking.start_day as Date),
      days: booking.days as number,
      total: booking.total as bigint,
      now,
      cancelHours: config.rules.cancelHours,
    });
    const claimed = await deps.sql.begin(async (sql) => {
      // Compare-and-set: a concurrent run or a creator cancel may have closed it already.
      const [won] = await sql<Row[]>`
        update feature_bookings set status = 'pulled', refund_lamports = ${refund}, refund_reason = 'listing_pulled',
          closed_at = ${now}
        where id = ${booking.id} and status = 'paid'
        returning id
      `;
      if (!won) return false;
      await sql`delete from feature_days where booking_id = ${booking.id} and day > ${today}::date`;
      if (now.getTime() < Date.parse(`${utcDay(booking.start_day as Date)}T00:00:00Z`))
        await sql`delete from feature_days where booking_id = ${booking.id}`;
      if (refund > 0n)
        await sql`
          insert into payouts (order_id, recipient, bucket, amount, feature_booking_id)
          values (null, ${booking.wallet}, 'refund', ${refund}, ${booking.id})
        `;
      return true;
    });
    if (!claimed) continue;
    await audit(deps.sql, null, 'feature_booking', booking.id as string, 'pulled', {
      refund: refund.toString(),
    });
  }

  const appConfig = await loadConfig(deps);
  const done = await deps.sql<Row[]>`
    select * from feature_bookings
    where (status = 'paid' and start_day + days <= ${today}::date)
       or (status = 'pulled' and closed_at is not null and total > refund_lamports
           and not exists (select 1 from payouts p where p.feature_booking_id = feature_bookings.id and p.bucket <> 'refund'))
  `;
  let settled = 0;
  for (const booking of done) {
    const kept = (booking.total as bigint) - (booking.refund_lamports as bigint);
    const lines = releasePayouts({
      price: 0n,
      netFee: kept,
      splitBps: appConfig.fee_split_bps,
      creatorWallet: '',
      buckets: deps.env.buckets,
    });
    const wrote = await deps.sql.begin(async (sql) => {
      // Claim the booking first so overlapping runs never pay its buckets twice.
      if (booking.status === 'paid') {
        const [won] = await sql<Row[]>`
          update feature_bookings set status = 'completed', closed_at = ${now}
          where id = ${booking.id} and status = 'paid' returning id
        `;
        if (!won) return false;
      } else {
        await sql`select id from feature_bookings where id = ${booking.id} for update`;
        const [paid] = await sql<Row[]>`
          select 1 from payouts where feature_booking_id = ${booking.id} and bucket <> 'refund' limit 1
        `;
        if (paid) return false;
      }
      for (const line of lines)
        await sql`
          insert into payouts (order_id, recipient, bucket, amount, feature_booking_id)
          values (null, ${line.recipient}, ${line.bucket}, ${line.amount}, ${booking.id})
        `;
      return true;
    });
    if (!wrote) continue;
    settled += 1;
  }
  return { expired: expired.length, pulled: pulled.length, settled };
}

/** Listings featured today in a placement, in hourly rotation order. */
export async function featuredToday(
  deps: Deps,
  kind: FeatureKind,
  category: string | null,
): Promise<{ bookingId: string; listingId: string }[]> {
  const today = utcDay(deps.now());
  const rows = await deps.sql<Row[]>`
    select b.id, b.listing_id from feature_days d
    join feature_bookings b on b.id = d.booking_id
    join listings l on l.id = b.listing_id
    where d.kind = ${kind} and d.day = ${today}::date and d.category = ${slotCategory(kind, category ?? '')}
      and b.status = 'paid'
      and l.delisted_at is null and l.paused_at is null and l.live_version_id is not null
    order by b.paid_at asc, b.id asc
  `;
  return rotateHourly(
    rows.map((row) => ({ bookingId: row.id as string, listingId: row.listing_id as string })),
    deps.now(),
  );
}

function bookingView(row: Row) {
  return {
    id: row.id,
    listingId: row.listing_id,
    kind: row.kind,
    category: row.category,
    startDay: row.start_day instanceof Date ? utcDay(row.start_day) : row.start_day,
    days: row.days,
    perDay: row.per_day,
    subtotal: row.subtotal,
    tier: row.tier,
    discountBps: row.discount_bps,
    total: row.total,
    status: row.status,
    holdUntil: row.hold_until,
    txSig: row.tx_sig ?? null,
    paidAt: row.paid_at ?? null,
    refundLamports: row.refund_lamports ?? 0n,
    refundReason: row.refund_reason ?? null,
    title: row.title,
    slug: row.slug,
  };
}

function configView(config: FeatureConfig) {
  return {
    slots: Object.fromEntries(
      FEATURE_KINDS.map((kind) => [kind, { ...config.slots[kind], label: FEATURE_LABEL[kind] }]),
    ),
    discountBps: config.discountBps,
    rules: config.rules,
  };
}

/** Listing cards as the marketplace renders them (live listings only). */
export type CardsFor = (ids: string[]) => Promise<Record<string, unknown>[]>;

export function registerFeaturingRoutes(
  api: Hono<SocialVars>,
  deps: Deps,
  cardsFor: CardsFor = async () => [],
): void {
  api.get('/featuring/config', async (c) =>
    c.json(jsonSafe(configView(await loadFeatureConfig(deps)))),
  );

  api.get('/featuring/calendar', async (c) => {
    const kind = (FEATURE_KINDS as readonly string[]).includes(c.req.query('kind') ?? '')
      ? (c.req.query('kind') as FeatureKind)
      : 'home';
    return c.json(jsonSafe(await featureCalendar(deps, kind, c.req.query('category') ?? '')));
  });

  api.get('/studio/featuring', async (c) => {
    const user = signedIn(c);
    const config = await loadFeatureConfig(deps);
    const tier = (await tierForWallet(deps, user.wallet as string, await loadConfig(deps))).tier;
    const listings = await deps.sql<Row[]>`
      select * from listings where creator_id = ${user.id} and delisted_at is null
      order by created_at desc
    `;
    const cards = listings.length ? await cardsFor(listings.map((l) => l.id as string)) : [];
    const withEligibility = [];
    for (const listing of listings) {
      const checks = await featureChecks(deps, listing, user, config);
      withEligibility.push({
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        category: listing.category,
        price: listing.price,
        problems: checks.problems,
        facts: checks.facts,
        card: cards.find((card) => card.id === listing.id) ?? null,
      });
    }
    const bookings = await deps.sql<Row[]>`
      select b.*, l.title, l.slug from feature_bookings b join listings l on l.id = b.listing_id
      where b.creator_id = ${user.id} and b.status <> 'expired'
      order by b.start_day desc, b.created_at desc limit 50
    `;
    return c.json(
      jsonSafe({
        tier,
        config: configView(config),
        listings: withEligibility,
        bookings: bookings.map(bookingView),
      }),
    );
  });

  api.post('/studio/featuring/quote', async (c) => {
    const user = signedIn(c);
    const input = await parseBody(bookingBody, c);
    const { quote, problems } = await quoteFor(deps, user, input);
    return c.json(jsonSafe({ quote, problems }));
  });

  api.post('/studio/featuring/bookings', async (c) => {
    const user = signedIn(c);
    const input = await parseBody(bookingBody, c);
    return c.json(jsonSafe(await createBooking(deps, user, input)));
  });

  api.post('/studio/featuring/bookings/:id/submitted', async (c) => {
    const user = signedIn(c);
    const body = await parseBody(submittedBody, c);
    return c.json(jsonSafe(await settleBooking(deps, user, c.req.param('id'), body.txSig)));
  });

  api.post('/studio/featuring/bookings/:id/cancel', async (c) => {
    const user = signedIn(c);
    return c.json(jsonSafe(await cancelBooking(deps, user, c.req.param('id'))));
  });

  api.put('/admin/featuring/config', async (c) => {
    const admin = adminOnly(c);
    const body = await parseBody(featureConfigBody, c);
    // One transaction: the three rows change together or not at all.
    await deps.sql.begin(async (sql) => {
      for (const [key, value] of [
        ['feature_slots', body.slots],
        ['feature_discount_bps', body.discountBps],
        ['feature_rules', body.rules],
      ] as const) {
        await sql`
          insert into config (key, value) values (${key}, ${sql.json(value as never)})
          on conflict (key) do update set value = excluded.value
        `;
      }
    });
    await audit(deps.sql, admin.id as string, 'config', admin.id as string, 'config_put', {
      keys: ['feature_slots', 'feature_discount_bps', 'feature_rules'],
    });
    return c.json(jsonSafe(configView(await loadFeatureConfig(deps))));
  });

  api.get('/admin/featuring', async (c) => {
    adminOnly(c);
    const config = await loadFeatureConfig(deps);
    const bookings = await deps.sql<Row[]>`
      select b.*, l.title, l.slug from feature_bookings b join listings l on l.id = b.listing_id
      where b.status <> 'expired' order by b.created_at desc limit 100
    `;
    const [totals] = await deps.sql<Row[]>`
      select
        coalesce(sum(total) filter (where status in ('paid', 'completed', 'pulled', 'cancelled') and tx_sig is not null), 0)::bigint as received,
        coalesce(sum(refund_lamports), 0)::bigint as refunded,
        count(*) filter (where status = 'paid')::int as active
      from feature_bookings
    `;
    return c.json(
      jsonSafe({ config: configView(config), bookings: bookings.map(bookingView), totals }),
    );
  });
}
