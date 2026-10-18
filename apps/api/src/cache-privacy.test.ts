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
import { withEdgeCache } from './edge-cache';
import { readEnv } from './env';
import type { Deps } from './logic';

/**
 * Integration: the real app behind the edge cache exactly as worker.ts wires it, on a real
 * Postgres. Private and wallet-specific responses must never be stored in, or served from,
 * the shared cache; anonymous public reads are.
 */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const API = 'http://localhost:8787';
const now = new Date('2026-06-15T12:00:00.000Z');
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
const vault = randomKeypair();

let sql: Sql;
let deps: Deps;
type Wallet = { publicKey: string; secretKey: Uint8Array };

function keypair(): Wallet {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

/** The Cache API, in memory, recording every key written. */
function memoryCache() {
  const store = new Map<string, Response>();
  return {
    store,
    async match(request: Request) {
      return store.get(request.url)?.clone();
    },
    async put(request: Request, response: Response) {
      store.set(request.url, response);
    },
  };
}

async function edge() {
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
    API_URL: API,
  });
  deps = {
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
  };
  const app = createApp(deps);
  const cache = memoryCache();
  const pending: Promise<unknown>[] = [];
  const fetch = async (path: string, init: RequestInit = {}) => {
    const request = new Request(`${API}/api/v1${path}`, init);
    const res = await withEdgeCache(
      request,
      async () => app.fetch(request.clone()),
      (p) => pending.push(p),
      cache,
    );
    await Promise.all(pending.splice(0));
    return res;
  };
  return { fetch, cache, app };
}

async function signIn(fetch: Awaited<ReturnType<typeof edge>>['fetch'], wallet: Wallet) {
  const nonce = await fetch('/auth/nonce', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey }),
  });
  const { message } = (await nonce.json()) as { message: string };
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey),
  );
  const verified = await fetch('/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.publicKey, signature }),
  });
  expect(verified.status).toBe(200);
  // A response that sets the session cookie is never shared.
  expect(verified.headers.get('cache-control')).toMatch(/private|no-store/);
  return verified.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function liveListing(creatorId: string, slug: string) {
  const listingId = randomUUID();
  const versionId = randomUUID();
  await sql`
    insert into listings (id, creator_id, slug, title, summary, description, category, price, created_at)
    values (${listingId}, ${creatorId}, ${slug}, ${'Pack ' + slug}, 'Sum', 'Desc', 'userscript',
      ${1_000_000_000n}, ${new Date(now.getTime() - 3_600_000)})
  `;
  await sql`
    insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
    values (${versionId}, ${listingId}, '1.0.0', 'pack.user.js', 5, ${'sha' + versionId}, 'blobs/x', 'live')
  `;
  await sql`update listings set live_version_id = ${versionId}, first_live_at = ${now} where id = ${listingId}`;
  return listingId;
}

const isPrivate = (res: Response) =>
  /private|no-store/.test(res.headers.get('cache-control') ?? '') &&
  !/public|s-maxage/.test(res.headers.get('cache-control') ?? '');

afterAll(async () => {
  await sql?.end();
});

describe('edge cache privacy (integration)', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`
      truncate table audit_log, ledger, notifications, downloads, listing_reviews, review_replies,
        review_votes, review_reports, wallet_intel, listing_upvotes, creator_rank, disputes,
        licenses, payouts, update_renewals, orders, versions, listing_media, listing_content,
        listings, ops_events, ops_alerts, auth_nonces, users
      restart identity cascade
    `;
  });

  it('never stores signed-in reads, and wallet-specific routes are private', async () => {
    const { fetch, cache } = await edge();
    const wallet = keypair();
    const cookie = await signIn(fetch, wallet);
    for (const path of [
      '/me',
      '/me/orders',
      '/me/reviews',
      '/studio/overview',
      '/studio/listings',
      '/studio/profile',
      '/studio/payouts',
    ]) {
      const res = await fetch(path, { headers: { cookie } });
      expect(res.status, path).toBe(200);
      expect(isPrivate(res), `${path}: ${res.headers.get('cache-control')}`).toBe(true);
      expect(res.headers.get('x-edge-cache'), path).toBeNull();
    }
    // The same wallet-specific routes without a cookie are 401s, also never stored.
    for (const path of ['/me/orders', '/studio/overview']) {
      const res = await fetch(path);
      expect(res.status, path).toBe(401);
      expect(isPrivate(res), path).toBe(true);
    }
    expect(cache.store.size).toBe(0);
  });

  it('a signed-in viewer never gets, or seeds, the shared copy of a public read', async () => {
    const { fetch, cache } = await edge();
    const creator = keypair();
    const cookie = await signIn(fetch, creator);
    const [row] = await sql<
      { id: string }[]
    >`select id from users where wallet = ${creator.publicKey}`;
    await liveListing(row!.id, 'sniper');

    // Signed in first: answered fresh and private, nothing stored.
    const mine = await fetch('/listings/sniper', { headers: { cookie } });
    expect(mine.status).toBe(200);
    expect(isPrivate(mine)).toBe(true);
    expect(mine.headers.get('x-edge-cache')).toBeNull();
    expect(cache.store.size).toBe(0);

    // Anonymous: stored and shared.
    const anon = await fetch('/listings/sniper');
    expect(anon.headers.get('x-edge-cache')).toBe('MISS');
    expect(anon.headers.get('cache-control')).toMatch(/^public/);
    expect(cache.store.size).toBe(1);
    expect((await fetch('/listings/sniper')).headers.get('x-edge-cache')).toBe('HIT');

    // Signed in again: still bypasses the stored copy.
    const again = await fetch('/listings/sniper', { headers: { cookie } });
    expect(again.headers.get('x-edge-cache')).toBeNull();
    expect(isPrivate(again)).toBe(true);
    // A bearer token is treated like a session.
    const bearer = await fetch('/listings/sniper', { headers: { authorization: 'Bearer x' } });
    expect(bearer.headers.get('x-edge-cache')).toBeNull();
    // Nothing stored is keyed by, or carries, the session.
    for (const [key, res] of cache.store) {
      expect(key).not.toContain('tm_session');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('a draft image the owner previews is private and never stored', async () => {
    const { fetch, cache } = await edge();
    const creator = keypair();
    const cookie = await signIn(fetch, creator);
    const [row] = await sql<
      { id: string }[]
    >`select id from users where wallet = ${creator.publicKey}`;
    const listingId = await liveListing(row!.id, 'with-draft-image');
    const mediaId = randomUUID();
    const key = `media/${mediaId}`;
    await deps.blob.put(key, new Uint8Array([0x52, 0x49, 0x46, 0x46]));
    await sql`
      insert into listing_media (id, listing_id, r2_key, sort, sha256, mime, width, height, bytes)
      values (${mediaId}, ${listingId}, ${key}, 0, 'abc', 'image/webp', 1, 1, 4)
    `;
    const owner = await fetch(`/media/${mediaId}`, { headers: { cookie } });
    expect(owner.status).toBe(200);
    expect(isPrivate(owner)).toBe(true);
    // Not on an approved page: anonymous readers get a 404, which is not stored either.
    const anon = await fetch(`/media/${mediaId}`);
    expect(anon.status).toBe(404);
    expect(cache.store.size).toBe(0);
  });
});
