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
import type { Deps } from './logic';
import {
  BODY_MAX_BYTES,
  bodyLimitFor,
  NONCE_OPEN_MAX,
  nonceFallbackLimit,
  pruneAuthNonces,
  STORAGE_BYTES_PER_USER,
  STUDIO_SCANS_PER_USER_DAY,
  STUDIO_VERSIONS_PER_USER_DAY,
  VERIFY_MAX_BASE64,
} from './studio-quotas';

/** Integration: API abuse limits (nonces, body caps, /verify ordering, Studio quotas). */
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const vault = randomKeypair();
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
let clock = new Date('2026-06-01T10:00:00.000Z');
let sql: Sql;
const json = { 'content-type': 'application/json' };

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

async function appFor(extra: Partial<Deps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tm-abuse-'));
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: vault.publicKey,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    AI_ATTEST_SECRET: 'attest-secret',
    INTERNAL_TOKEN: 'internal',
    SOL_USD_OVERRIDE: '100',
    RATE_LIMIT_PER_MIN: '600',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:8787',
  });
  return createApp({
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => clock,
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    ...extra,
  });
}
type App = Awaited<ReturnType<typeof appFor>>;

const nonceReq = (app: App, wallet: string) =>
  app.request('/api/v1/auth/nonce', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ wallet }),
  });

async function signIn(app: App, wallet: ReturnType<typeof keypair>) {
  const issued = (await (await nonceReq(app, wallet.publicKey)).json()) as { message: string };
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(issued.message), wallet.secretKey),
  );
  const res = await app.request('/api/v1/auth/verify', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ wallet: wallet.publicKey, signature }),
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function creator(app: App) {
  const wallet = keypair();
  const cookie = await signIn(app, wallet);
  const [user] = await sql<{ id: string }[]>`
    update users set roles = roles || '{creator}'::user_role[] where wallet = ${wallet.publicKey} returning id
  `;
  const listingId = randomUUID();
  await sql`
    insert into listings (id, creator_id, slug, title, summary, description, category, price)
    values (${listingId}, ${user!.id}, ${'p-' + listingId.slice(0, 8)}, 'Pack', 'Sum', 'Desc', 'userscript', ${1_000_000_000n})
  `;
  return { cookie, userId: user!.id, listingId };
}

