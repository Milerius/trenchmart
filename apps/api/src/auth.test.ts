import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { createApp, SESSION_TTL_S } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';

/** Integration: SIWS challenge → signature → verify → session cookie → refresh → logout. */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const vault = randomKeypair();
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
let clock = new Date('2026-06-01T00:00:00.000Z');
let sql: Sql;
type App = ReturnType<typeof createApp>;
type Wallet = { publicKey: string; secretKey: Uint8Array };

function keypair(): Wallet {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

async function appFor(): Promise<App> {
  const dir = await mkdtemp(join(tmpdir(), 'tm-auth-'));
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
  return createApp({
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => clock,
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
  });
}

const json = { 'content-type': 'application/json' };

async function challenge(app: App, wallet: string) {
  const res = await app.request('/api/v1/auth/nonce', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ wallet }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { nonce: string; message: string };
}

function sign(message: string, wallet: Wallet) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey));
}

async function verify(app: App, wallet: string, signature: string) {
  return app.request('/api/v1/auth/verify', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ wallet, signature }),
  });
}

function cookieOf(res: Response) {
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function signIn(app: App, wallet: Wallet) {
  const { message } = await challenge(app, wallet.publicKey);
  const res = await verify(app, wallet.publicKey, sign(message, wallet));
  expect(res.status).toBe(200);
  return { res, cookie: cookieOf(res) };
}

let app: App;
beforeAll(async () => {
  sql ??= createSql(databaseUrl);
  await migrate(sql);
  app = await appFor();
});
afterAll(async () => {
  await sql?.end();
});

describe('SIWS auth', () => {
  it('issues a challenge that names the wallet, domain, nonce and expiry', async () => {
    const wallet = keypair();
    const { nonce, message } = await challenge(app, wallet.publicKey);
    expect(message).toContain(wallet.publicKey);
    expect(message).toContain(`Nonce: ${nonce}`);
    expect(message).toMatch(/Expiration Time: /);
  });

  it('verifies a signature, sets a long-lived httpOnly cookie, and reports the session', async () => {
    const wallet = keypair();
    const { res, cookie } = await signIn(app, wallet);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toContain(`Max-Age=${SESSION_TTL_S}`);
    const body = (await res.json()) as { user: { wallet: string }; session: { expiresAt: string } };
    expect(body.user.wallet).toBe(wallet.publicKey);
    expect(Date.parse(body.session.expiresAt)).toBe(clock.getTime() + SESSION_TTL_S * 1000);

    const me = await app.request('/api/v1/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      user: { wallet: string };
      session: { expiresAt: string };
    };
    expect(meBody.user.wallet).toBe(wallet.publicKey);
    expect(meBody.session.expiresAt).toBe(body.session.expiresAt);

    const session = await app.request('/api/v1/auth/session', { headers: { cookie } });
    expect(((await session.json()) as { user: { wallet: string } }).user.wallet).toBe(
      wallet.publicKey,
    );
  });

  it('rejects a signature from another wallet and a replayed nonce', async () => {
    const wallet = keypair();
    const other = keypair();
    const { message } = await challenge(app, wallet.publicKey);
    expect((await verify(app, wallet.publicKey, sign(message, other))).status).toBe(401);
    const good = sign(message, wallet);
    expect((await verify(app, wallet.publicKey, good)).status).toBe(200);
    expect((await verify(app, wallet.publicKey, good)).status).toBe(401);
  });

  it('rejects a challenge signed after it expired', async () => {
    const wallet = keypair();
    const { message } = await challenge(app, wallet.publicKey);
    const start = clock;
    clock = new Date(start.getTime() + 11 * 60 * 1000);
    try {
      expect((await verify(app, wallet.publicKey, sign(message, wallet))).status).toBe(401);
    } finally {
      clock = start;
    }
  });

  it('refreshes a live session without a new signature and expires a dead one', async () => {
    const wallet = keypair();
    const { cookie } = await signIn(app, wallet);
    const start = clock;
    try {
      clock = new Date(start.getTime() + 10 * 24 * 3600 * 1000);
      const refreshed = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { cookie },
      });
      expect(refreshed.status).toBe(200);
      const next = cookieOf(refreshed);
      expect(next).toMatch(/^tm_session=./);
      const body = (await refreshed.json()) as { session: { expiresAt: string } };
      expect(Date.parse(body.session.expiresAt)).toBe(clock.getTime() + SESSION_TTL_S * 1000);

      clock = new Date(start.getTime() + (SESSION_TTL_S + 60) * 1000);
      expect((await app.request('/api/v1/me', { headers: { cookie } })).status).toBe(401);
      expect((await app.request('/api/v1/me', { headers: { cookie: next } })).status).toBe(200);
      const anon = await app.request('/api/v1/auth/session', { headers: { cookie } });
      expect(await anon.json()).toEqual({ user: null, session: null });
      const dead = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { cookie },
      });
      expect(dead.status).toBe(401);
    } finally {
      clock = start;
    }
  });

  it('logs out idempotently, clearing the cookie even when the session is gone', async () => {
    const wallet = keypair();
    const { cookie } = await signIn(app, wallet);
    const out = await app.request('/api/v1/auth/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/tm_session=;.*Max-Age=0/i);
    const again = await app.request('/api/v1/auth/logout', { method: 'POST' });
    expect(again.status).toBe(204);
    expect(again.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });
});
