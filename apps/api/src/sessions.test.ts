import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { createApp } from './app';
import { signJwt } from '@trenchmart/shared';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const now = new Date('2026-06-01T00:00:00.000Z');
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
const vault = randomKeypair();

let sql: Sql;

async function reset() {
  await sql`
    truncate table
      audit_log, ledger, notifications, downloads, listing_reviews, disputes, licenses, payouts,
      orders, scan_checks, scans, ai_reviews, sandbox_jobs, listing_content, listing_media, versions, listings,
      bonds, token_balances, auth_nonces, sessions, reports, buybacks, rate_buckets, update_periods,
      update_renewals, supplements, verifications, profile_media, users
    restart identity cascade
  `;
}

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

async function appFor(
  extraEnv: Record<string, string> = {},
  extraDeps: Partial<Deps> = {},
  blobDir?: string,
) {
  const dir = blobDir ?? (await mkdtemp(join(tmpdir(), 'tm-blob-')));
  const env = readEnv({
    ...extraEnv,
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
  return createApp({
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    ...extraDeps,
  });
}

async function login(
  app: ReturnType<typeof createApp>,
  wallet: ReturnType<typeof keypair>,
  cookie = '',
) {
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
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ wallet: wallet.publicKey, signature }),
  });
  expect(verified.status).toBe(200);
  return verified.headers.get('set-cookie')?.split(';')[0] ?? '';
}

const me = (app: ReturnType<typeof createApp>, cookie: string) =>
  app.request('/api/v1/me', { headers: { cookie } });
const post = (app: ReturnType<typeof createApp>, path: string, cookie: string) =>
  app.request(`/api/v1${path}`, { method: 'POST', headers: { cookie } });

describe('server-side session revocation', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await reset();
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('a token is rejected after logout, even when replayed with a valid signature', async () => {
    const app = await appFor();
    const wallet = keypair();
    const cookie = await login(app, wallet);
    expect((await me(app, cookie)).status).toBe(200);
    const out = await post(app, '/auth/logout', cookie);
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/tm_session=;.*Max-Age=0/i);
    // The copied token is still signed and unexpired; the server refuses it.
    expect((await me(app, cookie)).status).toBe(401);
    expect(
      await (await app.request('/api/v1/auth/session', { headers: { cookie } })).json(),
    ).toEqual({
      user: null,
      session: null,
    });
    const [row] = await sql<{ revoked_reason: string }[]>`select revoked_reason from sessions`;
    expect(row?.revoked_reason).toBe('logout');
  });

  it('log out everywhere ends every session of that wallet only; API keys are untouched', async () => {
    const app = await appFor();
    const wallet = keypair();
    const other = keypair();
    const laptop = await login(app, wallet);
    const phone = await login(app, wallet);
    const someoneElse = await login(app, other);
    const res = await post(app, '/auth/logout-all', phone);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 2 });
    expect((await me(app, laptop)).status).toBe(401);
    expect((await me(app, phone)).status).toBe(401);
    expect((await me(app, someoneElse)).status).toBe(200);
    // Signed out callers cannot use it.
    expect((await post(app, '/auth/logout-all', laptop)).status).toBe(401);
    expect((await app.request('/api/v1/auth/logout-all', { method: 'POST' })).status).toBe(401);
  });

  it('refresh cannot revive a revoked session, and a live refresh keeps the same session', async () => {
    const app = await appFor();
    const wallet = keypair();
    const cookie = await login(app, wallet);
    const refreshed = await post(app, '/auth/refresh', cookie);
    expect(refreshed.status).toBe(200);
    const next = refreshed.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect((await me(app, next)).status).toBe(200);
    expect((await sql`select id from sessions`).length).toBe(1);
    await post(app, '/auth/logout', next);
    // Neither the old nor the refreshed token can refresh (or read) again.
    for (const token of [cookie, next]) {
      expect((await post(app, '/auth/refresh', token)).status).toBe(401);
      expect((await me(app, token)).status).toBe(401);
    }
    expect((await sql`select id from sessions where revoked_at is null`).length).toBe(0);
  });

  it('signing in with another wallet revokes the session it replaces', async () => {
    const app = await appFor();
    const first = keypair();
    const second = keypair();
    const old = await login(app, first);
    const switched = await login(app, second, old);
    expect((await me(app, old)).status).toBe(401);
    const body = (await (await me(app, switched)).json()) as { user: { wallet: string } };
    expect(body.user.wallet).toBe(second.publicKey);
    const [row] = await sql<{ revoked_reason: string }[]>`
      select revoked_reason from sessions where revoked_at is not null
    `;
    expect(row?.revoked_reason).toBe('switch');
  });

  it('rejects tokens without a session id (issued before revocation) and expired sessions', async () => {
    const app = await appFor();
    const wallet = keypair();
    const cookie = await login(app, wallet);
    const [user] = await sql<{ id: string }[]>`select id from users`;
    const legacy = await signJwt(
      { sub: user!.id, exp: Math.floor(now.getTime() / 1000) + 3600 },
      'test-secret-test-secret-test-secret',
    );
    expect((await me(app, `tm_session=${legacy}`)).status).toBe(401);
    const forged = await signJwt(
      { sub: user!.id, exp: Math.floor(now.getTime() / 1000) + 3600, sid: randomUUID() },
      'test-secret-test-secret-test-secret',
    );
    expect((await me(app, `tm_session=${forged}`)).status).toBe(401);
    await sql`update sessions set expires_at = ${new Date(now.getTime() - 1000)}`;
    expect((await me(app, cookie)).status).toBe(401);
    expect((await post(app, '/auth/refresh', cookie)).status).toBe(401);
  });

  it('a session of one user cannot be used as another (sid bound to sub)', async () => {
    const app = await appFor();
    const a = keypair();
    const b = keypair();
    await login(app, a);
    await login(app, b);
    const [ua] = await sql<{ id: string }[]>`select id from users where wallet = ${a.publicKey}`;
    const [sb] = await sql<{ id: string }[]>`
      select s.id from sessions s join users u on u.id = s.user_id where u.wallet = ${b.publicKey}
    `;
    const mixed = await signJwt(
      { sub: ua!.id, exp: Math.floor(now.getTime() / 1000) + 3600, sid: sb!.id },
      'test-secret-test-secret-test-secret',
    );
    expect((await me(app, `tm_session=${mixed}`)).status).toBe(401);
  });

  it('API keys cannot reach /auth/logout-all', async () => {
    const app = await appFor();
    const res = await app.request('/api/v1/auth/logout-all', {
      method: 'POST',
      headers: { authorization: 'Bearer tmk_notarealkey_000000000000000000' },
    });
    expect(res.status).toBe(403);
  });
});
