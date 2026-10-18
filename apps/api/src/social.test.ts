import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { cleanReviewText, reviewMessage } from '@trenchmart/shared';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import { sha256Hex, type Deps } from './logic';
import { scanWalletIntel } from './social';
import { computeRanks } from './ranking';

/** Integration: verified-buyer reviews, creator replies, weighted helpful votes, reports. */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const now = new Date('2026-06-01T00:00:00.000Z');
const longAgo = new Date('2026-01-01T00:00:00.000Z');
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
const vault = randomKeypair();
const REVIEW =
  'Fires on the first Raydium candle and the ladder exits worked exactly as described in the docs.';

let sql: Sql;
let lastDeps: Deps;
type App = ReturnType<typeof createApp>;
type Wallet = { publicKey: string; secretKey: Uint8Array };

function keypair(): Wallet {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

async function appFor(extraDeps: Partial<Deps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tm-blob-'));
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: vault.publicKey,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    AI_ATTEST_SECRET: 'attest-secret',
    INTERNAL_TOKEN: 'internal',
    SOL_USD_OVERRIDE: '100',
    LANDING_STATS: 'auto',
    RATE_LIMIT_PER_MIN: '1000',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:8787',
  });
  lastDeps = {
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    ...extraDeps,
  };
  return createApp(lastDeps);
}

async function login(app: App, wallet: Wallet): Promise<string> {
  const nonce = await app.request('/api/v1/auth/nonce', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey }),
  });
  const issued = (await nonce.json()) as { message: string };
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(issued.message), wallet.secretKey),
  );
  const verified = await app.request('/api/v1/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey, signature }),
  });
  expect(verified.status).toBe(200);
  return verified.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** A user row aged past the 7-day minimum (or brand new), then signed in. */
async function user(app: App, opts: { createdAt?: Date; roles?: string[] } = {}) {
  const wallet = keypair();
  const [row] = await sql<{ id: string }[]>`
    insert into users (wallet, roles, created_at)
    values (${wallet.publicKey}, ${sql.array(opts.roles ?? ['buyer'])}::user_role[], ${opts.createdAt ?? longAgo})
    returning id
  `;
  return { wallet, id: row!.id, cookie: await login(app, wallet) };
}

async function listing(creatorId: string, slug: string) {
  const listingId = randomUUID();
  const versionId = randomUUID();
  await sql`
    insert into listings (id, creator_id, slug, title, summary, description, category, price, terminals)
    values (${listingId}, ${creatorId}, ${slug}, ${'Pack ' + slug}, 'Sum', 'Desc', 'userscript', ${1_000_000_000n}, ${sql.array(['Axiom', 'Photon'])})
  `;
  await sql`
    insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
    values (${versionId}, ${listingId}, '1.0.0', 'pack.user.js', 5, 'abc', 'blobs/abc', 'live')
  `;
  await sql`update listings set live_version_id = ${versionId}, first_live_at = ${now} where id = ${listingId}`;
  return { listingId, versionId, slug };
}

async function order(
  buyerId: string,
  l: { listingId: string; versionId: string },
  status = 'released',
) {
  const id = randomUUID();
  await sql`
    insert into orders (
      id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
      tier_at_purchase, memo, status, paid_at, escrow_until, expires_at, released_at
    ) values (
      ${id}, ${buyerId}, ${l.listingId}, ${l.versionId}, ${1_000_000_000n}, 500, 0, 0, 0, ${1_000_000_000n},
      'none', ${'tm:' + id.slice(0, 8)}, ${status}, ${now}, ${now}, ${now}, ${status === 'released' ? now : null}
    )
  `;
  return id;
}

async function signReview(
  wallet: Wallet,
  orderId: string,
  rating: number,
  body: string,
  semver = '1.0.0',
) {
  const message = reviewMessage({
    orderId,
    rating,
    semver,
    bodySha256: await sha256Hex(new TextEncoder().encode(cleanReviewText(body))),
  });
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey));
}

