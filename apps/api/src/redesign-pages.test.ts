import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import { type Deps } from './logic';

/** Integration: the endpoints the redesigned pages read (home, token, verify, sell, purchases,
 * dispute, profile, studio). Shapes the web client depends on, auth gates and empty states. */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const now = new Date('2026-06-01T00:00:00.000Z');
const longAgo = new Date('2026-01-01T00:00:00.000Z');
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
const vault = randomKeypair();

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

async function call(app: App, cookie: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

afterAll(async () => {
  await sql?.end();
});

beforeEach(async () => {
  sql ??= createSql(databaseUrl);
  await migrate(sql);
  await sql`
    truncate table audit_log, ledger, notifications, downloads, listing_reviews, review_replies,
      review_votes, review_reports, wallet_intel, listing_upvotes, creator_rank, disputes, licenses,
      payouts, orders, versions, listings, auth_nonces, users
    restart identity cascade
  `;
});

describe('home and token: public config, stats, listings, featured', () => {
  it('config/public carries every field the fee, tier and sell pages render', async () => {
    const app = await appFor();
    const res = await call(app, '', 'GET', '/config/public');
    expect(res.status).toBe(200);
    for (const key of [
      'feeBps',
      'tierRebateBps',
      'tierThresholds',
      'escrowHours',
      'verificationFeeLamports',
      'bondLamportsByCategory',
      'terminals',
      'verifyFreePerDay',
    ])
      expect(res.body).toHaveProperty(key);
    expect(typeof res.body.feeBps).toBe('number');
    expect(res.body.escrowHours).toBeGreaterThan(0);
    expect(Array.isArray(res.body.terminals)).toBe(true);
  });

  it('stats are live (never sample data) and money fields are strings', async () => {
    const app = await appFor();
    const res = await call(app, '', 'GET', '/stats');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('live');
    expect(res.body).toMatchObject({ listings: 0, creators: 0, orders: 0 });
    expect(typeof res.body.volume.lamports).toBe('string');
    expect(res.body).toHaveProperty('solUsd.centsPerSol');
  });

  it('listings returns the card fields the market grid uses, and featured starts empty', async () => {
    const app = await appFor();
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    await listing(creator.id, 'grid-card');
    const res = await call(app, '', 'GET', '/listings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ slug: 'grid-card', category: 'userscript' });
    expect(res.body[0]).toHaveProperty('title');
    expect(res.body[0]).toHaveProperty('price');
    const stats = await call(app, '', 'GET', '/stats');
    expect(stats.body.listings).toBe(1);

    const featured = await call(app, '', 'GET', '/featured?placement=home');
    expect(featured.body).toEqual({ placement: 'home', items: [] });
    const noCategory = await call(app, '', 'GET', '/featured?placement=category');
    expect(noCategory.status).toBe(400);
  });
});

describe('verify page: quota, sign-in gate, transparency', () => {
  it('anonymous visitors see a quota but must sign in to verify', async () => {
    const app = await appFor();
    const quota = await call(app, '', 'GET', '/verify/quota');
    expect(quota.status).toBe(200);
    const verify = await call(app, '', 'POST', '/verify', {
      fileName: 'a.user.js',
      contentBase64: btoa('x'),
    });
    expect(verify.status).toBe(401);
    expect(verify.body.error.code).toBe('SIGN_IN_REQUIRED');
  });

  it('a signed-in wallet gets a free check today', async () => {
    const app = await appFor();
    const me = await user(app);
    const quota = await call(app, me.cookie, 'GET', '/verify/quota');
    expect(quota.status).toBe(200);
    expect(JSON.stringify(quota.body)).toMatch(/free/i);
  });

  it('transparency returns the proof section data', async () => {
    const app = await appFor();
    const res = await call(app, '', 'GET', '/transparency');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentEscrows)).toBe(true);
  });
});

describe('purchases and dispute: wallet-gated', () => {
  it('needs a wallet session', async () => {
    const app = await appFor();
    expect((await call(app, '', 'GET', '/me/orders')).status).toBe(401);
    expect((await call(app, '', 'GET', '/me/reviews')).status).toBe(401);
    const dispute = await call(app, '', 'POST', `/orders/${randomUUID()}/dispute`, {
      reason: 'not_as_described',
      details: 'The file does not do what the listing says it does at all.',
    });
    expect(dispute.status).toBe(401);
  });

  it("lists the buyer's own orders only, and nobody can dispute another buyer's order", async () => {
    const app = await appFor();
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    const buyer = await user(app);
    const other = await user(app);
    const l = await listing(creator.id, 'bought');
    const orderId = await order(buyer.id, l, 'paid');

    const mine = await call(app, buyer.cookie, 'GET', '/me/orders');
    expect(mine.status).toBe(200);
    const rows = Array.isArray(mine.body) ? mine.body : mine.body.orders;
    expect(rows.map((o: any) => o.id)).toEqual([orderId]);
    const theirs = await call(app, other.cookie, 'GET', '/me/orders');
    const otherRows = Array.isArray(theirs.body) ? theirs.body : theirs.body.orders;
    expect(otherRows).toEqual([]);
    expect((await call(app, buyer.cookie, 'GET', '/me/reviews')).body).toEqual([]);

    const stranger = await call(app, other.cookie, 'POST', `/orders/${orderId}/dispute`, {
      reason: 'not_as_described',
      details: 'The file does not do what the listing says it does at all.',
    });
    expect([403, 404]).toContain(stranger.status);
  });
});

describe('creator profile', () => {
  it('404s an unknown handle and lists live listings for a known one', async () => {
    const app = await appFor();
    expect((await call(app, '', 'GET', '/creators/nobody-here')).status).toBe(404);
    const creator = await user(app, { roles: ['buyer', 'creator'] });
    await sql`update users set handle = 'alpha' where id = ${creator.id}`;
    await listing(creator.id, 'alpha-pack');
    const res = await call(app, '', 'GET', '/creators/alpha');
    expect(res.status).toBe(200);
    expect(res.body.listings.map((l: any) => l.slug)).toEqual(['alpha-pack']);
  });
});
