import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import {
  decodeEscrow,
  encodeEscrowForTest,
  escrowAddress,
  fromBase64,
  orderIdBytes,
  randomKeypair,
  type EscrowStatusName,
} from '@trenchmart/chain';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { EscrowChain } from './escrow';
import { releaseOrders, resolveDispute } from './logic';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';

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
      orders, scan_checks, scans, ai_reviews, sandbox_jobs, listing_content, listing_media, versions, listings,
      bonds, token_balances, auth_nonces, reports, buybacks, rate_buckets, users
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

  it('issues a signed download once paid in escrow, never during a dispute', async () => {
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
    const pending = await app.request(`/api/v1/orders/${orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    // Paid with the file missing from this app's blob dir: past the escrow gate, 404 on the file.
    expect(pending.status).toBe(404);
    await sql`update orders set status = 'pending' where id = ${orderId}`;
    const unpaid = await app.request(`/api/v1/orders/${orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(unpaid.status).toBe(403);
    const unpaidBody = (await unpaid.json()) as { error: { code: string }; url?: string };
    expect(unpaidBody.error.code).toBe('ESCROW_LOCKED');
    expect(unpaidBody.url).toBeUndefined();
    await sql`update orders set status = 'disputed', disputed_from = 'paid' where id = ${orderId}`;
    const disputed = await app.request(`/api/v1/orders/${orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(disputed.status).toBe(403);
    expect(((await disputed.json()) as { error: { message: string } }).error.message).toMatch(
      /dispute/,
    );
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
    await sql`update orders set status = 'paid', released_at = null where id = ${orderId}`;
    const paidOpen = await releasedApp.request(`/api/v1/orders/${orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(paidOpen.status).toBe(200);
    expect(((await paidOpen.json()) as { url: string }).url).toContain('sig=');
    // Downloading does not move funds: the order is still paid and in its escrow window.
    const still = await sql<{ status: string }[]>`select status from orders where id = ${orderId}`;
    expect(still[0]?.status).toBe('paid');
    await sql`update orders set status = 'released', released_at = ${now} where id = ${orderId}`;
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

  it('reviews seller pages before they go public and serves only clean, approved images', async () => {
    const app = await appFor();
    const seller = keypair();
    const cookie = await login(app, seller);
    const sellerId = (
      await sql<{ id: string }[]>`select id from users where wallet = ${seller.publicKey}`
    )[0]!.id;
    const listingId = randomUUID();
    const versionId = randomUUID();
    await sql`
      insert into listings (id, creator_id, slug, title, summary, description, category, price)
      values (${listingId}, ${sellerId}, 'rich', 'Rich Pack', 'Sum', 'Desc', 'userscript', ${1_000_000_000n})
    `;
    await sql`
      insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
      values (${versionId}, ${listingId}, '1.0.0', 'rich.user.js', 5, 'abc', 'blobs/abc', 'live')
    `;
    await sql`update listings set live_version_id = ${versionId}, first_live_at = ${now} where id = ${listingId}`;
    const json = { cookie, 'content-type': 'application/json' };
    const base = `/api/v1/studio/listings/${listingId}`;

    // A stranger cannot read or edit the page.
    const stranger = await login(app, keypair());
    expect((await app.request(`${base}/content`, { headers: { cookie: stranger } })).status).toBe(
      404,
    );
    expect(
      (await app.request(`/api/v1/studio/listings/not-a-uuid/content`, { headers: { cookie } }))
        .status,
    ).toBe(404);

    // Uploads: type comes from the bytes, metadata is stripped, junk is refused.
    const png = new Uint8Array(
      readFileSync(new URL('../../../packages/scanner/src/__fixtures__/meta.png', import.meta.url)),
    );
    const jpg = new Uint8Array(
      readFileSync(new URL('../../../packages/scanner/src/__fixtures__/exif.jpg', import.meta.url)),
    );
    const upload = (body: Uint8Array, type: string) =>
      app.request(`${base}/images`, {
        method: 'POST',
        headers: { cookie, 'content-type': type },
        body,
      });
    const html = await upload(new TextEncoder().encode('<svg onload=alert(1)></svg>'), 'image/png');
    expect(html.status).toBe(400);
    expect(((await html.json()) as { error: { code: string } }).error.code).toBe('IMAGE_TYPE');
    const big = await upload(new Uint8Array(3 * 1024 * 1024 + 1), 'image/png');
    expect(big.status).toBe(413);
    // No content-length (chunked): the limit still holds while streaming.
    const chunked = await app.request(`${base}/images`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png' },
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(chunked.status).toBe(413);
    const first = (await (await upload(png, 'image/jpeg')).json()) as {
      id: string;
      mime: string;
      url: string;
    };
    expect(first.mime).toBe('image/png');
    const second = (await (await upload(jpg, 'image/png')).json()) as { id: string; mime: string };
    expect(second.mime).toBe('image/jpeg');

    // Drafts are private: the owner can preview images, the public cannot.
    expect((await app.request(first.url)).status).toBe(404);
    const ownerView = await app.request(first.url, { headers: { cookie } });
    expect(ownerView.status).toBe(200);
    expect(ownerView.headers.get('cache-control')).toBe('private, no-store');
    const ownerJpg = new Uint8Array(
      await (
        await app.request(`/api/v1/media/${second.id}`, { headers: { cookie } })
      ).arrayBuffer(),
    );
    expect(Buffer.from(ownerJpg).includes('Exif')).toBe(false);
    expect(Buffer.from(ownerJpg).includes('LEAK')).toBe(false);

    // Gallery rules.
    const put = (body: unknown) =>
      app.request(`${base}/content`, { method: 'PUT', headers: json, body: JSON.stringify(body) });
    expect((await put({ gallery: [{ imageId: randomUUID(), alt: '' }] })).status).toBe(400);
    expect((await put({ gallery: [{ imageId: first.id }], coverImageId: second.id })).status).toBe(
      400,
    );
    expect((await put({ gallery: [{ imageId: first.id }, { imageId: first.id }] })).status).toBe(
      400,
    );

    // Phishing is rejected and nothing goes public.
    const phish = await put({
      readme: 'Claim at [phantom](https://phant0m.app/claim)\n\n<script>alert(1)</script>',
      gallery: [],
    });
    expect(phish.status).toBe(200);
    const rejected = (await (
      await app.request(`${base}/content/review`, { method: 'POST', headers: json })
    ).json()) as {
      status: string;
      checks: { ruleId: string; result: string }[];
    };
    expect(rejected.status).toBe('rejected');
    expect(rejected.checks.find((c) => c.ruleId === 'content-phishing')?.result).toBe('fail');
    expect(rejected.checks.find((c) => c.ruleId === 'content-html')?.result).toBe('fail');
    const hidden = (await (await app.request('/api/v1/listings/rich')).json()) as {
      content: unknown;
    };
    expect(hidden.content).toBeNull();

    // A warning needs an explanation, then the page goes live.
    const readme = [
      '# Rich Pack',
      `![shot](/api/v1/media/${second.id})`,
      '<b>inline html shows as text</b>',
      '[docs](http://example.com/docs)',
    ].join('\n\n');
    await put({
      readme,
      howto: 'Install Tampermonkey, then open the file.',
      requirements: 'Chrome',
      gallery: [
        { imageId: first.id, alt: 'Overlay' },
        { imageId: second.id, alt: 'Settings' },
      ],
      coverImageId: second.id,
    });
    const asks = (await (
      await app.request(`${base}/content/review`, { method: 'POST', headers: json, body: '{}' })
    ).json()) as {
      status: string;
    };
    expect(asks.status).toBe('needs_changes');
    const live = (await (
      await app.request(`${base}/content/review`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ note: 'The docs site has no TLS; the link is informational only.' }),
      })
    ).json()) as { status: string; review: { decision: string } };
    expect(live).toMatchObject({ status: 'live', review: { decision: 'approve' } });
    const attested = await sql<{ review: { attestation: string; signature: string } }[]>`
      select review from listing_content where listing_id = ${listingId}
    `;
    expect(attested[0]?.review.attestation).toMatch(
      new RegExp(`^trenchmart-ai-attest:v1:content-${listingId}:[0-9a-f]{64}:approve:`),
    );

    const page = (await (await app.request('/api/v1/listings/rich')).json()) as {
      content: { readme: string; gallery: { id: string; url: string; alt: string }[] };
    };
    expect(page.content.readme).toBe(readme); // stored as source; the renderer turns HTML into text
    expect(page.content.gallery.map((g) => g.id)).toEqual([second.id, first.id]); // cover first
    const pub = await app.request(`/api/v1/media/${second.id}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('content-type')).toBe('image/jpeg');
    expect(pub.headers.get('x-content-type-options')).toBe('nosniff');
    expect(pub.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(pub.headers.get('cache-control')).toBe('public, max-age=86400');

    const market = (await (await app.request('/api/v1/listings')).json()) as {
      slug: string;
      cover: { url: string } | null;
      imageCount: number;
    }[];
    const card = market.find((item) => item.slug === 'rich');
    expect(card?.cover?.url).toBe(`/api/v1/media/${second.id}`);
    expect(card?.imageCount).toBe(2);

    // Editing the draft does not change the live page, and live images cannot be deleted.
    await put({ readme: 'draft only', gallery: [{ imageId: first.id }] });
    expect(
      (
        (await (await app.request('/api/v1/listings/rich')).json()) as {
          content: { readme: string };
        }
      ).content.readme,
    ).toBe(readme);
    const del = await app.request(`${base}/images/${second.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(409);
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
  it('builds the bond transaction before writing a pending row', async () => {
    let fail = true;
    const app = await appFor(
      {},
      {
        blockhash: async () => {
          if (fail) throw new Error('rpc down');
          return { blockhash, lastValidBlockHeight: 1 };
        },
      },
    );
    const creator = keypair();
    const cookie = await login(app, creator);
    const json = { cookie, 'content-type': 'application/json' };
    const broken = await app.request('/api/v1/studio/bond', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ amount: '1000000000' }),
    });
    expect(broken.status).toBe(500);
    expect((await sql`select id from bonds`).length).toBe(0);
    fail = false;
    const ok = await app.request('/api/v1/studio/bond', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ amount: '1000000000' }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { bondId: string; memo: string; txBase64: string };
    const rows = await sql<{ id: string; status: string }[]>`select id, status from bonds`;
    expect(rows).toEqual([{ id: body.bondId, status: 'pending' }]);
    expect(body.memo).toBe(`bond:${body.bondId.replace(/-/g, '').slice(0, 8)}`);
    expect(body.txBase64).toBeTruthy();
  });

  it('turns a sandbox infrastructure failure into a retryable review, not a verdict', async () => {
    const runner = createServer((_req, res) => {
      res.writeHead(502);
      res.end('bad gateway');
    });
    await new Promise<void>((resolve) => runner.listen(0, '127.0.0.1', () => resolve()));
    const address = runner.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    try {
      const shared = await mkdtemp(join(tmpdir(), 'tm-retry-'));
      const app = await appFor(
        { SANDBOX_RUNNER_URL: `http://127.0.0.1:${address.port}` },
        {},
        shared,
      );
      const creator = keypair();
      const cookie = await login(app, creator);
      await sql`
        update users set roles = roles || '{creator}'::user_role[], x_handle = 'dev_degen', x_user_id = 'dev:dev_degen'
        where wallet = ${creator.publicKey}
      `;
      const user = await sql<
        { id: string }[]
      >`select id from users where wallet = ${creator.publicKey}`;
      await sql`
        insert into bonds (user_id, amount, tx_sig, status) values (${user[0]!.id}, ${5_000_000_000n}, ${bs58.encode(nacl.randomBytes(64))}, 'active')
      `;
      await sql`update config set value = '0'::jsonb where key = 'verification_fee_lamports'`;
      const listing = await app.request('/api/v1/studio/listings', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Retry pack',
          summary: 'Sandbox infra test.',
          description: 'No wallet access.',
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
          changelog: 'x',
          fileName: 'r.user.js',
          fileSize: clean.length,
        }),
      });
      const uploaded = (await version.json()) as { versionId: string; uploadUrl: string };
      const target = new URL(uploaded.uploadUrl);
      await app.request(`${target.pathname}${target.search}`, {
        method: 'PUT',
        body: new TextEncoder().encode(clean),
      });
      const streamed = await app.request(
        `/api/v1/studio/versions/${uploaded.versionId}/complete?stream=1`,
        { method: 'POST', headers: { cookie, accept: 'text/event-stream' } },
      );
      const text = await streamed.text();
      expect(text).toContain('"decision":"retry"');
      expect(text).toContain('"verdict":"error"');
      expect(text).not.toContain('event: ai');
      const row = await sql<{ status: string; resume_step: string }[]>`
        select status, resume_step from versions where id = ${uploaded.versionId}
      `;
      expect(row[0]).toEqual({ status: 'needs_creator', resume_step: 'sandbox' });
      expect(
        (await sql`select 1 from ai_reviews where version_id = ${uploaded.versionId}`).length,
      ).toBe(0);
      expect(
        (
          await sql`select 1 from scans where version_id = ${uploaded.versionId} and kind = 'sandbox'`
        ).length,
      ).toBe(0);
      // Retry once the sandbox is healthy (inline QuickJS): the review completes normally.
      const healthy = await appFor({}, {}, shared);
      const retried = await healthy.request(
        `/api/v1/studio/versions/${uploaded.versionId}/review?stream=1`,
        { method: 'POST', headers: { cookie, accept: 'text/event-stream' } },
      );
      const again = await retried.text();
      expect(again).toContain('"versionStatus":"live"');
      const checks = await sql<{ rule_id: string; result: string }[]>`
        select sc.rule_id, sc.result from scan_checks sc join scans s on s.id = sc.scan_id
        where s.version_id = ${uploaded.versionId} and s.kind = 'sandbox'
      `;
      expect(checks).toContainEqual({ rule_id: 'sandbox-runtime', result: 'pass' });
    } finally {
      await new Promise<void>((resolve) => runner.close(() => resolve()));
    }
  });

  it('settles orders through the on-chain escrow: verify, release, dispute and refund', async () => {
    const programId = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
    const resolver = nacl.sign.keyPair();
    const resolverPub = bs58.encode(resolver.publicKey);
    const buckets = [randomKeypair(), randomKeypair(), randomKeypair(), randomKeypair()].map(
      (k) => k.publicKey,
    );
    const accounts = new Map<string, Uint8Array>();
    const sent: { tx: Uint8Array; effect: EscrowStatusName }[] = [];
    let effect: EscrowStatusName = 'released';
    const chain: EscrowChain = {
      async account(address) {
        const data = accounts.get(address);
        return data ? { data, owner: programId, lamports: 1n } : null;
      },
      async sendAndConfirm(tx) {
        // The resolver must sign the message: [1 sig][64 sig bytes][message].
        expect(tx[0]).toBe(1);
        const message = tx.subarray(65);
        expect(nacl.sign.detached.verify(message, tx.subarray(1, 65), resolver.publicKey)).toBe(
          true,
        );
        sent.push({ tx, effect });
        for (const [address, data] of accounts) {
          const account = decodeEscrow(data);
          if (account.status === 'paid' || account.status === 'disputed')
            accounts.set(address, encodeEscrowForTest({ ...account, status: effect }));
        }
        return bs58.encode(nacl.randomBytes(64));
      },
    };
    let clock = now;
    const txs = new Map<string, { memos: string[]; err: unknown }>();
    const env = readEnv({
      SOLANA_CLUSTER: 'devnet',
      VAULT_ADDRESS: vault.publicKey,
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
      AI_ATTEST_SECRET: 'attest-secret',
      SOL_USD_OVERRIDE: '100',
      RATE_LIMIT_PER_MIN: '1000',
      API_URL: 'http://localhost:8787',
      ESCROW_PROGRAM_ID: programId,
      ESCROW_RESOLVER: resolverPub,
      ESCROW_RESOLVER_SECRET: bs58.encode(resolver.secretKey),
      BUCKET_WALLET_BUYBACK: buckets[0]!,
      BUCKET_WALLET_AI_VERIFICATION: buckets[1]!,
      BUCKET_WALLET_OPS: buckets[2]!,
      BUCKET_WALLET_SAFETY: buckets[3]!,
    });
    const blob = filesystemBlob(
      await mkdtemp(join(tmpdir(), 'tm-esc-')),
      env.sessionSecret,
      env.apiUrl,
    );
    const deps: Deps = {
      sql,
      blob,
      env,
      now: () => clock,
      getTx: async (signature) => {
        const known = txs.get(signature);
        return known
          ? {
              signature,
              err: known.err,
              blockTime: Math.floor(clock.getTime() / 1000),
              confirmationStatus: 'confirmed',
              transfers: [],
              memos: known.memos,
            }
          : null;
      },
      blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
      escrowChain: chain,
    };
    const app = createApp(deps);
    const buyer = keypair();
    const cookie = await login(app, buyer);
    const seller = randomKeypair();
    const creatorId = randomUUID();
    const listingId = randomUUID();
    const versionId = randomUUID();
    await sql`insert into users (id, wallet, roles) values (${creatorId}, ${seller.publicKey}, ${sql.array(['creator'])}::user_role[])`;
    await sql`
      insert into listings (id, creator_id, slug, title, summary, description, category, price, live_version_id)
      values (${listingId}, ${creatorId}, 'esc', 'Esc', 'Sum', 'Desc', 'userscript', ${100_000_000n}, null)
    `;
    await sql`
      insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
      values (${versionId}, ${listingId}, '1.0.0', 'esc.user.js', ${clean.length}, 'esc', 'blobs/esc', 'live')
    `;
    await blob.put('blobs/esc', new TextEncoder().encode(clean));
    await sql`update listings set live_version_id = ${versionId}, first_live_at = ${now} where id = ${listingId}`;

    const buy = async () => {
      const res = await app.request('/api/v1/orders', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        orderId: string;
        escrow: string;
        txBase64: string;
        memo: string;
        total: string;
        escrowUntil: string;
      };
    };
    const order = await buy();
    expect(order.escrow).toBe(escrowAddress(order.orderId, programId));
    expect(fromBase64(order.txBase64).length).toBeGreaterThan(200);
    const stored = await sql<
      Record<string, any>[]
    >`select * from orders where id = ${order.orderId}`;
    const row = stored[0]!;
    const fundedAccount = (overrides: Partial<ReturnType<typeof decodeEscrow>> = {}) => ({
      buyer: buyer.publicKey,
      seller: seller.publicKey,
      resolver: resolverPub,
      buyback: buckets[0]!,
      aiVerification: buckets[1]!,
      ops: buckets[2]!,
      safety: buckets[3]!,
      status: 'paid' as EscrowStatusName,
      disputedFrom: 'pending' as EscrowStatusName,
      price: row.price as bigint,
      deposit: row.total as bigint,
      feeBps: row.fee_bps as number,
      rebateBps: row.rebate_bps as number,
      splitBuybackBps: 4000,
      splitAiBps: 2500,
      splitOpsBps: 2000,
      splitSafetyBps: 1500,
      expiresAt: BigInt(Math.floor((row.expires_at as Date).getTime() / 1000)),
      escrowUntil: BigInt(Math.floor((row.escrow_until as Date).getTime() / 1000)),
      bump: 255,
      orderId: orderIdBytes(order.orderId),
      ...overrides,
    });
    const submit = async (orderId: string, txSig: string) =>
      app.request(`/api/v1/orders/${orderId}/submitted`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ txSig }),
      });

    // Forged terms: a different seller in the escrow is refused.
    const sig1 = bs58.encode(nacl.randomBytes(64));
    txs.set(sig1, { memos: [order.memo], err: null });
    accounts.set(order.escrow, encodeEscrowForTest(fundedAccount({ seller: buckets[0]! })));
    const forged = await submit(order.orderId, sig1);
    expect(forged.status).toBe(400);
    expect(((await forged.json()) as { error: { code: string } }).error.code).toBe(
      'ESCROW_MISMATCH',
    );
    // Short deposit is refused.
    accounts.set(order.escrow, encodeEscrowForTest(fundedAccount({ deposit: 1n })));
    expect((await submit(order.orderId, sig1)).status).toBe(400);
    // A tx without this order's memo is not accepted as its checkout.
    const sig2 = bs58.encode(nacl.randomBytes(64));
    txs.set(sig2, { memos: ['tm:deadbeef'], err: null });
    accounts.set(order.escrow, encodeEscrowForTest(fundedAccount()));
    expect((await submit(order.orderId, sig2)).status).toBe(400);
    // The real funded escrow settles the order.
    const ok = await submit(order.orderId, sig1);
    expect(ok.status).toBe(200);
    const paid = await sql<Record<string, any>[]>`select * from orders where id = ${order.orderId}`;
    expect(paid[0]?.status).toBe('paid');
    expect(paid[0]?.escrow_until.getTime()).toBe(row.escrow_until.getTime());
    const ledger = await sql<
      { account: string }[]
    >`select account from ledger where ref_id = ${order.orderId}`;
    expect(ledger.map((l) => l.account)).toEqual(['escrow']);
    // Download opens while the funds stay in escrow.
    const dl = await app.request(`/api/v1/orders/${order.orderId}/download`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(dl.status).toBe(200);

    // Not due yet: the cron sends nothing.
    expect(await releaseOrders(deps)).toEqual([]);
    expect(sent).toHaveLength(0);
    clock = new Date(row.escrow_until.getTime() + 1000);
    effect = 'released';
    expect(await releaseOrders(deps)).toEqual([order.orderId]);
    expect(sent).toHaveLength(1);
    const released = await sql<
      Record<string, any>[]
    >`select * from orders where id = ${order.orderId}`;
    expect(released[0]?.status).toBe('released');
    expect(released[0]?.release_sig).toBeTruthy();
    const payouts = await sql<{ status: string; tx_sig: string; bucket: string }[]>`
      select status, tx_sig, bucket from payouts where order_id = ${order.orderId}
    `;
    expect(payouts.length).toBe(5);
    expect(payouts.every((p) => p.status === 'sent' && p.tx_sig === released[0]?.release_sig)).toBe(
      true,
    );

    // Second order: dispute inside the window, refund through the program.
    clock = now;
    await sql`delete from licenses`;
    const second = await buy();
    const row2 = (
      await sql<Record<string, any>[]>`select * from orders where id = ${second.orderId}`
    )[0]!;
    const sig3 = bs58.encode(nacl.randomBytes(64));
    txs.set(sig3, { memos: [second.memo], err: null });
    accounts.set(
      second.escrow,
      encodeEscrowForTest(
        fundedAccount({
          orderId: orderIdBytes(second.orderId),
          expiresAt: BigInt(Math.floor((row2.expires_at as Date).getTime() / 1000)),
          escrowUntil: BigInt(Math.floor((row2.escrow_until as Date).getTime() / 1000)),
        }),
      ),
    );
    expect((await submit(second.orderId, sig3)).status).toBe(200);
    const opened = await app.request(`/api/v1/orders/${second.orderId}/dispute`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'broken', details: 'It does not load on axiom at all.' }),
    });
    expect(opened.status).toBe(200);
    const dispute = (await opened.json()) as { disputeId: string; txBase64: string | null };
    expect(dispute.txBase64).toBeTruthy();
    const admin = await sql<
      { id: string }[]
    >`select id from users where wallet = ${buyer.publicKey}`;
    // The buyer has not signed open_dispute yet: no refund, and release still refuses (DB dispute).
    await expect(
      resolveDispute(deps, dispute.disputeId, admin[0]!.id, {
        status: 'upheld',
        resolution: 'broken file',
      }),
    ).rejects.toMatchObject({ code: 'DISPUTE_NOT_ONCHAIN' });
    const unsigned = await app.request(`/api/v1/orders/${second.orderId}/dispute/tx`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(((await unsigned.json()) as { onChain: boolean }).onChain).toBe(false);
    const current = decodeEscrow(accounts.get(second.escrow)!);
    accounts.set(
      second.escrow,
      encodeEscrowForTest({ ...current, status: 'disputed', disputedFrom: 'paid' }),
    );
    clock = new Date(row2.escrow_until.getTime() + 1000);
    expect(await releaseOrders(deps)).toEqual([]);
    effect = 'refunded';
    await resolveDispute(deps, dispute.disputeId, admin[0]!.id, {
      status: 'upheld',
      resolution: 'broken file',
    });
    const refunded = (
      await sql<Record<string, any>[]>`select * from orders where id = ${second.orderId}`
    )[0]!;
    expect(refunded.status).toBe('refunded');
    expect(refunded.refund_sig).toBeTruthy();
    expect(decodeEscrow(accounts.get(second.escrow)!).status).toBe('refunded');
    const refundPayouts = await sql<{ bucket: string; status: string; recipient: string }[]>`
      select bucket, status, recipient from payouts where order_id = ${second.orderId}
    `;
    expect(refundPayouts).toEqual([
      { bucket: 'refund', status: 'sent', recipient: buyer.publicKey },
    ]);
  });
});