async function call(app: App, cookie: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function postReview(
  app: App,
  who: { wallet: Wallet; cookie: string },
  orderId: string,
  versionId: string,
  rating = 5,
  body = REVIEW,
) {
  return call(app, who.cookie, 'POST', `/orders/${orderId}/review`, {
    rating,
    body,
    versionId,
    terminal: 'Axiom',
    signature: await signReview(who.wallet, orderId, rating, body),
  });
}

afterAll(async () => {
  await sql?.end();
});

describe('social: reviews', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, review_replies,
        review_votes, review_reports, wallet_intel, listing_upvotes, creator_rank, disputes, licenses, payouts, orders, versions,
        listings, auth_nonces, users
      restart identity cascade
    `;
  });

  it('accepts one signed review per released order from its buyer, and updates the rating', async () => {
    const app = await appFor();
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const buyer = await user(app);
    const l = await listing(creator.id, 'sniper');
    const paid = await order(buyer.id, l, 'paid');
    const early = await postReview(app, buyer, paid, l.versionId);
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('NOT_RELEASED');

    const released = await order(buyer.id, l);
    const forged = await call(app, buyer.cookie, 'POST', `/orders/${released}/review`, {
      rating: 5,
      body: REVIEW,
      versionId: l.versionId,
      signature: await signReview(buyer.wallet, released, 4, REVIEW),
    });
    expect(forged.body.error.code).toBe('BAD_SIGNATURE');

    const linky = await postReview(
      app,
      buyer,
      released,
      l.versionId,
      5,
      `${REVIEW} https://t.me/x`,
    );
    expect(linky.status).toBe(400);
    expect(linky.body.error.code).toBe('REVIEW_TEXT');

    const ok = await postReview(app, buyer, released, l.versionId, 4);
    expect(ok.status).toBe(200);
    const [row] =
      await sql`select rating_count, rating_avg from listings where id = ${l.listingId}`;
    expect(row).toMatchObject({ rating_count: 1 });
    expect(Number(row!.rating_avg)).toBe(4);

    // Re-posting within the edit window edits the same review.
    const edit = await postReview(app, buyer, released, l.versionId, 5);
    expect(edit.body.id).toBe(ok.body.id);
    const [edited] =
      await sql`select rating, edited_at from listing_reviews where id = ${ok.body.id}`;
    expect(edited!.rating).toBe(5);
    expect(edited!.edited_at).not.toBeNull();

    const form = await call(app, buyer.cookie, 'GET', `/orders/${released}/review-form`);
    expect(form.body.canReview).toBe(true);
    expect(form.body.versions.map((v: { semver: string }) => v.semver)).toEqual(['1.0.0']);
    expect(form.body.review.rating).toBe(5);

    const page = await call(app, buyer.cookie, 'GET', `/listings/${l.slug}/reviews`);
    expect(page.body.summary).toMatchObject({ count: 1, avg: 5, hidden: 0 });
    expect(page.body.reviews[0]).toMatchObject({
      rating: 5,
      terminal: 'Axiom',
      version: { semver: '1.0.0', current: true },
      reviewer: { kind: 'wallet', wallet: buyer.wallet.publicKey },
      viewer: { mine: true },
    });
    expect(page.body.viewer).toMatchObject({ eligibleOrderId: null, ownReviewId: ok.body.id });
  });

  it('only lets reviewers pick versions their order downloaded and never their own listing', async () => {
    const app = await appFor();
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const buyer = await user(app);
    const l = await listing(creator.id, 'ladder');
    const v2 = randomUUID();
    await sql`
      insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
      values (${v2}, ${l.listingId}, '1.1.0', 'pack.user.js', 5, 'def', 'blobs/def', 'live')
    `;
    const released = await order(buyer.id, l);
    const wrong = await postReview(app, buyer, released, v2);
    expect(wrong.body.error.code).toBe('VERSION');
    await sql`insert into downloads (order_id, version_id) values (${released}, ${v2})`;
    const body = REVIEW;
    const signature = bs58.encode(
      nacl.sign.detached(
        new TextEncoder().encode(
          reviewMessage({
            orderId: released,
            rating: 5,
            semver: '1.1.0',
            bodySha256: await sha256Hex(new TextEncoder().encode(body)),
          }),
        ),
        buyer.wallet.secretKey,
      ),
    );
    const right = await call(app, buyer.cookie, 'POST', `/orders/${released}/review`, {
      rating: 5,
      body,
      versionId: v2,
      signature,
    });
    expect(right.status).toBe(200);

    const selfOrder = await order(creator.id, l);
    const self = await postReview(app, creator, selfOrder, l.versionId);
    expect(self.body.error.code).toBe('OWN_LISTING');
  });

  it('lets only the listing creator reply, once and editable', async () => {
    const app = await appFor();
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const buyer = await user(app);
    const l = await listing(creator.id, 'reply');
    const released = await order(buyer.id, l);
    const { body } = await postReview(app, buyer, released, l.versionId);
    const stranger = await call(app, buyer.cookie, 'PUT', `/reviews/${body.id}/reply`, {
      body: 'Thanks!',
    });
    expect(stranger.status).toBe(403);
    expect(
      (await call(app, creator.cookie, 'PUT', `/reviews/${body.id}/reply`, { body: 'Thanks!' }))
        .status,
    ).toBe(200);
    await call(app, creator.cookie, 'PUT', `/reviews/${body.id}/reply`, {
      body: 'Thanks, v1.1 adds Photon.',
    });
    const page = await call(app, '', 'GET', `/listings/${l.slug}/reviews?filter=replied`);
    expect(page.body.counts.replied).toBe(1);
    expect(page.body.reviews[0].reply).toMatchObject({
      body: 'Thanks, v1.1 adds Photon.',
      creator: { wallet: creator.wallet.publicKey },
    });
    expect(page.body.reviews[0].reply.editedAt).not.toBeNull();
    expect(page.body.viewer).toBeNull();
  });

  it('weights helpful votes: buyers count, new and creator-funded wallets show but never count', async () => {
    const walletFunders = new Map<string, string>();
    const newOnChain = new Set<string>();
    const app = await appFor({
      walletHistory: async (wallet) => ({
        oldestAt: newOnChain.has(wallet) ? now : longAgo,
        funders: walletFunders.has(wallet)
          ? [{ wallet: walletFunders.get(wallet)!, at: now.toISOString() }]
          : [],
      }),
    });
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const other = await user(app, { roles: ['buyer', 'creator'] });
    const author = await user(app);
    const l = await listing(creator.id, 'votes');
    const elsewhere = await listing(other.id, 'elsewhere');
    const { body } = await postReview(app, author, await order(author.id, l), l.versionId);

    const voter = await user(app);
    await order(voter.id, elsewhere);
    const counted = await call(app, voter.cookie, 'POST', `/reviews/${body.id}/vote`, {
      helpful: true,
    });
    expect(counted.body.weight.bps).toBe(10000);

    const fresh = await user(app, { createdAt: now });
    newOnChain.add(fresh.wallet.publicKey);
    await order(fresh.id, elsewhere);
    const shown = await call(app, fresh.cookie, 'POST', `/reviews/${body.id}/vote`, {
      helpful: true,
    });
    expect(shown.body.weight).toMatchObject({ bps: 0 });

    const unhelpful = await user(app);
    await call(app, unhelpful.cookie, 'POST', `/reviews/${body.id}/vote`, { helpful: false });

    let [row] =
      await sql`select helpful_count, unhelpful_count, helpful_weight from listing_reviews where id = ${body.id}`;
    expect(row).toMatchObject({ helpful_count: 2, unhelpful_count: 1, helpful_weight: 10000 });

    expect(
      (await call(app, author.cookie, 'POST', `/reviews/${body.id}/vote`, { helpful: true })).body
        .error.code,
    ).toBe('OWN_REVIEW');
    expect(
      (await call(app, creator.cookie, 'POST', `/reviews/${body.id}/vote`, { helpful: true })).body
        .error.code,
    ).toBe('OWN_LISTING');

    // The cron learns the counted voter was funded by this listing's creator: weight drops to 0.
    walletFunders.set(voter.wallet.publicKey, creator.wallet.publicKey);
    expect(await scanWalletIntel(lastDeps, 10)).toBe(4);
    [row] =
      await sql`select helpful_count, helpful_weight from listing_reviews where id = ${body.id}`;
    expect(row).toMatchObject({ helpful_count: 2, helpful_weight: 0 });
    const [intel] =
      await sql`select funders from wallet_intel where wallet = ${voter.wallet.publicKey}`;
    expect(intel!.funders).toEqual([{ wallet: creator.wallet.publicKey, at: now.toISOString() }]);

    const removed = await call(app, unhelpful.cookie, 'POST', `/reviews/${body.id}/vote`, {
      helpful: null,
    });
    expect(removed.body.vote).toBeNull();
    [row] = await sql`select unhelpful_count from listing_reviews where id = ${body.id}`;
    expect(row!.unhelpful_count).toBe(0);
  });

  it('auto-hides after enough counted reports; admins restore and settle them', async () => {
    const app = await appFor();
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const other = await user(app, { roles: ['buyer', 'creator'] });
    const author = await user(app);
    const admin = await user(app, { roles: ['buyer', 'admin'] });
    const l = await listing(creator.id, 'reports');
    const elsewhere = await listing(other.id, 'elsewhere2');
    const { body } = await postReview(app, author, await order(author.id, l), l.versionId);

    // The creator's report is recorded but never counts toward hiding.
    await call(app, creator.cookie, 'POST', `/reviews/${body.id}/report`, { reason: 'spam' });
    for (let i = 0; i < 3; i++) {
      const reporter = await user(app);
      await order(reporter.id, elsewhere);
      expect(
        (await call(app, reporter.cookie, 'POST', `/reviews/${body.id}/report`, { reason: 'spam' }))
          .status,
      ).toBe(200);
    }
    const hidden = await call(app, '', 'GET', `/listings/${l.slug}/reviews`);
    expect(hidden.body.reviews).toEqual([]);
    expect(hidden.body.summary).toMatchObject({ count: 0, hidden: 1 });
    const [rated] = await sql`select rating_count from listings where id = ${l.listingId}`;
    expect(rated!.rating_count).toBe(0);

    const queue = await call(app, admin.cookie, 'GET', '/admin/reviews');
    expect(queue.body[0]).toMatchObject({ id: body.id, reports: 4, counted_reports: 3 });
    expect((await call(app, author.cookie, 'GET', '/admin/reviews')).status).toBe(403);
    await call(app, admin.cookie, 'POST', `/admin/reviews/${body.id}/moderate`, {
      action: 'restore',
    });
    const back = await call(app, '', 'GET', `/listings/${l.slug}/reviews`);
    expect(back.body.reviews).toHaveLength(1);
    const [open] =
      await sql`select count(*)::int as n from review_reports where resolved_at is null`;
    expect(open!.n).toBe(0);
  });
});

