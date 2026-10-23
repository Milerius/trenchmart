import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import {
  compileLegacyTx,
  decodeEscrow,
  encodeEscrowForTest,
  fromBase64,
  memoIx,
  orderIdBytes,
  parseLegacyTx,
  randomKeypair,
  signTx,
  toBase64,
  type EscrowStatusName,
} from '@trenchmart/chain';
import { cleanReviewText, reviewMessage } from '@trenchmart/shared';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import { sha256Hex, type Deps } from './logic';
import type { EscrowChain } from './escrow';
import { API_SCOPES, scopeArray, scopeFor } from './agent';
import { ROUTES, scopeOf } from './openapi';

/** Integration: the agent API (keys, scopes, revocation, limits, validated broadcast). */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const programId = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
const blockhash = bs58.encode(new Uint8Array(32).fill(7));
const vault = randomKeypair();
const resolver = randomKeypair();
const buckets = [randomKeypair(), randomKeypair(), randomKeypair(), randomKeypair()].map(
  (k) => k.publicKey,
);
const clean = `// ==UserScript==
// @name Agent Filter Pack
// @match https://axiom.trade/*
// @grant none
// ==/UserScript==
console.log('agent');
`;
const REVIEW =
  'Bought and installed by an agent: the filters loaded on Axiom and matched the description.';

let sql: Sql;
type Wallet = { publicKey: string; secretKey: Uint8Array };
type App = ReturnType<typeof createApp>;

function keypair(): Wallet {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

function signText(text: string, wallet: Wallet): string {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(text), wallet.secretKey));
}

type Harness = {
  app: App;
  deps: Deps;
  clock: { now: Date };
  sent: Uint8Array[];
  accounts: Map<string, Uint8Array>;
  txs: Map<string, { memos: string[]; err: unknown }>;
};

async function harness(extra: Record<string, string> = {}): Promise<Harness> {
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: vault.publicKey,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    AI_ATTEST_SECRET: 'attest-secret',
    INTERNAL_TOKEN: 'internal',
    SOL_USD_OVERRIDE: '100',
    RATE_LIMIT_PER_MIN: '10000',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:8787',
    ESCROW_PROGRAM_ID: programId,
    ESCROW_RESOLVER: resolver.publicKey,
    ESCROW_RESOLVER_SECRET: bs58.encode(resolver.secretKey),
    ESCROW_PROGRAM_VERSION: '2',
    BUCKET_WALLET_BUYBACK: buckets[0]!,
    BUCKET_WALLET_AI_VERIFICATION: buckets[1]!,
    BUCKET_WALLET_OPS: buckets[2]!,
    BUCKET_WALLET_SAFETY: buckets[3]!,
    ...extra,
  });
  const clock = { now: new Date('2026-06-01T00:00:00.000Z') };
  const sent: Uint8Array[] = [];
  const accounts = new Map<string, Uint8Array>();
  const txs = new Map<string, { memos: string[]; err: unknown }>();
  const chain: EscrowChain = {
    async account(address) {
      const data = accounts.get(address);
      return data ? { data, owner: programId, lamports: 1n } : null;
    },
    async sendAndConfirm() {
      for (const [address, data] of accounts) {
        const account = decodeEscrow(data);
        if (account.status === 'paid')
          accounts.set(address, encodeEscrowForTest({ ...account, status: 'released' }));
        if (account.status === 'disputed') continue;
      }
      return bs58.encode(nacl.randomBytes(64));
    },
  };
  const deps: Deps = {
    sql,
    blob: filesystemBlob(await mkdtemp(join(tmpdir(), 'tm-agent-')), env.sessionSecret, env.apiUrl),
    env,
    now: () => clock.now,
    getTx: async (signature) => {
      const known = txs.get(signature);
      return known
        ? {
            signature,
            err: known.err,
            blockTime: Math.floor(clock.now.getTime() / 1000),
            confirmationStatus: 'confirmed',
            transfers: [],
            memos: known.memos,
          }
        : null;
    },
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    escrowChain: chain,
    sendTx: async (tx) => {
      sent.push(tx);
      return bs58.encode(tx.slice(1, 65));
    },
  };
  return { app: createApp(deps), deps, clock, sent, accounts, txs };
}

async function login(app: App, wallet: Wallet): Promise<string> {
  const nonce = await app.request('/api/v1/auth/nonce', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey }),
  });
  const issued = (await nonce.json()) as { message: string };
  const verified = await app.request('/api/v1/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey, signature: signText(issued.message, wallet) }),
  });
  expect(verified.status).toBe(200);
  return verified.headers.get('set-cookie')?.split(';')[0] ?? '';
}

type Res = { status: number; body: any; headers: Headers };

async function call(
  app: App,
  method: string,
  path: string,
  opts: {
    key?: string;
    cookie?: string;
    body?: unknown;
    raw?: NonNullable<RequestInit['body']>;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body, headers: res.headers };
}

