import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, pendingMigrations, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { createApp } from './app';
import { limited } from './studio';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';
import { opsCheck } from './ops';

/**
 * Integration: GET /studio/overview for a brand-new creator (signed in a second ago, no
 * listings, no X, no tier) and for a creator with listings, sales, reviews and upvotes. Also
 * the 2026-10-18 outage: the API shipped ahead of 0020/0021 and the overview 500'd for everyone.
 */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const now = new Date('2026-06-15T12:00:00.000Z');
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
const vault = randomKeypair();

let sql: Sql;
let deps: Deps;
type App = ReturnType<typeof createApp>;
type Wallet = { publicKey: string; secretKey: Uint8Array };

function keypair(): Wallet {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

async function appFor(): Promise<App> {
  const dir = await mkdtemp(join(tmpdir(), 'tm-blob-'));
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: vault.publicKey,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    AI_ATTEST_SECRET: 'attest-secret',
    INTERNAL_TOKEN: 'internal',
    SOL_USD_OVERRIDE: '100',
    RATE_LIMIT_PER_MIN: '1000',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:8787',
  });
  deps = {
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    opsFetch: (async () => Response.json({ result: 'ok' })) as unknown as typeof fetch,
  };
  return createApp(deps);
}

/** Signs in through /auth/nonce + /auth/verify, which creates the user row like a first visit. */
async function signIn(app: App, wallet: Wallet): Promise<string> {
  const nonce = await app.request('/api/v1/auth/nonce', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey }),
  });
  const { message } = (await nonce.json()) as { message: string };
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey),
  );
  const verified = await app.request('/api/v1/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey, signature }),
  });
  expect(verified.status).toBe(200);
  return verified.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function overview(app: App, cookie: string) {
  const res = await app.request('/api/v1/studio/overview', { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function userId(wallet: Wallet): Promise<string> {
  const [row] = await sql<
    { id: string }[]
  >`select id from users where wallet = ${wallet.publicKey}`;
  return row!.id;
}

async function listing(creatorId: string, slug: string, status: 'live' | 'uploading') {
  const listingId = randomUUID();
  const versionId = randomUUID();
  await sql`
    insert into listings (id, creator_id, slug, title, summary, description, category, price, created_at)
    values (${listingId}, ${creatorId}, ${slug}, ${'Pack ' + slug}, 'Sum', 'Desc', 'userscript',
      ${1_000_000_000n}, ${new Date(now.getTime() - (status === 'live' ? 2 : 1) * 3_600_000)})
  `;
  await sql`
    insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
    values (${versionId}, ${listingId}, '1.0.0', 'pack.user.js', 5, ${'sha' + versionId}, 'blobs/x', ${status})
  `;
  if (status === 'live')
    await sql`update listings set live_version_id = ${versionId}, first_live_at = ${now} where id = ${listingId}`;
  return { listingId, versionId };
}

async function order(buyerId: string, l: { listingId: string; versionId: string }, status: string) {
  const id = randomUUID();
  const paidAt = new Date(now.getTime() - 86_400_000);
  await sql`
    insert into orders (
      id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
      tier_at_purchase, memo, status, paid_at, escrow_until, expires_at, released_at
    ) values (
      ${id}, ${buyerId}, ${l.listingId}, ${l.versionId}, ${1_000_000_000n}, 500, 0, 0, 0, ${1_000_000_000n},
      'none', ${'tm:' + id.slice(0, 8)}, ${status}, ${paidAt}, ${new Date(now.getTime() + 3_600_000)},
      ${paidAt}, ${status === 'released' ? paidAt : null}
    )
  `;
  return id;
}

afterAll(async () => {
  await sql?.end();
});

describe('studio overview', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, review_replies,
        review_votes, review_reports, wallet_intel, listing_upvotes, creator_rank, disputes,
        licenses, payouts, update_renewals, orders, versions, listing_content, listings,
        ops_events, ops_alerts, auth_nonces, users
      restart identity cascade
    `;
  });

  it('answers 200 with zeros for a brand-new creator (no listings, no X, no tier)', async () => {
    const app = await appFor();
    const fresh = keypair();
    const cookie = await signIn(app, fresh);
    const { status, body } = await overview(app, cookie);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      days: 30,
      creator: {
        wallet: fresh.publicKey,
        handle: null,
        displayName: null,
        avatarUrl: null,
        xHandle: null,
        xVerified: false,
        profileFilled: { done: 0, of: 5 },
      },
      revenue: { total: '0' },
      sales: { total30d: 0, last7d: 0 },
      updates: { paying: 0, monthly: '0', inFreeMonth: 0 },
      rating: null,
      disputes: { open: 0, upheld: 0 },
      payouts: { sent: '0', inMultisig: '0', queued: '0', inEscrow: '0', nextRelease: null },
      listings: [],
    });
    expect(body.revenue.daily).toEqual(Array(30).fill('0'));
    expect(body.sales.daily).toEqual(Array(30).fill(0));
    expect((await app.request('/api/v1/studio/overview')).status).toBe(401);
  });

  it('counts sales, escrow, visible reviews and upvotes for a creator with listings', async () => {
    const app = await appFor();
    const creator = keypair();
    const cookie = await signIn(app, creator);
    const creatorId = await userId(creator);
    const buyerA = keypair();
    const buyerB = keypair();
    await signIn(app, buyerA);
    await signIn(app, buyerB);
    const live = await listing(creatorId, 'sniper', 'live');
    await listing(creatorId, 'draft-pack', 'uploading');
    const released = await order(await userId(buyerA), live, 'released');
    await order(await userId(buyerB), live, 'paid');
    const [review] = await sql<{ id: string }[]>`
      insert into listing_reviews (listing_id, order_id, reviewer_id, version_id, rating, body)
      values (${live.listingId}, ${released}, ${await userId(buyerA)}, ${live.versionId}, 5, 'Works great on Axiom.')
      returning id
    `;
    await sql`insert into review_replies (review_id, creator_id, body) values (${review!.id}, ${creatorId}, 'Thanks!')`;
    await sql`insert into listing_upvotes (listing_id, user_id, weight_bps) values (${live.listingId}, ${await userId(buyerA)}, 10000)`;

    const { status, body } = await overview(app, cookie);
    expect(status).toBe(200);
    expect(body.sales).toMatchObject({ total30d: 2, last7d: 2 });
    expect(body.revenue.total).toBe('2000000000');
    expect(body.payouts.inEscrow).toBe('1000000000');
    expect(body.rating).toEqual({ avg: 5, count: 1, distribution: [1, 0, 0, 0, 0] });
    expect(body.listings.map((l: { slug: string }) => l.slug)).toEqual(['draft-pack', 'sniper']);
    expect(body.listings[1]).toMatchObject({
      sales: 2,
      sales7d: 2,
      rating: { avg: 5, count: 1 },
      live: { semver: '1.0.0', status: 'live' },
    });
    expect(body.listings[0]).toMatchObject({
      live: null,
      latest: { semver: '1.0.0', status: 'uploading' },
      rating: null,
    });

    // A hidden review stops counting.
    await sql`update listing_reviews set hidden_at = ${now}, hidden_reason = 'spam' where id = ${review!.id}`;
    const hidden = await overview(app, cookie);
    expect(hidden.body.rating).toBeNull();
    expect(hidden.body.listings[1].rating).toBeNull();
  });

  it('flags a database that is behind the release (2026-10-18 outage) and recovers on migrate', async () => {
    const app = await appFor();
    const cookie = await signIn(app, keypair());
    expect(await pendingMigrations(sql)).toEqual([]);
    expect((await opsCheck(deps)).map((a) => a.code)).not.toContain('SCHEMA_BEHIND');

    // Production state: 0021 and 0020 never applied, so listing_reviews has no hidden_at.
    await sql`drop table listing_upvotes, creator_rank, review_replies, review_votes, review_reports, wallet_intel`;
    await sql`alter table listing_reviews drop column hidden_at`;
    await sql`delete from schema_migrations where id in ('0020_reviews.sql', '0021_upvotes_ranking.sql')`;

    expect(await pendingMigrations(sql)).toEqual(['0020_reviews.sql', '0021_upvotes_ranking.sql']);
    const alerts = await opsCheck(deps);
    expect(alerts).toContainEqual(
      expect.objectContaining({ level: 'critical', code: 'SCHEMA_BEHIND' }),
    );
    expect(alerts.find((a) => a.code === 'SCHEMA_BEHIND')!.message).toContain('0020_reviews.sql');
    const broken = await overview(app, cookie);
    expect(broken.status).toBe(503);
    expect(broken.body.error.code).toBe('SCHEMA_BEHIND');

    expect(await migrate(sql)).toEqual(['0020_reviews.sql', '0021_upvotes_ranking.sql']);
    expect(await pendingMigrations(sql)).toEqual([]);
    expect((await overview(app, cookie)).status).toBe(200);
  });

  it('carries the renamed 0011_profiles.sql row over to 0013_profiles.sql without re-running it', async () => {
    await sql`update schema_migrations set id = '0011_profiles.sql' where id = '0013_profiles.sql'`;
    expect(await pendingMigrations(sql)).toEqual([]);
    expect(await migrate(sql)).toEqual([]);
    const ids = (await sql<{ id: string }[]>`select id from schema_migrations`).map((r) => r.id);
    expect(ids).toContain('0013_profiles.sql');
    expect(ids).not.toContain('0011_profiles.sql');
  });

  it('/health answers 503 SCHEMA_BEHIND while the database lacks a migration', async () => {
    const app = await appFor();
    expect((await app.request('/api/v1/health')).status).toBe(200);
    await sql`delete from schema_migrations where id = '0021_upvotes_ranking.sql'`;
    const behind = await createApp(deps).request('/api/v1/health');
    expect(behind.status).toBe(503);
    expect(await behind.json()).toMatchObject({
      ok: false,
      code: 'SCHEMA_BEHIND',
      pending: ['0021_upvotes_ranking.sql'],
    });
    await migrate(sql);
    expect((await createApp(deps).request('/api/v1/health')).status).toBe(200);
  });
});

describe('overview reads are bounded', () => {
  it('runs at most n tasks at once and keeps the input order', async () => {
    let running = 0;
    let peak = 0;
    const task = (v: number, ms: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return v;
    };
    const out = await limited(
      3,
      [5, 1, 4, 2, 3, 0, 6].map((v) => task(v, v * 3)),
    );
    expect(out).toEqual([5, 1, 4, 2, 3, 0, 6]);
    expect(peak).toBe(3);
  });
});