describe('social: upvotes and ranking', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, review_replies,
        review_votes, review_reports, wallet_intel, listing_upvotes, creator_rank, disputes, licenses,
        payouts, orders, versions, listings, auth_nonces, users
      restart identity cascade
    `;
    await sql`delete from config where key in ('rank_config', 'social_rules')`;
  });

  it('weights upvotes, blocks your own listing, toggles, and caps upvotes per wallet per day', async () => {
    const app = await appFor();
    await sql`insert into config (key, value) values ('rank_config', ${sql.json({ upvotesPerDay: 2 })})`;
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const other = await user(app, { roles: ['buyer', 'creator'] });
    await listing(creator.id, 'up-a');
    await listing(creator.id, 'up-b');
    const c = await listing(creator.id, 'up-c');
    const elsewhere = await listing(other.id, 'up-else');

    const own = await call(app, creator.cookie, 'POST', '/listings/up-a/upvote', { up: true });
    expect(own.body.error.code).toBe('OWN_LISTING');

    const buyer = await user(app);
    await order(buyer.id, elsewhere);
    const counted = await call(app, buyer.cookie, 'POST', '/listings/up-a/upvote', { up: true });
    expect(counted.body).toMatchObject({
      count: 1,
      counted: 1,
      mix: { buyers: 1, holders: 0, others: 0 },
      viewer: { upvoted: true, weight: { bps: 10000 }, usedToday: 1, perDay: 2 },
    });

    const fresh = await user(app, { createdAt: now });
    const shown = await call(app, fresh.cookie, 'POST', '/listings/up-a/upvote', { up: true });
    expect(shown.body).toMatchObject({ count: 2, counted: 1, mix: { others: 1 } });
    expect(shown.body.viewer.weight.reason).toMatch(/new/i);

    await call(app, buyer.cookie, 'POST', '/listings/up-b/upvote', { up: true });
    const capped = await call(app, buyer.cookie, 'POST', '/listings/up-c/upvote', { up: true });
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('UPVOTE_LIMIT');
    // Re-upvoting something already upvoted is not a new upvote.
    expect(
      (await call(app, buyer.cookie, 'POST', '/listings/up-a/upvote', { up: true })).status,
    ).toBe(200);

    const off = await call(app, buyer.cookie, 'POST', '/listings/up-a/upvote', { up: false });
    expect(off.body).toMatchObject({ count: 1, counted: 0, viewer: { upvoted: false } });
    const anon = await call(app, '', 'GET', '/listings/up-a/upvotes');
    expect(anon.body).toMatchObject({ count: 1, viewer: null, rank: null });
    expect(c.slug).toBe('up-c');
  });

  it('ranks by counted sales, Bayesian rating and counted upvotes; never counts self-buys, new or creator-funded wallets', async () => {
    const app = await appFor();
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const rival = await user(app, { roles: ['buyer', 'creator'] });
    const top = await listing(creator.id, 'rank-top');
    const second = await listing(rival.id, 'rank-second');
    const washed = await listing(rival.id, 'rank-washed');
    const idle = await listing(creator.id, 'rank-idle');

    for (let i = 0; i < 3; i++) await order((await user(app)).id, top);
    await order((await user(app)).id, second);
    await order(rival.id, second); // self-buy
    await order((await user(app, { createdAt: now })).id, second); // brand-new wallet
    for (let i = 0; i < 3; i++) {
      const funded = await user(app);
      await sql`
        insert into wallet_intel (wallet, funders, oldest_seen_at)
        values (${funded.wallet.publicKey}, ${sql.json([{ wallet: rival.wallet.publicKey, at: now.toISOString() }])}, ${longAgo})
      `;
      await order(funded.id, washed);
    }
    await sql`update listings set sales_7d = 999 where id = ${top.listingId}`;

    const result = await computeRanks(lastDeps, { force: true });
    expect(result).toMatchObject({ ranked: 2, listings: 4 });
    expect(await computeRanks(lastDeps)).toBeNull(); // recomputes at most every 10 minutes

    const rows =
      await sql`select slug, rank_category, rank_overall, rank_parts, sales_7d from listings order by slug`;
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(by['rank-top']).toMatchObject({ rank_category: 1, rank_overall: 1, sales_7d: 3 });
    expect(by['rank-top']!.rank_parts).toMatchObject({ sales: 3, salesPart: 1 });
    expect(by['rank-second']).toMatchObject({ rank_category: 2, rank_overall: 2 });
    expect(by['rank-second']!.rank_parts.sales).toBe(1);
    expect(by['rank-washed']).toMatchObject({ rank_category: null, rank_overall: null });
    expect(by['rank-washed']!.rank_parts.paused).toBe('creator_funded_buyers');
    expect(by['rank-idle']).toMatchObject({ rank_category: null, rank_overall: null });

    const creators = await sql`select creator_id, rank, sales from creator_rank order by rank`;
    expect(creators.map((r) => [r.creator_id, r.rank, r.sales])).toEqual([
      [creator.id, 1, 3],
      [rival.id, 2, 1],
    ]);

    const card = await call(app, '', 'GET', '/listings/rank-top');
    expect(card.body).toMatchObject({ rank: { category: 1, overall: 1 }, upvotes: 0 });
    const list = await call(app, '', 'GET', '/listings?sort=top');
    expect(list.body.slice(0, 2).map((l: { slug: string }) => l.slug)).toEqual([
      'rank-top',
      'rank-second',
    ]);
    const panel = await call(app, '', 'GET', '/listings/rank-top/upvotes');
    expect(panel.body.rank).toMatchObject({
      category: 1,
      categoryLabel: expect.any(String),
      windowDays: 30,
    });
    expect(idle.slug).toBe('rank-idle');
  });
});

describe('social: leaderboard, paid to creators, activity', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, review_replies,
        review_votes, review_reports, wallet_intel, listing_upvotes, creator_rank, disputes, licenses,
        payouts, orders, versions, listings, auth_nonces, users
      restart identity cascade
    `;
    await sql`delete from config where key in ('rank_config', 'social_rules')`;
  });

  it('starts empty and honest: zero paid, no leaderboard rows, no activity', async () => {
    const app = await appFor();
    const stats = await call(app, '', 'GET', '/stats');
    expect(stats.body.paidToCreators).toMatchObject({
      lamports: '0',
      last24hLamports: '0',
      orders: 0,
    });
    const board = await call(app, '', 'GET', '/creators/leaderboard');
    expect(board.body).toMatchObject({ tab: 'earners', range: '30d', total: 0, rows: [] });
    expect(board.body.summary).toMatchObject({ paidLamports: '0', rankedCreators: 0 });
    const activity = await call(app, '', 'GET', '/activity');
    expect(activity.body.events).toEqual([]);
  });

  it('ranks creators by released payouts, rating, rising sales and counted upvotes', async () => {
    const app = await appFor();
    await sql`insert into config (key, value) values ('rank_config', ${sql.json({ topRatedMinReviews: 1, risingMinSales: 1 })})`;
    const alpha = await user(app, { roles: ['buyer', 'creator'] });
    const beta = await user(app, { roles: ['buyer', 'creator'] });
    await sql`update users set display_name = 'Alpha Labs' where id = ${alpha.id}`;
    const a = await listing(alpha.id, 'lb-a');
    const b = await listing(beta.id, 'lb-b');
    const buyers = [await user(app), await user(app), await user(app)];
    for (const buyer of buyers) await order(buyer.id, a);
    await order(buyers[0]!.id, b);
    await order(beta.id, b); // self-buy: never counts
    await order(buyers[1]!.id, b, 'paid'); // still in escrow: not paid out yet
    const reviewOrder = await order(buyers[2]!.id, b);
    await postReview(app, buyers[2]!, reviewOrder, b.versionId, 5);
    await sql`update listings set upvote_weight = 25000, upvote_count = 4 where id = ${b.listingId}`;

    const earners = await call(app, '', 'GET', '/creators/leaderboard?tab=earners&range=30d');
    expect(earners.body.rows.map((r: any) => [r.creator.wallet, r.sales, r.paidLamports])).toEqual([
      [alpha.wallet.publicKey, 3, '3000000000'],
      [beta.wallet.publicKey, 2, '2000000000'],
    ]);
    expect(earners.body.rows[0]).toMatchObject({
      position: 1,
      creator: { kind: 'pseudonym', name: 'Alpha Labs' },
      topListing: { slug: 'lb-a' },
    });
    expect(earners.body.rows[0].spark).toHaveLength(14);
    expect(earners.body.summary.paidLamports).toBe('6000000000'); // all released, incl. the self-buy

    const rated = await call(app, '', 'GET', '/creators/leaderboard?tab=rated');
    expect(rated.body.rows.map((r: any) => r.creator.wallet)).toEqual([beta.wallet.publicKey]);
    const upvoted = await call(app, '', 'GET', '/creators/leaderboard?tab=upvoted');
    expect(upvoted.body.rows[0]).toMatchObject({ upvotes: { counted: 2.5, raw: 4 } });
    const rising = await call(app, '', 'GET', '/creators/leaderboard?tab=rising&range=7d');
    expect(rising.body.rows[0]).toMatchObject({ rising: { now: 3, prev: 0 } });
    const verified = await call(app, '', 'GET', '/creators/leaderboard?verified=1');
    expect(verified.body.rows).toEqual([]);
    const scoped = await call(app, '', 'GET', '/creators/leaderboard?category=filter');
    expect(scoped.body.rows).toEqual([]);

    const stats = await call(app, '', 'GET', '/stats');
    expect(stats.body.paidToCreators).toMatchObject({ lamports: '6000000000', orders: 6 });

    const activity = await call(app, '', 'GET', '/activity?limit=50');
    const kinds = activity.body.events.map((e: { kind: string }) => e.kind);
    expect(kinds.filter((k: string) => k === 'sale')).toHaveLength(6); // the self-buy is left out
    expect(kinds).toContain('review');
    expect(activity.body.events.find((e: any) => e.kind === 'review')).toMatchObject({
      rating: 5,
      listing: { slug: 'lb-b' },
    });
  });
});