/** The full wallet-signed challenge flow. */
async function mintKey(
  app: App,
  wallet: Wallet,
  scopes: string[] = [...API_SCOPES],
  rateLimitPerMin?: number,
): Promise<string> {
  const challenge = await call(app, 'POST', '/agent/auth/challenge', {
    body: { wallet: wallet.publicKey, name: 'test agent', scopes, rateLimitPerMin },
  });
  expect(challenge.status).toBe(200);
  const minted = await call(app, 'POST', '/agent/auth/key', {
    body: {
      wallet: wallet.publicKey,
      nonce: challenge.body.nonce,
      signature: signText(challenge.body.message, wallet),
    },
  });
  expect(minted.status).toBe(200);
  return minted.body.key as string;
}

async function seedListing(price = 100_000_000n) {
  const seller = keypair();
  const creatorId = randomUUID();
  const listingId = randomUUID();
  const versionId = randomUUID();
  await sql`insert into users (id, wallet, roles) values (${creatorId}, ${seller.publicKey}, ${sql.array(['creator'])}::user_role[])`;
  await sql`
    insert into listings (id, creator_id, slug, title, summary, description, category, price, terminals)
    values (${listingId}, ${creatorId}, ${'agent-' + listingId.slice(0, 6)}, 'Agent Pack', 'Sum', 'Desc', 'userscript', ${price}, ${sql.array(['Axiom'])})
  `;
  await sql`
    insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
    values (${versionId}, ${listingId}, '1.0.0', 'pack.user.js', ${clean.length}, 'abc', 'blobs/agent', 'live')
  `;
  await sql`update listings set live_version_id = ${versionId}, first_live_at = ${new Date('2026-05-01')} where id = ${listingId}`;
  return { seller, creatorId, listingId, versionId };
}

function fundedEscrow(order: Record<string, any>, buyer: string, seller: string) {
  return encodeEscrowForTest({
    buyer,
    seller,
    resolver: resolver.publicKey,
    buyback: buckets[0]!,
    aiVerification: buckets[1]!,
    ops: buckets[2]!,
    safety: buckets[3]!,
    status: 'paid' as EscrowStatusName,
    disputedFrom: 'pending' as EscrowStatusName,
    price: order.price as bigint,
    deposit: order.total as bigint,
    feeBps: order.fee_bps as number,
    rebateBps: order.rebate_bps as number,
    splitBuybackBps: 4000,
    splitAiBps: 2500,
    splitOpsBps: 2000,
    splitSafetyBps: 1500,
    expiresAt: BigInt(Math.floor((order.expires_at as Date).getTime() / 1000)),
    escrowUntil: BigInt(Math.floor((order.escrow_until as Date).getTime() / 1000)),
    bump: 255,
    orderId: orderIdBytes(order.id as string),
  });
}

/** Re-serializes a signed tx after mutating one message byte, re-signing with `signer`. */
function tamper(txBase64: string, mutate: (message: Uint8Array) => void, signer: Wallet) {
  const bytes = fromBase64(txBase64);
  const parsed = parseLegacyTx(bytes);
  const offset = bytes.length - parsed.message.length;
  const out = new Uint8Array(bytes);
  const message = out.subarray(offset);
  mutate(message);
  return toBase64(signTx(out, [signer.secretKey]));
}

async function restoreConfig() {
  await sql`update config set value = '5'::jsonb where key = 'upload_limit_per_creator_day'`;
  await sql`update config set value = '250000000'::jsonb where key = 'verification_fee_lamports'`;
}

