import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { serve } from '@hono/node-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';

/**
 * Integration: the whole X OAuth callback, through the web app's /api/v1 proxy (the path the
 * browser takes on trenchmart.fun), against a mock X API served over real HTTP. The API runs
 * on the global fetch (no injected test fetch) with Workers' rule that fetch must not be
 * called as a method of another object: that rule is what broke the live callback.
 */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const APP_URL = 'http://localhost:3000';
const CLIENT_ID = 'client-id-1lO0';
const CLIENT_SECRET = 'client-secret-1lO0';
const vault = randomKeypair();
const blockhash = bs58.encode(new Uint8Array(32).fill(3));

type Wallet = { publicKey: string; secretKey: Uint8Array };
type XRequest = { path: string; auth: string; body: URLSearchParams };
type Reply = { status: number; json: unknown };

let sql: Sql;
let clock = new Date('2026-06-01T00:00:00.000Z');
let api: ReturnType<typeof serve>;
let x: Server;
let xUrl = '';
let xRequests: XRequest[] = [];
let tokenReply: Reply;
// The web proxy reads TM_API_URL at import time, so it is imported once the API is up.
let proxy: typeof import('../../web/src/lib/api-proxy').proxy;
let meReply: Reply;

const realFetch = globalThis.fetch;
/** workerd: `obj.fetch(...)` with the global fetch throws; a plain call is fine. */
function workerdFetch(this: unknown, input: string | URL | Request, init?: RequestInit) {
  if (this !== undefined && this !== globalThis)
    throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
  return realFetch(input, init);
}

function keypair(): Wallet {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

function mockX(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
  req.on('end', () => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    xRequests.push({ path, auth: req.headers.authorization ?? '', body: new URLSearchParams(raw) });
    const reply = path === '/2/oauth2/token' ? tokenReply : path === '/2/users/me' ? meReply : null;
    res.writeHead(reply?.status ?? 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply?.json ?? { title: 'Not Found' }));
  });
}

/** One request through the web proxy route (apps/web/src/app/api/v1/[...path]/route.ts). */
async function viaWeb(path: string, cookie = ''): Promise<Response> {
  const url = new URL(path, APP_URL);
  const segments = url.pathname.replace(/^\/api\/v1\//, '').split('/');
  return proxy(new Request(url, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ path: segments }),
  });
}

async function viaWebPost(path: string, body: unknown, cookie = ''): Promise<Response> {
  const url = new URL(path, APP_URL);
  const segments = url.pathname.replace(/^\/api\/v1\//, '').split('/');
  return proxy(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: segments }) },
  );
}

const cookieOf = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0] ?? '';

async function login(wallet: Wallet): Promise<string> {
  const nonce = await viaWebPost('/api/v1/auth/nonce', { wallet: wallet.publicKey });
  const { message } = (await nonce.json()) as { message: string };
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey),
  );
  const verified = await viaWebPost('/api/v1/auth/verify', {
    wallet: wallet.publicKey,
    signature,
  });
  expect(verified.status).toBe(200);
  return cookieOf(verified, 'tm_session');
}

/** Starts a sign-in like the Verify with X button; returns what the browser would hold. */
async function start(session: string) {
  const started = await viaWeb('/api/v1/auth/x/start', session);
  expect(started.status).toBe(200);
  const { url } = (await started.json()) as { url: string };
  const authorize = new URL(url);
  const setCookie = started.headers.getSetCookie().find((c) => c.startsWith('tm_x_oauth='));
  return {
    authorize,
    state: authorize.searchParams.get('state') ?? '',
    setCookie: setCookie ?? '',
    cookie: `${session}; ${(setCookie ?? '').split(';')[0]}`,
  };
}

async function xRow(wallet: Wallet) {
  const rows = await sql<{ x_handle: string | null; x_user_id: string | null }[]>`
    select x_handle, x_user_id from users where wallet = ${wallet.publicKey}
  `;
  return rows[0];
}

