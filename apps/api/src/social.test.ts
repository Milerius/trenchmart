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