describe('agent API', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, disputes, licenses,
        payouts, orders, scan_checks, scans, ai_reviews, sandbox_jobs, listing_content, listing_media,
        versions, listings, bonds, token_balances, auth_nonces, reports, rate_buckets, update_periods,
        update_renewals, supplements, verifications, api_keys, agent_challenges, issued_txs, users
      restart identity cascade
    `;
    await restoreConfig();
  });

  afterAll(async () => {
    await restoreConfig();
    await sql?.end();
  });

  it('mints a key from a wallet-signed challenge that states every term; nonces are single-use', async () => {
    const { app } = await harness();
    const wallet = keypair();
    const challenge = await call(app, 'POST', '/agent/auth/challenge', {
      body: {
        wallet: wallet.publicKey,
        name: 'buyer bot',
        scopes: ['trade', 'read'],
        rateLimitPerMin: 30,
      },
    });
    expect(challenge.status).toBe(200);
    const message = challenge.body.message as string;
    expect(message).toContain(wallet.publicKey);
    expect(message).toContain('Scopes: read, trade');
    expect(message).toContain('Rate limit: 30/min');
    expect(message).toContain('Cluster: devnet');
    expect(message).toContain('Key name: buyer bot');

    // A signature by another wallet, or of another text, is refused.
    const other = keypair();
    const wrong = await call(app, 'POST', '/agent/auth/key', {
      body: {
        wallet: wallet.publicKey,
        nonce: challenge.body.nonce,
        signature: signText(message, other),
      },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('BAD_SIGNATURE');
    const altered = await call(app, 'POST', '/agent/auth/key', {
      body: {
        wallet: wallet.publicKey,
        nonce: challenge.body.nonce,
        signature: signText(message.replace('read, trade', 'read, trade, sell'), wallet),
      },
    });
    expect(altered.status).toBe(401);

    const ok = await call(app, 'POST', '/agent/auth/key', {
      body: {
        wallet: wallet.publicKey,
        nonce: challenge.body.nonce,
        signature: signText(message, wallet),
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.key).toMatch(/^tmk_[A-Za-z0-9_-]{43}$/);
    expect(ok.body.scopes).toEqual(['read', 'trade']);
    expect(ok.body.rateLimitPerMin).toBe(30);
    expect(ok.body.createdVia).toBe('wallet');

    // Stored hashed only.
    const rows = await sql<
      { key_hash: string; prefix: string }[]
    >`select key_hash, prefix from api_keys`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key_hash).toBe(await sha256Hex(new TextEncoder().encode(ok.body.key)));
    expect(JSON.stringify(rows)).not.toContain(ok.body.key);
    expect(ok.body.key.startsWith(rows[0]!.prefix)).toBe(true);

    // Replay of the same signed challenge fails.
    const replay = await call(app, 'POST', '/agent/auth/key', {
      body: {
        wallet: wallet.publicKey,
        nonce: challenge.body.nonce,
        signature: signText(message, wallet),
      },
    });
    expect(replay.status).toBe(401);

    // The key works and names its wallet.
    const self = await call(app, 'GET', '/agent/keys/self', { key: ok.body.key });
    expect(self.status).toBe(200);
    expect(self.body.wallet).toBe(wallet.publicKey);
    const me = await call(app, 'GET', '/me', { key: ok.body.key });
    expect(me.status).toBe(200);
    expect(me.body.user.wallet).toBe(wallet.publicKey);
  });

  it('rejects expired challenges, bad scopes and unsafe names', async () => {
    const h = await harness();
    const wallet = keypair();
    const challenge = await call(h.app, 'POST', '/agent/auth/challenge', {
      body: { wallet: wallet.publicKey, name: 'late', scopes: ['read'] },
    });
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60_000);
    const late = await call(h.app, 'POST', '/agent/auth/key', {
      body: {
        wallet: wallet.publicKey,
        nonce: challenge.body.nonce,
        signature: signText(challenge.body.message, wallet),
      },
    });
    expect(late.status).toBe(401);
    for (const body of [
      { wallet: wallet.publicKey, name: 'x', scopes: ['admin'] },
      { wallet: wallet.publicKey, name: 'x', scopes: [] },
      { wallet: wallet.publicKey, name: 'evil\nScopes: sell', scopes: ['read'] },
      { wallet: wallet.publicKey, name: 'x', scopes: ['read'], rateLimitPerMin: 100000 },
      { wallet: 'not-a-wallet', name: 'x', scopes: ['read'] },
    ]) {
      const res = await call(h.app, 'POST', '/agent/auth/challenge', { body });
      expect(res.status).toBe(400);
    }
  });

  it('rejects unknown, malformed, revoked and expired keys with the same 401', async () => {
    const h = await harness();
    const wallet = keypair();
    const key = await mintKey(h.app, wallet, ['read']);
    for (const bad of [
      'tmk_short',
      `tmk_${'A'.repeat(43)}`,
      key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'),
    ]) {
      const res = await call(h.app, 'GET', '/me', { key: bad });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_API_KEY');
    }
    // Self-revocation.
    expect((await call(h.app, 'DELETE', '/agent/keys/self', { key })).status).toBe(200);
    const revoked = await call(h.app, 'GET', '/me', { key });
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('INVALID_API_KEY');
    // Expiry.
    const second = await mintKey(h.app, wallet, ['read']);
    await sql`update api_keys set expires_at = ${new Date(h.clock.now.getTime() - 1000)} where revoked_at is null`;
    expect((await call(h.app, 'GET', '/me', { key: second })).status).toBe(401);
    // A banned wallet's key stops working.
    const third = await mintKey(h.app, keypair(), ['read']);
    await sql`update users set banned_at = now() where id = (select user_id from api_keys where prefix = ${third.slice(0, 12)})`;
    expect((await call(h.app, 'GET', '/me', { key: third })).status).toBe(403);
  });

  it('manages keys from the studio session: create, list (no secrets), revoke, cap', async () => {
    const h = await harness();
    const wallet = keypair();
    const cookie = await login(h.app, wallet);
    const created = await call(h.app, 'POST', '/agent/keys', {
      cookie,
      body: { name: 'studio bot', scopes: ['sell', 'read'], rateLimitPerMin: 120 },
    });
    expect(created.status).toBe(200);
    expect(created.body.key).toMatch(/^tmk_/);
    expect(created.body.scopes).toEqual(['read', 'sell']);
    expect(created.body.createdVia).toBe('studio');
    const listed = await call(h.app, 'GET', '/agent/keys', { cookie });
    expect(listed.status).toBe(200);
    expect(listed.body.keys).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.key);
    expect(listed.body.keys[0]).not.toHaveProperty('key_hash');
    expect(listed.body.keys[0].prefix).toBe(created.body.key.slice(0, 12));

    // The key works, then the studio revokes it.
    expect((await call(h.app, 'GET', '/studio/overview', { key: created.body.key })).status).toBe(
      200,
    );
    const revoked = await call(h.app, 'DELETE', `/agent/keys/${created.body.id}`, { cookie });
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedAt).toBeTruthy();
    expect((await call(h.app, 'GET', '/studio/overview', { key: created.body.key })).status).toBe(
      401,
    );

    // Someone else's key id is not found.
    const otherCookie = await login(h.app, keypair());
    const foreign = await call(h.app, 'POST', '/agent/keys', {
      cookie: otherCookie,
      body: { name: 'other', scopes: ['read'] },
    });
    expect((await call(h.app, 'DELETE', `/agent/keys/${foreign.body.id}`, { cookie })).status).toBe(
      404,
    );

    // Without a session: 401. With a key: key management is not available.
    expect((await call(h.app, 'GET', '/agent/keys')).status).toBe(401);
    const asKey = await call(h.app, 'POST', '/agent/keys', {
      key: foreign.body.key,
      body: { name: 'escalate', scopes: ['sell'] },
    });
    expect(asKey.status).toBe(403);
    expect(asKey.body.error.code).toBe('KEY_FORBIDDEN');
    expect((await call(h.app, 'GET', '/agent/keys', { key: foreign.body.key })).status).toBe(403);
    expect(
      (await call(h.app, 'DELETE', `/agent/keys/${foreign.body.id}`, { key: foreign.body.key }))
        .status,
    ).toBe(403);

    // At most 10 active keys per wallet; revoked ones do not count.
    for (let i = 0; i < 10; i += 1) {
      const res = await call(h.app, 'POST', '/agent/keys', {
        cookie,
        body: { name: `k${i}`, scopes: ['read'] },
      });
      expect(res.status).toBe(200);
    }
    const capped = await call(h.app, 'POST', '/agent/keys', {
      cookie,
      body: { name: 'k11', scopes: ['read'] },
    });
    expect(capped.status).toBe(409);
    expect(capped.body.error.code).toBe('KEY_LIMIT');
  });

  it('enforces scopes deny-by-default and never exposes admin, internal or raw relay routes', async () => {
    const h = await harness();
    const listing = await seedListing();
    const wallet = keypair();
    const read = await mintKey(h.app, wallet, ['read']);
    const profile = await mintKey(h.app, wallet, ['profile']);
    const all = await mintKey(h.app, wallet);

    expect((await call(h.app, 'GET', '/listings', { key: read })).status).toBe(200);
    expect((await call(h.app, 'GET', `/listings/${listing.listingId}`, { key: read })).status).toBe(
      200,
    );
    const buy = await call(h.app, 'POST', '/orders', {
      key: read,
      body: { listingId: listing.listingId },
    });
    expect(buy.status).toBe(403);
    expect(buy.body.error.code).toBe('INSUFFICIENT_SCOPE');
    expect((await call(h.app, 'GET', '/studio/overview', { key: read })).status).toBe(403);
    expect(
      (await call(h.app, 'PUT', '/studio/profile', { key: read, body: { bio: 'x' } })).status,
    ).toBe(403);
    expect(
      (
        await call(h.app, 'POST', '/agent/tx/broadcast', {
          key: read,
          body: { txBase64: 'A'.repeat(200) },
        })
      ).status,
    ).toBe(403);

    // A profile key edits the profile but cannot sell or read.
    const edited = await call(h.app, 'PUT', '/studio/profile', {
      key: profile,
      body: {
        displayName: 'Agent Smith',
        bio: 'I am an agent.',
        socials: { github: 'agent-smith' },
      },
    });
    expect(edited.status).toBe(200);
    expect((await call(h.app, 'GET', '/studio/listings', { key: profile })).status).toBe(403);
    expect((await call(h.app, 'GET', '/me', { key: profile })).status).toBe(403);

    // Never available with a key, whatever its scopes.
    for (const [method, path] of [
      ['GET', '/admin/disputes'],
      ['GET', '/admin/ops'],
      ['POST', '/internal/cron/release'],
      ['GET', '/internal/whoami'],
      ['POST', '/hooks/helius'],
      ['POST', '/tx/send'],
      ['POST', '/auth/logout'],
      ['GET', '/auth/x/start'],
      ['POST', '/agent/keys'],
      ['GET', '/agent/unknown'],
    ] as const) {
      const res = await call(h.app, method, path, {
        key: all,
        body: method === 'GET' ? undefined : {},
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('KEY_FORBIDDEN');
    }

    // A key overrides any cookie: the session's broader rights do not leak in.
    const cookie = await login(h.app, wallet);
    const mixed = await h.app.request('/api/v1/orders', {
      method: 'POST',
      headers: { authorization: `Bearer ${read}`, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ listingId: listing.listingId }),
    });
    expect(mixed.status).toBe(403);
    // The internal token (not a tmk_ key) still works for internal routes.
    const internal = await h.app.request('/api/v1/internal/whoami', {
      headers: { authorization: 'Bearer internal' },
    });
    expect(internal.status).not.toBe(403);
  });

  it('documents every route in OpenAPI 3.1 with the scope the middleware enforces', async () => {
    const h = await harness();
    const res = await call(h.app, 'GET', '/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.servers[0].url).toBe('http://localhost:8787/api/v1');
    expect(res.body.info.summary).toContain('devnet');
    expect(Object.keys(res.body.components.schemas)).toContain('ListingSpecs_wallet');
    const key = await mintKey(h.app, keypair(), ['read']);
    for (const route of ROUTES) {
      const op = res.body.paths[route.path][route.method];
      expect(op, `${route.method} ${route.path}`).toBeTruthy();
      expect(op['x-scope']).toBe(scopeOf(route));
      if (route.sessionOnly || route.public) continue;
      // Every documented key route is reachable by some scope (never KEY_FORBIDDEN).
      const sample = route.path.replace(/\{[^}]+\}/g, randomUUID());
      expect(
        scopeFor(route.method.toUpperCase(), sample),
        `${route.method} ${route.path}`,
      ).not.toBe('denied');
    }
    // Every documented path is routed (an unknown route answers Hono's plain-text 404).
    for (const route of ROUTES) {
      const path = route.path.replace(/\{[^}]+\}/g, randomUUID());
      const out = await h.app.request(`/api/v1${path}`, {
        method: route.method.toUpperCase(),
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: route.method === 'get' ? undefined : '{}',
      });
      const text = await out.text();
      expect(text === '404 Not Found', `${route.method} ${route.path} is not routed`).toBe(false);
    }
  });

  it('rate-limits each key on its own budget, reads included', async () => {
    const h = await harness();
    const wallet = keypair();
    const slow = await mintKey(h.app, wallet, ['read'], 3);
    const fast = await mintKey(h.app, wallet, ['read'], 50);
    for (let i = 0; i < 3; i += 1) {
      const res = await call(h.app, 'GET', '/listings', { key: slow });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-ratelimit-limit')).toBe('3');
      expect(res.headers.get('x-ratelimit-remaining')).toBe(String(2 - i));
    }
    const limited = await call(h.app, 'GET', '/listings', { key: slow });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call(h.app, 'GET', '/listings', { key: fast })).status).toBe(200);
    // Next minute window: allowed again.
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    expect((await call(h.app, 'GET', '/listings', { key: slow })).status).toBe(200);
  });

  it('broadcast relays only the exact issued transaction, signed by the key wallet', async () => {
    const h = await harness();
    const listing = await seedListing();
    const buyer = keypair();
    const key = await mintKey(h.app, buyer, ['read', 'trade']);
    const order = await call(h.app, 'POST', '/orders', {
      key,
      body: { listingId: listing.listingId },
    });
    expect(order.status).toBe(200);
    const unsigned = order.body.txBase64 as string;
    const parsed = parseLegacyTx(fromBase64(unsigned));
    expect(parsed.accountKeys[0]).toBe(buyer.publicKey);
    expect(parsed.instructions.some((ix) => ix.programId === programId)).toBe(true);
    const signed = toBase64(signTx(fromBase64(unsigned), [buyer.secretKey]));
    const broadcast = (txBase64: string, k = key) =>
      call(h.app, 'POST', '/agent/tx/broadcast', { key: k, body: { txBase64 } });

    // Unsigned: refused.
    const unsignedRes = await broadcast(unsigned);
    expect(unsignedRes.status).toBe(400);
    expect(unsignedRes.body.error.code).toBe('BAD_SIGNATURE');
    // Signed by another wallet (same message): refused.
    const stranger = keypair();
    const strangerSigned = toBase64(signTx(fromBase64(unsigned), [stranger.secretKey]));
    expect((await broadcast(strangerSigned)).body.error.code).toBe('BAD_SIGNATURE');
    // Tampered amount: the last instruction data byte region of the escrow ix, re-signed.
    const initIx = parsed.instructions.find((ix) => ix.programId === programId)!;
    const msg = parsed.message;
    const dataAt = (() => {
      for (let i = 0; i + initIx.data.length <= msg.length; i += 1) {
        if (initIx.data.every((b, j) => msg[i + j] === b)) return i;
      }
      return -1;
    })();
    expect(dataAt).toBeGreaterThan(0);
    for (const offset of [8 + 16 + 32 * 6 + 1, initIx.data.length - 1]) {
      const changed = tamper(
        signed,
        (m) => {
          m[dataAt + offset] = (m[dataAt + offset]! + 1) % 256;
        },
        buyer,
      );
      const res = await broadcast(changed);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOT_ISSUED');
    }
    // Tampered blockhash and tampered account key (seller swapped): refused.
    const bhAt = 3 + 1 + parsed.accountKeys.length * 32;
    const swappedBlockhash = tamper(
      signed,
      (m) => {
        m[bhAt] = (m[bhAt]! + 1) % 256;
      },
      buyer,
    );
    expect((await broadcast(swappedBlockhash)).body.error.code).toBe('NOT_ISSUED');
    // Swapping any non-program account (the escrow PDA, the config): not the issued message.
    const programIds = new Set(parsed.instructions.map((ix) => ix.programId));
    const plainAccounts = parsed.accountKeys
      .map((k, i) => ({ k, i }))
      .filter(({ k, i }) => i > 0 && !programIds.has(k))
      .map(({ i }) => i);
    expect(plainAccounts.length).toBeGreaterThan(0);
    for (const index of plainAccounts) {
      const swappedAccount = tamper(
        signed,
        (m) => {
          const at = 3 + 1 + 32 * index;
          m[at] = (m[at]! + 1) % 256;
        },
        buyer,
      );
      expect((await broadcast(swappedAccount)).body.error.code).toBe('NOT_ISSUED');
    }
    // Swapping a program id (the last, read-only keys) is caught as a foreign program.
    const swappedProgram = tamper(
      signed,
      (m) => {
        const at = 3 + 1 + 32 * (parsed.accountKeys.length - 1);
        m[at] = (m[at]! + 1) % 256;
      },
      buyer,
    );
    expect((await broadcast(swappedProgram)).body.error.code).toBe('FOREIGN_PROGRAM');
    // A transaction the API never issued is refused even when it only uses allowed programs.
    const transfer = compileLegacyTx({
      feePayer: buyer.publicKey,
      instructions: [memoIx(order.body.memo, buyer.publicKey)],
      recentBlockhash: blockhash,
    });
    expect((await broadcast(toBase64(signTx(transfer, [buyer.secretKey])))).body.error.code).toBe(
      'NOT_ISSUED',
    );
    // An instruction to a foreign program is refused before the lookup.
    const foreign = compileLegacyTx({
      feePayer: buyer.publicKey,
      instructions: [{ programId: randomKeypair().publicKey, keys: [], data: new Uint8Array([1]) }],
      recentBlockhash: blockhash,
    });
    expect((await broadcast(toBase64(signTx(foreign, [buyer.secretKey])))).body.error.code).toBe(
      'FOREIGN_PROGRAM',
    );
    // An extra co-signer is refused.
    const cosigner = keypair();
    const twoSigners = compileLegacyTx({
      feePayer: buyer.publicKey,
      instructions: [memoIx('x', cosigner.publicKey)],
      recentBlockhash: blockhash,
    });
    expect(
      (await broadcast(toBase64(signTx(twoSigners, [buyer.secretKey, cosigner.secretKey])))).body
        .error.code,
    ).toBe('WRONG_SIGNER');
    // Versioned (v0) message, trailing bytes and garbage: refused.
    const v0 = fromBase64(signed);
    const v0Bytes = new Uint8Array(v0);
    v0Bytes[65] = 0x80;
    expect((await broadcast(toBase64(v0Bytes))).body.error.code).toBe('BAD_TX');
    const trailing = new Uint8Array([...fromBase64(signed), 0]);
    expect((await broadcast(toBase64(trailing))).body.error.code).toBe('BAD_TX');
    expect((await broadcast('!'.repeat(200))).body.error.code).toBe('BAD_TX');
    // Another wallet's key cannot relay this wallet's issued transaction.
    const otherKey = await mintKey(h.app, keypair(), ['trade']);
    expect((await broadcast(signed, otherKey)).body.error.code).toBe('WRONG_SIGNER');
    expect(h.sent).toHaveLength(0);

    // The exact issued transaction, signed by the wallet: relayed byte for byte.
    const ok = await broadcast(signed);
    expect(ok.status).toBe(200);
    expect(ok.body.kind).toBe('order');
    expect(h.sent).toHaveLength(1);
    expect(toBase64(h.sent[0]!)).toBe(signed);
    expect(ok.body.signature).toBe(bs58.encode(fromBase64(signed).slice(1, 65)));

    // After the relay window it expires.
    const order2 = await call(h.app, 'POST', '/orders', {
      key,
      body: { listingId: listing.listingId },
    });
    const signed2 = toBase64(signTx(fromBase64(order2.body.txBase64), [buyer.secretKey]));
    h.clock.now = new Date(h.clock.now.getTime() + 4 * 60_000);
    const expired = await broadcast(signed2);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('TX_EXPIRED');
  });

  it('I-07: /tx/send relays only issued or escrow-only transactions, with a per-wallet limit', async () => {
    const h = await harness();
    const listing = await seedListing();
    const buyer = keypair();
    const cookie = await login(h.app, buyer);
    const order = await call(h.app, 'POST', '/orders', {
      cookie,
      body: { listingId: listing.listingId },
    });
    expect(order.status).toBe(200);
    const signed = toBase64(signTx(fromBase64(order.body.txBase64), [buyer.secretKey]));
    const send = (txBase64: string, c = cookie) =>
      call(h.app, 'POST', '/tx/send', { cookie: c, body: { txBase64 } });

    // Not signed in: refused before anything else.
    expect((await call(h.app, 'POST', '/tx/send', { body: { txBase64: signed } })).status).toBe(
      401,
    );
    // An arbitrary transaction (not issued, not escrow-only) is not relayed.
    const memoOnly = compileLegacyTx({
      feePayer: buyer.publicKey,
      instructions: [memoIx('spam', buyer.publicKey)],
      recentBlockhash: blockhash,
    });
    const memoRes = await send(toBase64(signTx(memoOnly, [buyer.secretKey])));
    expect(memoRes.status).toBe(400);
    expect(memoRes.body.error.code).toBe('NOT_ISSUED');
    const foreign = compileLegacyTx({
      feePayer: buyer.publicKey,
      instructions: [{ programId: randomKeypair().publicKey, keys: [], data: new Uint8Array([1]) }],
      recentBlockhash: blockhash,
    });
    expect((await send(toBase64(signTx(foreign, [buyer.secretKey])))).body.error.code).toBe(
      'FOREIGN_PROGRAM',
    );
    // Another wallet's session cannot relay this wallet's transaction.
    const other = await login(h.app, keypair());
    expect((await send(signed, other)).body.error.code).toBe('WRONG_SIGNER');
    // Unsigned: refused.
    expect((await send(order.body.txBase64)).body.error.code).toBe('BAD_SIGNATURE');
    expect(h.sent).toHaveLength(0);

    // The issued transaction: relayed byte for byte and recorded.
    const ok = await send(signed);
    expect(ok.status).toBe(200);
    expect(h.sent).toHaveLength(1);
    expect(toBase64(h.sent[0]!)).toBe(signed);
    const recorded =
      await sql`select broadcast_sig from issued_txs where broadcast_sig = ${ok.body.signature}`;
    expect(recorded).toHaveLength(1);

    // An escrow-program-only transaction (wallet rewrote the message) is allowed.
    const escrowOnly = compileLegacyTx({
      feePayer: buyer.publicKey,
      instructions: [{ programId, keys: [], data: new Uint8Array([9, 9]) }],
      recentBlockhash: blockhash,
    });
    expect((await send(toBase64(signTx(escrowOnly, [buyer.secretKey])))).status).toBe(200);
    expect(h.sent).toHaveLength(2);

    // Per-wallet budget: 20 per minute (counted before validation), then 429.
    let last = 0;
    for (let i = 0; i < 20; i += 1)
      last = (await send(toBase64(signTx(memoOnly, [buyer.secretKey])))).status;
    expect(last).toBe(429);
    // Another wallet is unaffected.
    expect((await send(signed, other)).status).toBe(400);
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    expect((await send(toBase64(signTx(memoOnly, [buyer.secretKey])))).status).toBe(400);
  });

  it('runs the full agent buy flow: order, sign, broadcast, confirm, download, release, review', async () => {
    const h = await harness();
    const listing = await seedListing();
    await h.deps.blob.put('blobs/agent', new TextEncoder().encode(clean));
    const buyer = keypair();
    const key = await mintKey(h.app, buyer, ['read', 'trade', 'review']);

    const found = await call(h.app, 'GET', '/listings?q=Agent', { key });
    expect(found.status).toBe(200);
    const report = await call(h.app, 'GET', `/listings/${listing.listingId}`, { key });
    expect(report.status).toBe(200);
    const quote = await call(h.app, 'POST', '/orders/quote', {
      key,
      body: { listingId: listing.listingId },
    });
    expect(quote.status).toBe(200);
    expect(quote.body.total).toBe('105000000');
    const order = await call(h.app, 'POST', '/orders', {
      key,
      body: { listingId: listing.listingId },
    });
    expect(order.status).toBe(200);
    const signed = toBase64(signTx(fromBase64(order.body.txBase64), [buyer.secretKey]));
    const sent = await call(h.app, 'POST', '/agent/tx/broadcast', {
      key,
      body: { txBase64: signed },
    });
    expect(sent.status).toBe(200);
    const signature = sent.body.signature as string;

    // Not confirmed yet: TX_NOT_FOUND, then the chain shows the funded escrow.
    const early = await call(h.app, 'POST', `/orders/${order.body.orderId}/submitted`, {
      key,
      body: { txSig: signature },
    });
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('TX_NOT_FOUND');
    const [row] = await sql<
      Record<string, any>[]
    >`select * from orders where id = ${order.body.orderId}`;
    h.txs.set(signature, { memos: [order.body.memo], err: null });
    h.accounts.set(
      order.body.escrow,
      fundedEscrow(row!, buyer.publicKey, listing.seller.publicKey),
    );
    const confirmed = await call(h.app, 'POST', `/orders/${order.body.orderId}/submitted`, {
      key,
      body: { txSig: signature },
    });
    expect(confirmed.status).toBe(200);

    const download = await call(h.app, 'POST', `/orders/${order.body.orderId}/download`, { key });
    expect(download.status).toBe(200);
    const fileUrl = new URL(download.body.url);
    const file = await h.app.request(`${fileUrl.pathname}${fileUrl.search}`);
    expect(file.status).toBe(200);
    expect(await file.text()).toContain('Agent Filter Pack');

    // Reviews open after release; release is refused before the window ends.
    const tooEarly = await call(h.app, 'POST', `/agent/orders/${order.body.orderId}/release`, {
      key,
    });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('ESCROW_WINDOW');
    h.clock.now = new Date((row!.escrow_until as Date).getTime() + 1000);
    const released = await call(h.app, 'POST', `/agent/orders/${order.body.orderId}/release`, {
      key,
    });
    expect(released.status).toBe(200);
    expect(released.body.released).toBe(true);
    // Someone else's order cannot be released by this key.
    const stranger = await mintKey(h.app, keypair(), ['trade']);
    expect(
      (await call(h.app, 'POST', `/agent/orders/${order.body.orderId}/release`, { key: stranger }))
        .status,
    ).toBe(404);

    const form = await call(h.app, 'GET', `/orders/${order.body.orderId}/review-form`, { key });
    expect(form.status).toBe(200);
    expect(form.body.canReview).toBe(true);
    const version = form.body.versions[0];
    const message = reviewMessage({
      orderId: order.body.orderId,
      rating: 5,
      semver: version.semver,
      bodySha256: await sha256Hex(new TextEncoder().encode(cleanReviewText(REVIEW))),
    });
    const tradeOnly = await mintKey(h.app, buyer, ['trade']);
    const noScope = await call(h.app, 'POST', `/orders/${order.body.orderId}/review`, {
      key: tradeOnly,
      body: { rating: 5, body: REVIEW, versionId: version.id, signature: signText(message, buyer) },
    });
    expect(noScope.status).toBe(403);
    const review = await call(h.app, 'POST', `/orders/${order.body.orderId}/review`, {
      key,
      body: {
        rating: 5,
        body: REVIEW,
        versionId: version.id,
        terminal: 'Axiom',
        signature: signText(message, buyer),
      },
    });
    expect(review.status).toBe(200);
    expect(review.body.ok).toBe(true);
  });

  it('lets a sell-scoped key do the creator flow: listing with specs, upload, scan, price, sales', async () => {
    const h = await harness();
    const creator = keypair();
    const key = await mintKey(h.app, creator, ['read', 'sell', 'profile']);
    const [user] = await sql<
      { id: string }[]
    >`select id from users where wallet = ${creator.publicKey}`;
    // X link (unverified dev link where X OAuth is off) through the profile scope.
    const linked = await call(h.app, 'POST', '/studio/x', {
      key,
      body: { handle: 'agent_seller' },
    });
    expect(linked.status).toBe(200);
    await sql`insert into bonds (user_id, amount, tx_sig, status) values (${user!.id}, ${5_000_000_000n}, ${bs58.encode(nacl.randomBytes(64))}, 'active')`;
    await sql`update config set value = '0'::jsonb where key = 'verification_fee_lamports'`;
    const requirements = await call(h.app, 'GET', '/studio/requirements', { key });
    expect(requirements.status).toBe(200);
    expect(requirements.body.bondOk).toBe(true);

    // Kind-specific specs are validated.
    const badSpecs = await call(h.app, 'POST', '/studio/listings', {
      key,
      body: {
        title: 'Agent Wallets',
        summary: 'Smart money list.',
        description: 'Labelled wallets.',
        category: 'wallet_list',
        priceLamports: '200000000',
        kind: 'wallet',
        specs: { chain: 'solana', formats: [], walletCount: 10, cadence: 'weekly', columns: [] },
      },
    });
    expect(badSpecs.status).toBe(400);
    const created = await call(h.app, 'POST', '/studio/listings', {
      key,
      body: {
        title: 'Agent Script',
        summary: 'Overlay for Axiom.',
        description: 'Adds an overlay.',
        category: 'userscript',
        terminals: ['Axiom'],
        priceLamports: '150000000',
        license: 'subscription',
        subPeriodDays: 30,
        kind: 'script',
        specs: {
          managers: ['Tampermonkey'],
          browsers: ['Chrome'],
          readsPage: true,
          network: 'none',
          tradeButtons: false,
          storage: 'local',
        },
      },
    });
    expect(created.status).toBe(200);
    const listingId = created.body.id as string;

    const started = await call(h.app, 'POST', `/studio/listings/${listingId}/versions`, {
      key,
      body: {
        semver: '1.0.0',
        changelog: 'first',
        fileName: 'agent.user.js',
        fileSize: clean.length,
      },
    });
    expect(started.status).toBe(200);
    const target = new URL(started.body.uploadUrl);
    const put = await h.app.request(`${target.pathname}${target.search}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${key}` },
      body: new TextEncoder().encode(clean),
    });
    expect(put.status).toBeLessThan(300);
    const done = await call(h.app, 'POST', `/studio/versions/${started.body.versionId}/complete`, {
      key,
    });
    expect(done.status).toBe(200);
    const result = await call(h.app, 'GET', `/studio/versions/${started.body.versionId}`, { key });
    expect(result.status).toBe(200);
    expect(['live', 'needs_creator', 'rejected', 'scanning']).toContain(result.body.version.status);
    expect(Array.isArray(result.body.checks)).toBe(true);
    expect(result.body.checks.length).toBeGreaterThan(0);

    const repriced = await call(h.app, 'PATCH', `/studio/listings/${listingId}`, {
      key,
      body: { priceLamports: '175000000', updatePriceLamports: '0' },
    });
    expect(repriced.status).toBe(200);
    const [stored] = await sql<
      { price: bigint; license: string; kind: string }[]
    >`select price, license, kind from listings where id = ${listingId}`;
    expect(stored!.price).toBe(175_000_000n);
    expect(stored!.license).toBe('subscription');
    expect(stored!.kind).toBe('script');
    expect((await call(h.app, 'GET', '/studio/overview', { key })).status).toBe(200);
    expect((await call(h.app, 'GET', '/studio/payouts', { key })).status).toBe(200);
    expect(
      (await call(h.app, 'GET', `/studio/listings/${listingId}/upload-quota`, { key })).status,
    ).toBe(200);
  });
});

describe('scopeArray (text[] as returned through Hyperdrive)', () => {
  it('accepts arrays and Postgres array literals, drops unknown scopes', () => {
    expect(scopeArray(['read', 'trade'])).toEqual(['read', 'trade']);
    expect(scopeArray('{read,sell,profile}')).toEqual(['read', 'sell', 'profile']);
    expect(scopeArray('{"read","admin"}')).toEqual(['read']);
    expect(scopeArray('{}')).toEqual([]);
    expect(scopeArray(null)).toEqual([]);
  });
});