const location = (response: Response) => response.headers.get('location');

describe('X OAuth callback (integration, through the web proxy)', () => {
  beforeAll(async () => {
    sql = createSql(databaseUrl);
    await migrate(sql);
    x = createServer(mockX);
    await new Promise<void>((done) => x.listen(0, '127.0.0.1', done));
    xUrl = `http://127.0.0.1:${(x.address() as AddressInfo).port}`;
    const env = readEnv({
      SOLANA_CLUSTER: 'devnet',
      VAULT_ADDRESS: vault.publicKey,
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
      AI_ATTEST_SECRET: 'attest-secret',
      INTERNAL_TOKEN: 'internal',
      SOL_USD_OVERRIDE: '100',
      RATE_LIMIT_PER_MIN: '1000',
      APP_URL,
      API_URL: 'http://localhost:8787',
      X_CLIENT_ID: CLIENT_ID,
      X_CLIENT_SECRET: CLIENT_SECRET,
      X_API_URL: xUrl,
    });
    const app = createApp({
      sql,
      blob: filesystemBlob(
        await mkdtemp(join(tmpdir(), 'tm-blob-')),
        env.sessionSecret,
        env.apiUrl,
      ),
      env,
      now: () => clock,
      getTx: async () => null,
      blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
      // No xFetch: the callback must work on the platform fetch.
    });
    api = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise<void>((done) => api.once('listening', () => done()));
    process.env.TM_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    ({ proxy } = await import('../../web/src/lib/api-proxy'));
  });

  beforeEach(async () => {
    clock = new Date('2026-06-01T00:00:00.000Z');
    xRequests = [];
    tokenReply = { status: 200, json: { access_token: 'at-1', token_type: 'bearer' } };
    meReply = {
      status: 200,
      json: { data: { id: '1601092300893499392', username: 'mileriseme' } },
    };
    await sql`truncate table audit_log, auth_nonces, token_balances, users restart identity cascade`;
    globalThis.fetch = workerdFetch as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  afterAll(async () => {
    await new Promise((done) => api?.close(done));
    await new Promise((done) => x?.close(done));
    await sql?.end();
  });

  it('links the verified handle end to end: PKCE S256, Basic client auth, users/me, DB update', async () => {
    const roman = keypair();
    const session = await login(roman);
    // Roman's state before: a handle typed in on devnet, not verified.
    await sql`update users set x_handle = 'mileriseme', x_user_id = 'dev:mileriseme' where wallet = ${roman.publicKey}`;
    const flow = await start(session);
    expect(flow.authorize.origin + flow.authorize.pathname).toBe(
      'https://x.com/i/oauth2/authorize',
    );
    expect(flow.authorize.searchParams.get('scope')).toBe('users.read tweet.read');
    expect(flow.authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.authorize.searchParams.get('redirect_uri')).toBe(
      `${APP_URL}/api/v1/auth/x/callback`,
    );
    // The state cookie survives the proxy, scoped to the callback path on the web origin.
    expect(flow.setCookie).toMatch(/Path=\/api\/v1\/auth\/x/);
    expect(flow.setCookie).toMatch(/HttpOnly/);
    expect(flow.setCookie).toMatch(/SameSite=Lax/);
    expect(flow.setCookie).not.toMatch(/Domain=/i);

    const back = await viaWeb(
      `/api/v1/auth/x/callback?code=good-code&state=${flow.state}`,
      flow.cookie,
    );
    expect(back.status).toBe(302);
    expect(location(back)).toBe(`${APP_URL}/studio/profile?x=linked`);
    // The one-time state cookie is cleared.
    expect(back.headers.getSetCookie().join('\n')).toMatch(/tm_x_oauth=;.*Max-Age=0/);

    const [token, me] = xRequests;
    expect(xRequests.map((r) => r.path)).toEqual(['/2/oauth2/token', '/2/users/me']);
    expect(token!.auth).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    );
    expect(token!.body.get('grant_type')).toBe('authorization_code');
    expect(token!.body.get('code')).toBe('good-code');
    expect(token!.body.get('redirect_uri')).toBe(`${APP_URL}/api/v1/auth/x/callback`);
    const verifier = token!.body.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      flow.authorize.searchParams.get('code_challenge'),
    );
    expect(me!.auth).toBe('Bearer at-1');

    expect(await xRow(roman)).toEqual({ x_handle: 'mileriseme', x_user_id: '1601092300893499392' });
    const profile = (await (await viaWeb('/api/v1/studio/profile', session)).json()) as {
      xHandle: string;
      xVerified: boolean;
    };
    expect(profile).toMatchObject({ xHandle: 'mileriseme', xVerified: true });
    const audit = await sql`select action from audit_log where action = 'x_linked'`;
    expect(audit).toHaveLength(1);
  });

  // The last base64url char of a 32-byte MAC carries 4 bits: A-D all decode alike, so a flip
  // to 'A' was a no-op whenever the MAC already ended in A-D (flaky). Change the top bits.
  const tamperLast = (cookie: string) => {
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const v = b64.indexOf(cookie.at(-1)!);
    return cookie.slice(0, -1) + (v >> 2 === 0 ? 'g' : 'A');
  };

  it('refuses a callback whose state does not match the signed cookie, before calling X', async () => {
    const roman = keypair();
    const session = await login(roman);
    const flow = await start(session);
    const cb = (query: string, cookie: string) =>
      viaWeb(`/api/v1/auth/x/callback?${query}`, cookie);

    // Cookie lost on the way back (proxy, other browser, blocked cookies).
    expect(location(await cb(`code=c&state=${flow.state}`, session))).toBe(
      `${APP_URL}/studio/profile?x=invalid&reason=state_missing`,
    );
    // Forged state.
    expect(location(await cb('code=c&state=forged', flow.cookie))).toBe(
      `${APP_URL}/studio/profile?x=invalid&reason=state_mismatch`,
    );
    // Tampered cookie (signature no longer matches).
    expect(location(await cb(`code=c&state=${flow.state}`, tamperLast(flow.cookie)))).toContain(
      'reason=state_mismatch',
    );
    // Someone else's sign-in replayed into this session.
    const other = await login(keypair());
    expect(
      location(await cb(`code=c&state=${flow.state}`, `${other}; ${flow.cookie.split('; ')[1]}`)),
    ).toContain('reason=state_mismatch');
    // No code.
    expect(location(await cb(`state=${flow.state}`, flow.cookie))).toBe(
      `${APP_URL}/studio/profile?x=invalid&reason=no_code`,
    );
    // The creator pressed Cancel on X.
    expect(location(await cb(`error=access_denied&state=${flow.state}`, flow.cookie))).toBe(
      `${APP_URL}/studio/profile?x=denied`,
    );
    // Older than 10 minutes.
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect(location(await cb(`code=c&state=${flow.state}`, flow.cookie))).toBe(
      `${APP_URL}/studio/profile?x=invalid&reason=state_expired`,
    );
    expect(xRequests).toHaveLength(0);
    expect(await xRow(roman)).toEqual({ x_handle: null, x_user_id: null });
  });

  it('sends a signed-out callback to the profile with a reason instead of a JSON 401', async () => {
    const back = await viaWeb('/api/v1/auth/x/callback?code=c&state=s');
    expect(back.status).toBe(302);
    expect(location(back)).toBe(`${APP_URL}/studio/profile?x=failed&reason=signed_out`);
    expect(xRequests).toHaveLength(0);
  });

  it('token exchange 401 (wrong client secret): token_rejected, users/me never called, nothing stored', async () => {
    tokenReply = {
      status: 401,
      json: {
        error: 'unauthorized_client',
        error_description: 'Missing valid authorization header',
      },
    };
    const roman = keypair();
    const flow = await start(await login(roman));
    const back = await viaWeb(
      `/api/v1/auth/x/callback?code=good-code&state=${flow.state}`,
      flow.cookie,
    );
    expect(location(back)).toBe(`${APP_URL}/studio/profile?x=failed&reason=token_rejected`);
    expect(xRequests.map((r) => r.path)).toEqual(['/2/oauth2/token']);
    expect(await xRow(roman)).toEqual({ x_handle: null, x_user_id: null });
  });

  it('token exchange 400 (code expired or reused): code_rejected', async () => {
    tokenReply = {
      status: 400,
      json: {
        error: 'invalid_request',
        error_description: 'Value passed for the authorization code was invalid.',
      },
    };
    const flow = await start(await login(keypair()));
    const back = await viaWeb(`/api/v1/auth/x/callback?code=used&state=${flow.state}`, flow.cookie);
    expect(location(back)).toBe(`${APP_URL}/studio/profile?x=failed&reason=code_rejected`);
  });

  it('token exchange without an access token: token_failed', async () => {
    tokenReply = { status: 200, json: { token_type: 'bearer' } };
    const flow = await start(await login(keypair()));
    const back = await viaWeb(`/api/v1/auth/x/callback?code=c&state=${flow.state}`, flow.cookie);
    expect(location(back)).toContain('reason=token_failed');
  });

  it('users/me 403 (X plan does not allow it): users_me_forbidden, nothing stored', async () => {
    meReply = {
      status: 403,
      json: {
        title: 'Forbidden',
        detail:
          'Your client app is not configured with the appropriate oauth1 app permissions for this endpoint.',
      },
    };
    const roman = keypair();
    const flow = await start(await login(roman));
    const back = await viaWeb(
      `/api/v1/auth/x/callback?code=good-code&state=${flow.state}`,
      flow.cookie,
    );
    expect(location(back)).toBe(`${APP_URL}/studio/profile?x=failed&reason=users_me_forbidden`);
    expect(await xRow(roman)).toEqual({ x_handle: null, x_user_id: null });
  });

  it('users/me 500 or an unreadable account: users_me_failed / bad_account', async () => {
    meReply = { status: 500, json: { title: 'oops' } };
    let flow = await start(await login(keypair()));
    expect(
      location(await viaWeb(`/api/v1/auth/x/callback?code=c&state=${flow.state}`, flow.cookie)),
    ).toContain('reason=users_me_failed');
    meReply = { status: 200, json: { data: { id: 'abc', username: 'not a handle!' } } };
    flow = await start(await login(keypair()));
    expect(
      location(await viaWeb(`/api/v1/auth/x/callback?code=c&state=${flow.state}`, flow.cookie)),
    ).toContain('reason=bad_account');
  });

  it('X unreachable: unreachable', async () => {
    const flow = await start(await login(keypair()));
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith(xUrl)
        ? Promise.reject(new TypeError('fetch failed'))
        : realFetch(input, init)) as typeof fetch;
    const back = await viaWeb(`/api/v1/auth/x/callback?code=c&state=${flow.state}`, flow.cookie);
    expect(location(back)).toContain('reason=unreachable');
  });

  it('an X account verified by another wallet is not taken over', async () => {
    const first = keypair();
    let flow = await start(await login(first));
    expect(
      location(await viaWeb(`/api/v1/auth/x/callback?code=c&state=${flow.state}`, flow.cookie)),
    ).toContain('x=linked');
    const second = keypair();
    flow = await start(await login(second));
    expect(
      location(await viaWeb(`/api/v1/auth/x/callback?code=c&state=${flow.state}`, flow.cookie)),
    ).toBe(`${APP_URL}/studio/profile?x=taken`);
    expect(await xRow(second)).toEqual({ x_handle: null, x_user_id: null });
  });
});
