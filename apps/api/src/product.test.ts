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

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const now = new Date('2026-06-01T00:00:00.000Z');
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
const vault = randomKeypair();

const clean = `// ==UserScript==
// @name Sniper Filter Pack v2
// @match https://axiom.trade/*
// @grant none
// ==/UserScript==
console.log('sniper');
`;

let sql: Sql;

async function reset() {
  await sql`
    truncate table
      audit_log, ledger, notifications, downloads, listing_reviews, disputes, licenses, payouts,
      orders, scan_checks, scans, ai_reviews, sandbox_jobs, listing_media, versions, listings,
      bonds, token_balances, auth_nonces, reports, buybacks, rate_buckets, users
    restart identity cascade
  `;
}

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

async function appFor() {
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
  return createApp({
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
  });
}

async function login(app: ReturnType<typeof createApp>, wallet: ReturnType<typeof keypair>) {
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

describe('owner product decisions', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await reset();
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('mocks landing stats until a live listing exists, and serves the cached SOL price', async () => {
    const app = await appFor();
    const stats = (await (await app.request('/api/v1/stats')).json()) as {
      source: string;
      volume: { usdCents: string };
    };
    expect(stats.source).toBe('mock');
    expect(stats.volume.usdCents).toBe('115000');
    const price = (await (await app.request('/api/v1/prices/sol')).json()) as {
      source: string;
      centsPerSol: string;
    };
    expect(price).toEqual({
      centsPerSol: '10000',
      source: 'override',
      fetchedAt: now.toISOString(),
    });
    const top = await app.request('/api/v1/creators/top');
    expect(top.status).toBe(200);
    expect(Array.isArray(await top.json())).toBe(true);
  });

  it('issues a signed download only after escrow release', async () => {
    const app = await appFor();
    const buyer = keypair();
    const cookie = await login(app, buyer);
    const me = (await (await app.request('/api/v1/me', { headers: { cookie } })).json()) as {
      user: { id: string };
    };
    const creator = randomKeypair();
    const creatorId = randomUUID();
    const listingId = randomUUID();
    const versionId = randomUUID();
    const orderId = randomUUID();
    await sql`
      insert into users (id, wallet, roles) values (${creatorId}, ${creator.publicKey}, ${sql.array(['creator'])}::user_role[])
    `;
    await sql`
      insert into listings (id, creator_id, slug, title, summary, description, category, price, live_version_id)
      values (${listingId}, ${creatorId}, 'pack', 'Pack', 'Sum', 'Desc', 'userscript', ${1_000_000_000n}, null)
    `;
    await sql`
      insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
      values (${versionId}, ${listingId}, '1.0.0', 'pack.user.js', 5, 'abc', ${'blobs/abc'}, 'live')
    `;
    await sql`update listings set live_version_id = ${versionId}, first_live_at = ${now} where id = ${listingId}`;
    const blobKey = 'blobs/abc';
    const dirNote = await app.request('/api/v1/files?key=missing&exp=1&sig=no');
    expect(dirNote.status).toBe(401);
    await sql`
      insert into orders (
        id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
        tier_at_purchase, memo, status, paid_at, escrow_until, expires_at
      ) values (
        ${orderId}, ${me.user.id}, ${listingId}, ${versionId}, ${1_000_000_000n}, 500, 0, 0, 0, ${1_000_000_000n},
        'none', ${'tm:' + orderId.slice(0, 8)}, 'paid', ${now}, ${new Date(now.getTime() + 86_400_000)}, ${now}
      )
    `;
    await sql`insert into licenses (order_id, wallet) values (${orderId}, ${buyer.publicKey})`;
    const locked = await app.request(`/api/v1/orders/${orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(locked.status).toBe(403);
    const lockedBody = (await locked.json()) as { error: { code: string }; url?: string };
    expect(lockedBody.error.code).toBe('ESCROW_LOCKED');
    expect(lockedBody.url).toBeUndefined();
    await sql`update orders set status = 'disputed' where id = ${orderId}`;
    const disputed = await app.request(`/api/v1/orders/${orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(disputed.status).toBe(403);
    await sql`update orders set status = 'released', released_at = ${now} where id = ${orderId}`;
    const env = readEnv({
      API_URL: 'http://localhost:8787',
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
    });
    const blob = filesystemBlob(
      await mkdtemp(join(tmpdir(), 'tm-file-')),
      env.sessionSecret,
      env.apiUrl,
    );
    await blob.put(blobKey, new TextEncoder().encode(clean));
    const releasedApp = createApp({
      sql,
      blob,
      env: readEnv({
        SOLANA_CLUSTER: 'devnet',
        VAULT_ADDRESS: vault.publicKey,
        SESSION_SECRET: 'test-secret-test-secret-test-secret',
        AI_ATTEST_SECRET: 'attest-secret',
        SOL_USD_OVERRIDE: '100',
        API_URL: 'http://localhost:8787',
        RATE_LIMIT_PER_MIN: '1000',
      }),
      now: () => now,
      getTx: async () => null,
      blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    });
    const open = await releasedApp.request(`/api/v1/orders/${orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(open.status).toBe(200);
    const body = (await open.json()) as { url: string };
    expect(body.url).toContain('sig=');
    const live = (await (await releasedApp.request('/api/v1/stats')).json()) as { source: string };
    expect(live.source).toBe('live');
  });

  it('runs AI review immediately and streams progress, with no human queue', async () => {
    const app = await appFor();
    const creator = keypair();
    const cookie = await login(app, creator);
    await sql`
      update users set roles = roles || '{creator}'::user_role[], x_handle = 'dev_degen', x_user_id = 'dev:dev_degen'
      where wallet = ${creator.publicKey}
    `;
    const user = await sql<
      { id: string }[]
    >`select id from users where wallet = ${creator.publicKey}`;
    const userId = user[0]?.id;
    if (!userId) throw new Error('creator missing after login');
    await sql`
      insert into bonds (user_id, amount, tx_sig, status) values (${userId}, ${5_000_000_000n}, ${bs58.encode(nacl.randomBytes(64))}, 'active')
    `;
    await sql`update config set value = '0'::jsonb where key = 'verification_fee_lamports'`;
    const listing = await app.request('/api/v1/studio/listings', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Sniper Filter Pack',
        summary: 'Scoped filters for new pairs.',
        description: 'No wallet access.',
        category: 'userscript',
        priceLamports: '1500000000',
      }),
    });
    expect(listing.status).toBe(200);
    const created = (await listing.json()) as { id: string };
    const version = await app.request(`/api/v1/studio/listings/${created.id}/versions`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        semver: '1.0.0',
        changelog: 'first',
        fileName: 'sniper.user.js',
        fileSize: clean.length,
      }),
    });
    expect(version.status).toBe(200);
    const uploaded = (await version.json()) as { versionId: string; uploadUrl: string };
    const target = new URL(uploaded.uploadUrl);
    const put = await app.request(`${target.pathname}${target.search}`, {
      method: 'PUT',
      body: new TextEncoder().encode(clean),
    });
    expect(put.status).toBe(200);
    const streamed = await app.request(
      `/api/v1/studio/versions/${uploaded.versionId}/complete?stream=1`,
      {
        method: 'POST',
        headers: { cookie, accept: 'text/event-stream' },
      },
    );
    expect(streamed.status).toBe(200);
    const text = await streamed.text();
    expect(text).toContain('event: static');
    expect(text).toContain('event: sandbox');
    expect(text).toContain('event: ai');
    expect(text).toContain('"versionStatus":"live"');
    expect(text).toContain('"durationMs"');
    expect(text).toContain('"egress":"blocked"');
    const queued = await sql<{ count: number }[]>`select count(*)::int as count from sandbox_jobs`;
    expect(queued[0]?.count).toBe(0);
    const human = await app.request(
      '/api/v1/review/versions/00000000-0000-0000-0000-000000000001/decide',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approve',
          notes: 'a human should not be able to do this',
          signature: 'x',
        }),
      },
    );
    expect(human.status).toBe(404);
    const unsigned = await app.request('/api/v1/tx/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txBase64: 'aa' }),
    });
    expect(unsigned.status).toBe(401);
    const missing = await app.request('/api/v1/creators/nobody');
    expect(missing.status).toBe(404);
    const queue = await app.request('/api/v1/internal/sandbox/next', {
      headers: { authorization: 'internal' },
    });
    const queueBody = (await queue.json()) as { queued: boolean };
    expect(queueBody.queued).toBe(false);
    await sql`update versions set status = 'needs_creator', resume_step = 'sandbox' where id = ${uploaded.versionId}`;
    const resumed = await app.request(
      `/api/v1/studio/versions/${uploaded.versionId}/review?stream=1`,
      {
        method: 'POST',
        headers: { cookie, accept: 'text/event-stream' },
      },
    );
    expect(resumed.status).toBe(200);
    const again = await resumed.text();
    expect(again).toContain('"step":"static"');
    expect(again).toContain('"status":"skipped"');
    expect(again).toContain('event: sandbox');
  });

  it('lets a new creator list once the category bond is met, and keeps the fee gate', async () => {
    const app = await appFor();
    const creator = keypair();
    const cookie = await login(app, creator);
    await sql`update users set x_handle = 'new_creator', x_user_id = 'dev:new_creator' where wallet = ${creator.publicKey}`;
    const json = { cookie, 'content-type': 'application/json' };
    await sql`update config set value = '250000000'::jsonb where key = 'verification_fee_lamports'`;
    const listingJson = JSON.stringify({
      title: 'Fresh Filter',
      summary: 'A first listing.',
      description: 'No wallet access.',
      category: 'filter',
      priceLamports: '1000000000',
    });

    // Requirements must not say "bond OK" while creating a listing still needs one.
    const before = (await (
      await app.request('/api/v1/studio/requirements', { headers: { cookie } })
    ).json()) as { creator: boolean; bondRequired: string; bondOk: boolean };
    expect(before.creator).toBe(false);
    expect(BigInt(before.bondRequired)).toBeGreaterThan(0n);
    expect(before.bondOk).toBe(false);

    // Regression: this was 403 "creator role required", a role no endpoint could grant.
    const blocked = await app.request('/api/v1/studio/listings', {
      method: 'POST',
      headers: json,
      body: listingJson,
    });
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'BOND_REQUIRED',
    );

    const user = await sql<
      { id: string }[]
    >`select id from users where wallet = ${creator.publicKey}`;
    await sql`
      insert into bonds (user_id, amount, tx_sig, status)
      values (${user[0]!.id}, ${BigInt(before.bondRequired)}, ${bs58.encode(nacl.randomBytes(64))}, 'active')
    `;
    const after = (await (
      await app.request('/api/v1/studio/requirements', { headers: { cookie } })
    ).json()) as { bondOk: boolean };
    expect(after.bondOk).toBe(true);

    const created = await app.request('/api/v1/studio/listings', {
      method: 'POST',
      headers: json,
      body: listingJson,
    });
    expect(created.status).toBe(200);
    const listing = (await created.json()) as { id: string };
    const roles = await sql<
      { roles: string[] }[]
    >`select roles from users where id = ${user[0]!.id}`;
    expect(roles[0]?.roles).toContain('creator');

    const version = await app.request(`/api/v1/studio/listings/${listing.id}/versions`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        semver: '1.0.0',
        changelog: 'first',
        fileName: 'sniper.user.js',
        fileSize: clean.length,
      }),
    });
    expect(version.status).toBe(200);
    const issued = (await version.json()) as {
      versionId: string;
      verificationFee: string;
      feeTx: { txBase64: string } | null;
    };
    expect(BigInt(issued.verificationFee)).toBeGreaterThan(0n);
    expect(issued.feeTx?.txBase64).toBeTruthy();

    const unpaid = await app.request(`/api/v1/studio/versions/${issued.versionId}/complete`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(unpaid.status).toBe(400);
    expect(((await unpaid.json()) as { error: { code: string } }).error.code).toBe('FEE_REQUIRED');

    // The client retries with a fresh fee transaction (the first blockhash may have expired).
    const fresh = (await (
      await app.request(`/api/v1/studio/versions/${issued.versionId}/fee-tx`, {
        method: 'POST',
        headers: { cookie },
      })
    ).json()) as { paid: boolean; feeTx: { txBase64: string } | null };
    expect(fresh.paid).toBe(false);
    expect(fresh.feeTx?.txBase64).toBeTruthy();

    await sql`update versions set vfee_sig = ${bs58.encode(nacl.randomBytes(64))} where id = ${issued.versionId}`;
    const settled = (await (
      await app.request(`/api/v1/studio/versions/${issued.versionId}/fee-tx`, {
        method: 'POST',
        headers: { cookie },
      })
    ).json()) as { paid: boolean; feeTx: unknown };
    expect(settled).toMatchObject({ paid: true, feeTx: null });
  });

  it('rejects with the exact reason and refuses a human appeal', async () => {
    const app = await appFor();
    const creator = keypair();
    const cookie = await login(app, creator);
    await sql`
      update users set roles = roles || '{creator}'::user_role[], x_handle = 'dev_degen', x_user_id = 'dev:dev_degen'
      where wallet = ${creator.publicKey}
    `;
    const user = await sql<
      { id: string }[]
    >`select id from users where wallet = ${creator.publicKey}`;
    const userId = user[0]?.id;
    if (!userId) throw new Error('creator missing after login');
    await sql`
      insert into bonds (user_id, amount, tx_sig, status) values (${userId}, ${5_000_000_000n}, ${bs58.encode(nacl.randomBytes(64))}, 'active')
    `;
    await sql`update config set value = '0'::jsonb where key = 'verification_fee_lamports'`;
    const hostile = `${clean}\nwindow.solana.signTransaction({ tx: 1 });\n`;
    const listing = await app.request('/api/v1/studio/listings', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Hostile pack',
        summary: 'Should be rejected.',
        description: 'Signing call.',
        category: 'userscript',
        priceLamports: '1000000000',
      }),
    });
    const created = (await listing.json()) as { id: string };
    const version = await app.request(`/api/v1/studio/listings/${created.id}/versions`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        semver: '1.0.0',
        changelog: 'bad',
        fileName: 'bad.user.js',
        fileSize: hostile.length,
      }),
    });
    const uploaded = (await version.json()) as { versionId: string; uploadUrl: string };
    const target = new URL(uploaded.uploadUrl);
    await app.request(`${target.pathname}${target.search}`, {
      method: 'PUT',
      body: new TextEncoder().encode(hostile),
    });
    const streamed = await app.request(
      `/api/v1/studio/versions/${uploaded.versionId}/complete?stream=1`,
      {
        method: 'POST',
        headers: { cookie, accept: 'text/event-stream' },
      },
    );
    const text = await streamed.text();
    expect(text).toContain('"versionStatus":"rejected"');
    expect(text).toContain('signTransaction');
    const appeal = await app.request(`/api/v1/studio/versions/${uploaded.versionId}/appeal`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(appeal.status).toBe(404);
  });
});