describe('abuse limits', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, scan_checks, scans, ai_reviews, sandbox_jobs, listing_media, versions,
        listings, auth_nonces, rate_buckets, supplements, verifications, sessions, users
      restart identity cascade
    `;
    await sql`update config set value = '0'::jsonb where key = 'verification_fee_lamports'`;
    clock = new Date('2026-06-01T10:00:00.000Z');
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('keeps at most 5 open nonces per wallet, newest first, and sign-in still works', async () => {
    const app = await appFor();
    const wallet = keypair();
    for (let i = 0; i < 12; i++) {
      clock = new Date(clock.getTime() + 1000);
      expect((await nonceReq(app, wallet.publicKey)).status).toBe(200);
    }
    const [open] = await sql<{ n: number }[]>`
      select count(*)::int as n from auth_nonces where wallet = ${wallet.publicKey}
    `;
    expect(open!.n).toBe(NONCE_OPEN_MAX);
    // Another wallet's nonces are untouched, and the newest nonce signs in.
    await signIn(app, wallet);
  });

  it('rate-limits POST /auth/nonce per IP (Postgres fallback and binding)', async () => {
    const app = await appFor();
    expect(nonceFallbackLimit(120)).toBe(20);
    let last = 0;
    for (let i = 0; i <= nonceFallbackLimit(600); i++)
      last = (await nonceReq(app, keypair().publicKey)).status;
    expect(last).toBe(429);
    const denied = await appFor({
      limiters: { authNonce: { limit: async () => ({ success: false }) } },
    });
    const res = await nonceReq(denied, keypair().publicKey);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMIT');
  });

  it('prunes expired nonces in the cron job only', async () => {
    const app = await appFor();
    const wallet = keypair();
    await signIn(app, wallet); // a used nonce stays until it expires
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await nonceReq(app, wallet.publicKey);
    const pruned = await pruneAuthNonces({ sql, now: () => clock } as unknown as Deps);
    expect(pruned).toBe(1);
    const left = await sql`select 1 from auth_nonces`;
    expect(left.length).toBe(1);
  });

  it('caps request bodies at 1 MB outside upload routes', async () => {
    expect(bodyLimitFor('POST', '/api/v1/auth/nonce')).toBe(BODY_MAX_BYTES);
    expect(bodyLimitFor('PUT', '/api/v1/files')).toBeNull();
    expect(bodyLimitFor('POST', '/api/v1/studio/listings/x/images')).toBeNull();
    expect(bodyLimitFor('POST', '/api/v1/verify')).toBeGreaterThan(VERIFY_MAX_BASE64);
    const app = await appFor();
    const big = JSON.stringify({ wallet: 'x'.repeat(BODY_MAX_BYTES + 10) });
    const declared = await app.request('/api/v1/auth/nonce', {
      method: 'POST',
      headers: json,
      body: big,
    });
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { error: { code: string } }).error.code).toBe(
      'BODY_TOO_LARGE',
    );
    // Chunked (no content-length): counted while streaming.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const chunked = await app.request('/api/v1/auth/nonce', {
      method: 'POST',
      headers: json,
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(chunked.status).toBe(413);
  });

  it('/verify: caps the base64, checks content-length, and runs the quota before decoding', async () => {
    const app = await appFor();
    const wallet = keypair();
    const cookie = await signIn(app, wallet);
    const tooLong = await app.request('/api/v1/verify', {
      method: 'POST',
      headers: { ...json, cookie, 'content-length': String(VERIFY_MAX_BASE64 + 10_000_000) },
      body: '{}',
    });
    expect(tooLong.status).toBe(413);
    const ok = await app.request('/api/v1/verify', {
      method: 'POST',
      headers: { ...json, cookie },
      body: JSON.stringify({ fileName: 'a.js', contentBase64: btoa('hello') }),
    });
    expect(ok.status).toBe(200);
    // Free check used: an invalid body is refused with 402 before it is parsed or decoded.
    const second = await app.request('/api/v1/verify', {
      method: 'POST',
      headers: { ...json, cookie },
      body: '{not json',
    });
    expect(second.status).toBe(402);
  });

  it('caps Studio versions per creator per day (hard, not payable)', async () => {
    const app = await appFor();
    const { cookie, listingId } = await creator(app);
    for (let i = 0; i < STUDIO_VERSIONS_PER_USER_DAY; i++) {
      await sql`
        insert into versions (listing_id, semver, file_name, file_size, sha256, r2_key, status, created_at)
        values (${listingId}, ${'0.0.' + i}, 'a.js', 10, '', ${'uploads/x' + i}, 'rejected', ${clock})
      `;
    }
    const res = await app.request(`/api/v1/studio/listings/${listingId}/versions`, {
      method: 'POST',
      headers: { ...json, cookie },
      body: JSON.stringify({
        semver: '1.0.0',
        changelog: 'x',
        fileName: 'a.js',
        fileSize: 10,
        acceptSupplementLamports: '50000000',
      }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'DAILY_VERSION_CAP',
    );
    // Next UTC day the creator can upload again.
    clock = new Date('2026-06-02T00:00:01.000Z');
    const next = await app.request(`/api/v1/studio/listings/${listingId}/versions`, {
      method: 'POST',
      headers: { ...json, cookie },
      body: JSON.stringify({ semver: '1.0.0', changelog: 'x', fileName: 'a.js', fileSize: 10 }),
    });
    expect(next.status).not.toBe(429);
  });

  it('enforces the per-creator storage quota', async () => {
    const app = await appFor();
    const { cookie, listingId } = await creator(app);
    await sql`
      insert into versions (listing_id, semver, file_name, file_size, sha256, r2_key, status, created_at)
      values (${listingId}, '0.0.1', 'a.js', ${STORAGE_BYTES_PER_USER - 5}, '', 'blobs/x', 'live', ${new Date('2026-05-01')})
    `;
    const res = await app.request(`/api/v1/studio/listings/${listingId}/versions`, {
      method: 'POST',
      headers: { ...json, cookie },
      body: JSON.stringify({ semver: '1.0.0', changelog: 'xyz', fileName: 'a.js', fileSize: 10 }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STORAGE_QUOTA');
  });

  it('caps scan runs per creator per day', async () => {
    const app = await appFor();
    const { cookie, userId, listingId } = await creator(app);
    const [v] = await sql<{ id: string }[]>`
      insert into versions (listing_id, semver, file_name, file_size, sha256, r2_key, status)
      values (${listingId}, '1.0.0', 'a.js', 10, '', 'blobs/x', 'needs_creator') returning id
    `;
    for (let i = 0; i < STUDIO_SCANS_PER_USER_DAY; i++) {
      await sql`insert into audit_log (ts, actor_id, entity, entity_id, action) values (${clock}, ${userId}, 'version', ${v!.id}, 'version.scan_run')`;
    }
    const res = await app.request(`/api/v1/studio/versions/${v!.id}/review`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DAILY_SCAN_CAP');
  });
});