describe('social: paid featuring', () => {
  let clock = now;
  const txs = new Map<string, unknown>();

  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, review_replies,
        review_votes, review_reports, wallet_intel, listing_upvotes, creator_rank, disputes, licenses,
        payouts, feature_days, feature_bookings, orders, versions, listings, bonds, auth_nonces, users
      restart identity cascade
    `;
    await sql`delete from config where key in ('feature_slots', 'feature_discount_bps', 'feature_rules')`;
    clock = now;
    txs.clear();
  });

  const featureApp = () =>
    appFor({
      now: () => clock,
      getTx: async (sig: string) => (txs.get(sig) as never) ?? null,
    });

  async function creator(app: App, slug: string) {
    const who = await user(app, { roles: ['buyer', 'creator'] });
    await sql`
      insert into bonds (user_id, amount, tx_sig, status)
      values (${who.id}, ${5_000_000_000n}, ${'bond-' + randomUUID()}, 'active')
    `;
    return { ...who, l: await listing(who.id, slug) };
  }

  const sigs = new Map<string, string>();
  /** A realistic base58 signature per label. */
  const sigOf = (label: string) => {
    if (!sigs.has(label)) sigs.set(label, bs58.encode(nacl.randomBytes(64)));
    return sigs.get(label)!;
  };

  function paidTx(label: string, from: string, lamports: bigint, bookingId: string, at = clock) {
    const sig = sigOf(label);
    txs.set(sig, {
      signature: sig,
      err: null,
      blockTime: Math.floor(at.getTime() / 1000),
      confirmationStatus: 'confirmed',
      transfers: [{ source: from, destination: vault.publicKey, lamports }],
      memos: [`tm:feat:${bookingId}`],
    });
  }

  it('quotes with the config tier discount, books, pays on chain and shows as sponsored', async () => {
    const app = await featureApp();
    const alice = await creator(app, 'feat-a');
    const cfg = await call(app, '', 'GET', '/featuring/config');
    expect(cfg.body.slots.home).toMatchObject({ perDay: 3, lamportsPerDay: '1500000000' });
    expect(cfg.body.discountBps).toEqual({ none: 0, scout: 1000, trencher: 2000, og: 3000 });

    // The studio overview carries the facts behind each check tile and the marketplace card.
    const studio = await call(app, alice.cookie, 'GET', '/studio/featuring');
    expect(studio.status).toBe(200);
    const entry = studio.body.listings.find((l: any) => l.slug === 'feat-a');
    expect(entry.problems).toEqual([]);
    expect(entry.facts).toMatchObject({
      versionLive: true,
      openDisputes: 0,
      bondLamports: '5000000000',
    });
    expect(entry.facts.semver).toBeTruthy();
    expect(entry.card).toMatchObject({ slug: 'feat-a', title: expect.any(String) });

    // Admin-configurable prices and discounts.
    await sql`insert into config (key, value) values ('feature_discount_bps', ${sql.json({ none: 500 })})`;
    const body = { listingId: alice.l.listingId, kind: 'home', startDay: '2026-06-01', days: 2 };
    const quote = await call(app, alice.cookie, 'POST', '/studio/featuring/quote', body);
    expect(quote.status).toBe(200);
    expect(quote.body.problems).toEqual([]);
    expect(quote.body.quote).toMatchObject({
      subtotal: '3000000000',
      discountBps: 500,
      total: '2850000000',
    });

    const booked = await call(app, alice.cookie, 'POST', '/studio/featuring/bookings', body);
    expect(booked.status).toBe(200);
    expect(booked.body.booking).toMatchObject({ status: 'pending', total: '2850000000' });
    expect(booked.body.tx.txBase64).toBeTruthy();
    const id = booked.body.booking.id as string;

    const cal = await call(app, '', 'GET', '/featuring/calendar?kind=home');
    expect(cal.body.days[0]).toMatchObject({ day: '2026-06-01', booked: 1, free: 2 });

    // Wrong amount, then the real payment.
    paidTx('sig-wrong', alice.wallet.publicKey, 1n, id);
    const wrong = await call(
      app,
      alice.cookie,
      'POST',
      `/studio/featuring/bookings/${id}/submitted`,
      { txSig: sigOf('sig-wrong') },
    );
    expect(wrong.body.error.code).toBe('WRONG_AMOUNT');
    paidTx('sig-ok', alice.wallet.publicKey, 2_850_000_000n, id);
    const paid = await call(
      app,
      alice.cookie,
      'POST',
      `/studio/featuring/bookings/${id}/submitted`,
      { txSig: sigOf('sig-ok') },
    );
    expect(paid.body).toMatchObject({ status: 'paid', txSig: sigOf('sig-ok') });

    const featured = await call(app, '', 'GET', '/featured?placement=home');
    expect(featured.body.items).toHaveLength(1);
    expect(featured.body.items[0]).toMatchObject({
      slug: 'feat-a',
      sponsored: { placement: 'home' },
    });
    const activity = await call(app, '', 'GET', '/activity');
    expect(activity.body.events.find((e: any) => e.kind === 'featured')).toMatchObject({
      listing: { slug: 'feat-a' },
      placement: 'home',
    });
    // Featuring never changes rank.
    const [row] = await sql`select rank_overall from listings where id = ${alice.l.listingId}`;
    expect(row!.rank_overall).toBeNull();

    // Run ends: settled into the fee buckets.
    clock = new Date('2026-06-03T01:00:00Z');
    const job = await app.request('/api/v1/internal/cron/featuring', {
      method: 'POST',
      headers: { authorization: 'Bearer internal', 'x-internal-token': 'internal' },
    });
    expect(job.status).toBe(200);
    const [done] = await sql`select status from feature_bookings where id = ${id}`;
    expect(done!.status).toBe('completed');
    const [sum] =
      await sql`select coalesce(sum(amount), 0)::bigint as n from payouts where feature_booking_id = ${id}`;
    expect(BigInt(sum!.n)).toBe(2_850_000_000n);
  });

  it('enforces eligibility, capacity, run length, the home limit and the hold', async () => {
    const app = await featureApp();
    const alice = await creator(app, 'feat-b');
    const second = await listing(alice.id, 'feat-b2');
    const book = (
      who: { cookie: string },
      listingId: string,
      extra: Record<string, unknown> = {},
    ) =>
      call(app, who.cookie, 'POST', '/studio/featuring/bookings', {
        listingId,
        kind: 'home',
        startDay: '2026-06-02',
        days: 1,
        ...extra,
      });

    expect((await book(alice, alice.l.listingId, { days: 8 })).body.error.code).toBe('TOO_LONG');
    expect((await book(alice, alice.l.listingId, { startDay: '2026-05-31' })).body.error.code).toBe(
      'IN_PAST',
    );
    expect(
      (await book(alice, alice.l.listingId, { startDay: '2026-06-29', days: 2 })).body.error.code,
    ).toBe('TOO_FAR');

    expect((await book(alice, alice.l.listingId, { days: 7 })).status).toBe(200);
    expect((await book(alice, alice.l.listingId, { startDay: '2026-06-09' })).body.error.code).toBe(
      'TOO_LONG',
    );
    expect((await book(alice, second.listingId)).body.error.code).toBe('HOME_LIMIT');
    expect((await book(alice, second.listingId, { kind: 'band' })).status).toBe(200);

    // Low rating, open dispute and no bond block featuring.
    await sql`update listings set rating_avg = 3.9, rating_count = 4 where id = ${second.listingId}`;
    expect((await book(alice, second.listingId, { kind: 'category' })).body.error.code).toBe(
      'LOW_RATING',
    );
    const bob = await user(app, { roles: ['buyer', 'creator'] });
    const bobListing = await listing(bob.id, 'feat-bob');
    expect((await book(bob, bobListing.listingId)).body.error.code).toBe('NO_BOND');

    // Capacity: three home slots a day, the fourth is sold out; a lapsed hold frees the slot.
    const others = [
      await creator(app, 'feat-c'),
      await creator(app, 'feat-d'),
      await creator(app, 'feat-e'),
    ];
    expect((await book(others[0]!, others[0]!.l.listingId)).status).toBe(200);
    expect((await book(others[1]!, others[1]!.l.listingId)).status).toBe(200);
    expect((await book(others[2]!, others[2]!.l.listingId)).body.error.code).toBe('SOLD_OUT');
    clock = new Date(now.getTime() + 16 * 60_000);
    await app.request('/api/v1/internal/cron/featuring', {
      method: 'POST',
      headers: { authorization: 'Bearer internal', 'x-internal-token': 'internal' },
    });
    expect((await book(others[2]!, others[2]!.l.listingId)).status).toBe(200);
  });

  it('refunds a cancel made early enough, refuses a late one, and refunds unserved days when pulled', async () => {
    const app = await featureApp();
    const alice = await creator(app, 'feat-r');
    const pay = async (startDay: string, days: number, kind = 'band') => {
      const res = await call(app, alice.cookie, 'POST', '/studio/featuring/bookings', {
        listingId: alice.l.listingId,
        kind,
        startDay,
        days,
      });
      expect(res.status).toBe(200);
      const id = res.body.booking.id as string;
      paidTx(`sig-${id}`, alice.wallet.publicKey, BigInt(res.body.booking.total), id);
      const paid = await call(
        app,
        alice.cookie,
        'POST',
        `/studio/featuring/bookings/${id}/submitted`,
        {
          txSig: sigOf(`sig-${id}`),
        },
      );
      expect(paid.body.status).toBe('paid');
      return id;
    };
    const early = await pay('2026-06-05', 2);
    const cancelled = await call(
      app,
      alice.cookie,
      'POST',
      `/studio/featuring/bookings/${early}/cancel`,
    );
    expect(cancelled.body).toMatchObject({ status: 'cancelled', refundLamports: '400000000' });
    const [refund] =
      await sql`select recipient, bucket, amount from payouts where feature_booking_id = ${early}`;
    expect(refund).toMatchObject({ recipient: alice.wallet.publicKey, bucket: 'refund' });

    const soon = await pay('2026-06-01', 4);
    const late = await call(app, alice.cookie, 'POST', `/studio/featuring/bookings/${soon}/cancel`);
    expect(late.body.error.code).toBe('TOO_LATE');

    // Listing delisted on day 2 of 4: days 3 and 4 come back.
    clock = new Date('2026-06-02T12:00:00Z');
    await sql`update listings set delisted_at = ${clock} where id = ${alice.l.listingId}`;
    await app.request('/api/v1/internal/cron/featuring', {
      method: 'POST',
      headers: { authorization: 'Bearer internal', 'x-internal-token': 'internal' },
    });
    const [pulled] =
      await sql`select status, refund_lamports from feature_bookings where id = ${soon}`;
    expect(pulled).toMatchObject({ status: 'pulled' });
    expect(BigInt(pulled!.refund_lamports)).toBe(400_000_000n);
    const rows =
      await sql`select bucket, amount from payouts where feature_booking_id = ${soon} order by bucket`;
    const kept = rows
      .filter((r) => r.bucket !== 'refund')
      .reduce((n, r) => n + BigInt(r.amount), 0n);
    expect(kept).toBe(400_000_000n);
    const featured = await call(app, '', 'GET', '/activity');
    expect(featured.body.sponsored).toEqual([]);
  });
});
