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
import { escrowHousekeeping, releaseOrders, resolveDispute } from './logic';
import { optimizeStoredImages, uploadImage } from './content';
import { createImageOptimizer } from './image-optimize';
import { createRequire } from 'node:module';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import { REPORT_SCHEMA, reportMessage } from '@trenchmart/shared';
import { resetTransparencyCache } from './transparency';
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
      bonds, token_balances, auth_nonces, reports, buybacks, rate_buckets, update_periods,
      update_renewals, supplements, verifications, users
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
    resetTransparencyCache();
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('shows real landing stats (zero, not samples) before any listing, and serves the cached SOL price', async () => {
    const app = await appFor();
    const stats = (await (await app.request('/api/v1/stats')).json()) as {
      source: string;
      volume: { usdCents: string };
    };
    expect(stats.source).toBe('live');
    expect(stats.volume.usdCents).toBe('0');
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

  it('publishes a signed, verifiable scan report and lets a model only tighten the verdict', async () => {
    const signer = nacl.sign.keyPair();
    const reportKey = bs58.encode(signer.secretKey);
    const calls: string[] = [];
    let modelDecision = 'request_changes';
    const llmFetch = (async (url: string, init: RequestInit) => {
      calls.push(String(url));
      const sent = JSON.parse(String(init.body)) as {
        model: string;
        messages: { content: string }[];
      };
      expect(sent.messages[1]?.content).toContain('sniper');
      return new Response(
        JSON.stringify({
          model: sent.model,
          choices: [
            {
              message: {
                content: JSON.stringify({ decision: modelDecision, notes: 'model says so' }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const app = await appFor(
      {
        REPORT_SIGNING_KEY: reportKey,
        LLM_API_KEY: 'test-key',
        LLM_BASE_URL: 'https://llm.example/v1',
        LLM_MODEL: 'test-model-1',
      },
      { llmFetch },
    );
    const creator = keypair();
    const cookie = await login(app, creator);
    await sql`
      update users set roles = roles || '{creator}'::user_role[], x_handle = 'dev_report', x_user_id = 'dev:dev_report'
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
        title: 'Report Filter Pack',
        summary: 'Scoped filters for new pairs.',
        description: 'No wallet access.',
        category: 'userscript',
        priceLamports: '1500000000',
      }),
    });
    const created = (await listing.json()) as { id: string; slug?: string };
    const upload = async (semver: string) => {
      const version = await app.request(`/api/v1/studio/listings/${created.id}/versions`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          semver,
          changelog: 'x',
          fileName: 'sniper.user.js',
          fileSize: clean.length,
        }),
      });
      const uploaded = (await version.json()) as { versionId: string; uploadUrl: string };
      const target = new URL(uploaded.uploadUrl);
      await app.request(`${target.pathname}${target.search}`, {
        method: 'PUT',
        body: new TextEncoder().encode(clean),
      });
      const done = await app.request(`/api/v1/studio/versions/${uploaded.versionId}/complete`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(done.status).toBe(200);
      return uploaded.versionId;
    };
    // The rules approve a clean file; the model asks for changes, so the stricter verdict wins.
    const first = await upload('1.0.0');
    const held = await sql<{ status: string }[]>`select status from versions where id = ${first}`;
    expect(held[0]?.status).toBe('needs_creator');
    modelDecision = 'approve';
    const second = await upload('1.0.1');
    const live = await sql<{ status: string }[]>`select status from versions where id = ${second}`;
    expect(live[0]?.status).toBe('live');
    expect(calls.every((url) => url === 'https://llm.example/v1/chat/completions')).toBe(true);
    const review = await sql<{ engine: string; model: string }[]>`
      select engine, model from ai_reviews where version_id = ${second}
    `;
    expect(review[0]).toEqual({ engine: 'rules@1.0.0+llm', model: 'test-model-1' });

    const slugRow = await sql<
      { slug: string }[]
    >`select slug from listings where id = ${created.id}`;
    const slug = slugRow[0]!.slug;
    const res = await app.request(`/api/v1/listings/${slug}/report?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const signed = (await res.json()) as {
      report: {
        schema: string;
        version: { sha256: string; id: string };
        steps: { kind: string; checks: unknown[] }[];
        reviews: { engine: string; model: string | null; decision: string }[];
      };
      signature: { publicKey: string; value: string };
    };
    expect(signed.report.schema).toBe(REPORT_SCHEMA);
    expect(signed.report.version.id).toBe(second);
    expect(signed.report.steps.map((step) => step.kind).sort()).toEqual(['sandbox', 'static']);
    expect(signed.report.reviews.at(-1)).toMatchObject({
      engine: 'rules@1.0.0+llm',
      model: 'test-model-1',
      decision: 'approve',
    });
    expect(signed.signature.publicKey).toBe(bs58.encode(signer.publicKey));
    // A third party verifies with only the report, the signature and the public key.
    const message = reportMessage(signed.report);
    expect(
      nacl.sign.detached.verify(
        message,
        bs58.decode(signed.signature.value),
        bs58.decode(signed.signature.publicKey),
      ),
    ).toBe(true);
    const tampered = reportMessage({
      ...signed.report,
      version: { ...signed.report.version, sha256: '00' },
    });
    expect(
      nacl.sign.detached.verify(
        tampered,
        bs58.decode(signed.signature.value),
        bs58.decode(signed.signature.publicKey),
      ),
    ).toBe(false);

    const facts = (await (await app.request('/api/v1/transparency')).json()) as {
      reportSigningKey: string;
      review: { engine: string; model: string };
      recentEscrows: unknown[];
    };
    expect(facts.reportSigningKey).toBe(bs58.encode(signer.publicKey));
    expect(facts.review).toMatchObject({ engine: 'rules@1.0.0+llm', model: 'test-model-1' });
    expect(Array.isArray(facts.recentEscrows)).toBe(true);
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
    // Owner decision: the escrow window is 1 hour, started when the checkout is built
    // (it lands within ~90 s), so it never ends later than 1 hour after payment.
    expect((row.escrow_until as Date).getTime() - clock.getTime()).toBe(3_600_000);
    expect(new Date(order.escrowUntil).getTime()).toBe((row.escrow_until as Date).getTime());
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
    // Nor is one whose memo merely contains this order's memo.
    const sigSuper = bs58.encode(nacl.randomBytes(64));
    txs.set(sigSuper, { memos: [`x ${order.memo} y`], err: null });
    const superset = await submit(order.orderId, sigSuper);
    expect(superset.status).toBe(400);
    expect(((await superset.json()) as { error: { code: string } }).error.code).toBe('WRONG_MEMO');
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
    // Rotating a bucket wallet or the fee split mid-window must not rewrite history: the ledger
    // records what the program paid, i.e. the recipients and split stored in the escrow.
    const realBuckets = env.buckets;
    await sql`
      insert into config (key, value)
      values ('fee_split_bps', ${sql.json({ buyback: 10_000, ai_verification: 0, ops: 0, safety: 0 })})
      on conflict (key) do update set value = excluded.value
    `;
    env.buckets = {
      buyback: randomKeypair().publicKey,
      ai_verification: randomKeypair().publicKey,
      ops: randomKeypair().publicKey,
      safety: randomKeypair().publicKey,
    };
    expect(await releaseOrders(deps)).toEqual([order.orderId]);
    env.buckets = realBuckets;
    await sql`delete from config where key = 'fee_split_bps'`;
    expect(sent).toHaveLength(1);
    const released = await sql<
      Record<string, any>[]
    >`select * from orders where id = ${order.orderId}`;
    expect(released[0]?.status).toBe('released');
    expect(released[0]?.release_sig).toBeTruthy();
    const payouts = await sql<
      { status: string; tx_sig: string; bucket: string; recipient: string }[]
    >`
      select status, tx_sig, bucket, recipient from payouts where order_id = ${order.orderId}
    `;
    expect(payouts.length).toBe(5);
    expect(Object.fromEntries(payouts.map((p) => [p.bucket, p.recipient]))).toEqual({
      creator: seller.publicKey,
      buyback: buckets[0],
      ai_verification: buckets[1],
      ops: buckets[2],
      safety: buckets[3],
    });
    // Amounts follow the split stored on chain (40/25/20/15), not the edited config.
    const amounts = await sql<{ bucket: string; amount: bigint }[]>`
      select bucket, amount from payouts where order_id = ${order.orderId} and bucket <> 'creator'
    `;
    const net = (row.fee as bigint) - (row.rebate as bigint);
    const byBucket = Object.fromEntries(amounts.map((a) => [a.bucket, a.amount]));
    expect(byBucket.buyback).toBe((net * 4000n) / 10_000n);
    expect(byBucket.safety).toBe((net * 1500n) / 10_000n);
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
  it('escrow v2: buyer-keyed PDA, resolver freeze on dispute, crank fee payer, atomic resolve, close, kill switch', async () => {
    const programId = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
    const resolver = nacl.sign.keyPair();
    const crank = nacl.sign.keyPair();
    const buckets = [randomKeypair(), randomKeypair(), randomKeypair(), randomKeypair()].map(
      (k) => k.publicKey,
    );
    const accounts = new Map<string, Uint8Array>();
    const sent: { signers: number; effect: string }[] = [];
    let effect: EscrowStatusName | 'closed' = 'disputed';
    const chain: EscrowChain = {
      async account(address) {
        const data = accounts.get(address);
        return data ? { data, owner: programId, lamports: 1n } : null;
      },
      async sendAndConfirm(tx) {
        const signers = tx[0]!;
        const message = tx.subarray(1 + 64 * signers);
        // M-02: the crank pays (first signature); the resolver co-signs only its own actions.
        expect(nacl.sign.detached.verify(message, tx.subarray(1, 65), crank.publicKey)).toBe(true);
        if (signers === 2)
          expect(nacl.sign.detached.verify(message, tx.subarray(65, 129), resolver.publicKey)).toBe(
            true,
          );
        sent.push({ signers, effect });
        for (const [address, data] of accounts) {
          const account = decodeEscrow(data);
          if (effect === 'closed') {
            if (account.status === 'refunded') accounts.delete(address);
          } else if (effect === 'disputed' && account.status === 'paid') {
            accounts.set(
              address,
              encodeEscrowForTest({ ...account, status: 'disputed', disputedFrom: 'paid' }),
            );
          } else if (effect === 'refunded' && account.status === 'disputed') {
            await new Promise((resolve) => setTimeout(resolve, 20));
            accounts.set(address, encodeEscrowForTest({ ...account, status: 'refunded' }));
          }
        }
        return bs58.encode(nacl.randomBytes(64));
      },
    };
    const txs = new Map<string, { memos: string[]; err: unknown }>();
    const env = readEnv({
      SOLANA_CLUSTER: 'devnet',
      VAULT_ADDRESS: vault.publicKey,
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
      SOL_USD_OVERRIDE: '100',
      RATE_LIMIT_PER_MIN: '1000',
      API_URL: 'http://localhost:8787',
      ESCROW_PROGRAM_ID: programId,
      ESCROW_PROGRAM_VERSION: '2',
      ESCROW_RESOLVER: bs58.encode(resolver.publicKey),
      ESCROW_RESOLVER_SECRET: bs58.encode(resolver.secretKey),
      ESCROW_CRANK_SECRET: bs58.encode(crank.secretKey),
      BUCKET_WALLET_BUYBACK: buckets[0]!,
      BUCKET_WALLET_AI_VERIFICATION: buckets[1]!,
      BUCKET_WALLET_OPS: buckets[2]!,
      BUCKET_WALLET_SAFETY: buckets[3]!,
    });
    const blob = filesystemBlob(
      await mkdtemp(join(tmpdir(), 'tm-v2-')),
      env.sessionSecret,
      env.apiUrl,
    );
    let clock = now;
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
      values (${listingId}, ${creatorId}, 'v2', 'V2', 'Sum', 'Desc', 'userscript', ${100_000_000n}, null)
    `;
    await sql`
      insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
      values (${versionId}, ${listingId}, '1.0.0', 'v2.user.js', ${clean.length}, 'v2', 'blobs/v2', 'live')
    `;
    await blob.put('blobs/v2', new TextEncoder().encode(clean));
    await sql`update listings set live_version_id = ${versionId}, first_live_at = ${now} where id = ${listingId}`;

    const buyRes = await app.request('/api/v1/orders', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ listingId }),
    });
    expect(buyRes.status).toBe(200);
    const order = (await buyRes.json()) as { orderId: string; escrow: string; memo: string };
    // L-02: the PDA includes the buyer, so a squatter cannot take this order's address.
    expect(order.escrow).toBe(escrowAddress(order.orderId, programId, buyer.publicKey));
    expect(order.escrow).not.toBe(escrowAddress(order.orderId, programId));
    const row = (
      await sql<Record<string, any>[]>`select * from orders where id = ${order.orderId}`
    )[0]!;
    accounts.set(
      order.escrow,
      encodeEscrowForTest({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        resolver: bs58.encode(resolver.publicKey),
        buyback: buckets[0]!,
        aiVerification: buckets[1]!,
        ops: buckets[2]!,
        safety: buckets[3]!,
        status: 'paid',
        disputedFrom: 'pending',
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
      }),
    );
    const sig = bs58.encode(nacl.randomBytes(64));
    txs.set(sig, { memos: [order.memo], err: null });
    const submitted = await app.request(`/api/v1/orders/${order.orderId}/submitted`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ txSig: sig }),
    });
    expect(submitted.status).toBe(200);

    // M-01: filing the dispute freezes the escrow on chain at once; the buyer signs nothing.
    effect = 'disputed';
    const opened = await app.request(`/api/v1/orders/${order.orderId}/dispute`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'broken', details: 'It does not load on axiom at all.' }),
    });
    expect(opened.status).toBe(200);
    const dispute = (await opened.json()) as { disputeId: string; txBase64: string | null };
    expect(dispute.txBase64).toBeNull();
    expect(sent).toEqual([{ signers: 2, effect: 'disputed' }]);
    expect(decodeEscrow(accounts.get(order.escrow)!).status).toBe('disputed');
    // After the window the cron still holds back: the chain refuses a Disputed release too.
    clock = new Date((row.escrow_until as Date).getTime() + 1000);
    expect(await releaseOrders(deps)).toEqual([]);

    // L-07: two concurrent resolutions serialize; exactly one settles and pays out once.
    effect = 'refunded';
    const admin = (
      await sql<{ id: string }[]>`select id from users where wallet = ${buyer.publicKey}`
    )[0]!;
    const results = await Promise.allSettled([
      resolveDispute(deps, dispute.disputeId, admin.id, { status: 'upheld', resolution: 'a' }),
      resolveDispute(deps, dispute.disputeId, admin.id, { status: 'upheld', resolution: 'b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refundRows =
      await sql`select 1 from payouts where order_id = ${order.orderId} and bucket = 'refund'`;
    expect(refundRows).toHaveLength(1);
    const ledgerRows =
      await sql`select 1 from ledger where ref_id = ${order.orderId} and account = 'escrow' and delta < 0`;
    expect(ledgerRows).toHaveLength(1);
    expect(sent.filter((t) => t.effect === 'refunded')).toHaveLength(1);

    // L-01: the cron closes the refunded escrow (crank signs alone) and marks the order.
    effect = 'closed';
    expect(await escrowHousekeeping(deps)).toEqual([order.orderId]);
    expect(accounts.has(order.escrow)).toBe(false);
    expect(sent.at(-1)).toEqual({ signers: 1, effect: 'closed' });
    const closedRow = (
      await sql<
        Record<string, any>[]
      >`select escrow_closed_at from orders where id = ${order.orderId}`
    )[0]!;
    expect(closedRow.escrow_closed_at).toBeTruthy();
    expect(await escrowHousekeeping(deps)).toEqual([]);

    // Kill switch: the config flag stops new checkouts with a 503.
    await sql`
      insert into config (key, value) values ('checkout_paused', 'true'::jsonb)
      on conflict (key) do update set value = excluded.value
    `;
    const paused = await app.request('/api/v1/orders', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ listingId }),
    });
    expect(paused.status).toBe(503);
    expect(((await paused.json()) as { error: { code: string } }).error.code).toBe(
      'CHECKOUT_PAUSED',
    );
    await sql`delete from config where key = 'checkout_paused'`;
  });
  it('hardening: edge-keyed rate limit, trusted proxy IP, webhook secret and on-chain balances, headers', async () => {
    const keys: string[] = [];
    const app = await appFor(
      { PROXY_SECRET: 'proxy-secret', HELIUS_WEBHOOK_SECRET: 'hook-secret-hook-secret' },
      {
        rateLimiter: {
          async limit({ key }) {
            keys.push(key);
            return { success: !key.startsWith('198.51.100.9') };
          },
        },
        trenchBalance: async () => 42n,
      },
    );
    const post = (headers: Record<string, string>) =>
      app.request('/api/v1/auth/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ wallet: keypair().publicKey }),
      });
    // X-Forwarded-For is client-controlled and ignored; CF-Connecting-IP is the key.
    const plain = await post({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '9.9.9.9' });
    expect(plain.status).toBe(200);
    expect(keys.at(-1)).toBe('203.0.113.5:POST');
    // A forged proxy header without the secret is ignored.
    await post({
      'cf-connecting-ip': '203.0.113.5',
      'x-tm-client-ip': '1.1.1.1',
      'x-tm-proxy': 'nope',
    });
    expect(keys.at(-1)).toBe('203.0.113.5:POST');
    // The web proxy, with the secret, forwards the visitor's IP.
    await post({
      'cf-connecting-ip': '2a06:98c0:3600::103',
      'x-tm-client-ip': '192.0.2.44',
      'x-tm-proxy': 'proxy-secret',
    });
    expect(keys.at(-1)).toBe('192.0.2.44:POST');
    const limited = await post({ 'cf-connecting-ip': '198.51.100.9' });
    expect(limited.status).toBe(429);
    expect(plain.headers.get('x-content-type-options')).toBe('nosniff');
    expect(plain.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(plain.headers.get('strict-transport-security')).toContain('max-age=');

    const hook = (auth: string, body: unknown) =>
      app.request('/api/v1/hooks/helius', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: auth },
        body: JSON.stringify(body),
      });
    expect((await hook('Bearer wrong', [])).status).toBe(401);
    expect((await hook('hook-secret-hook-secre', [])).status).toBe(401);
    const wallet = keypair().publicKey;
    const ok = await hook('Bearer hook-secret-hook-secret', [
      {
        signature: bs58.encode(nacl.randomBytes(64)),
        memo: 'tm:forged',
        tokenBalances: [{ wallet, amount: '999999999999', mint: 'x' }, { wallet: 'not a key' }],
      },
    ]);
    expect(ok.status).toBe(200);
    // The body's amount is ignored: the stored balance is what chain says (42).
    const rows = await sql<
      { amount: string }[]
    >`select amount::text as amount from token_balances where wallet = ${wallet}`;
    expect(rows).toEqual([{ amount: '42' }]);
  });
  it('re-encodes listing images to WebP at upload and backfills stored PNGs', async () => {
    const req = createRequire(import.meta.url);
    const wasm = (path: string): object =>
      new (
        globalThis as unknown as { WebAssembly: { Module: new (b: Uint8Array) => object } }
      ).WebAssembly.Module(readFileSync(req.resolve(path)));
    const modules = () => ({
      png: wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
      jpeg: wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
      webpEncode: wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm'),
      resize: wasm('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'),
    });
    await initPngEncode(modules().png as never);
    const width = 1800;
    const height = 900;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i / 4) % 251;
      data[i + 1] = (i / 7) % 199;
      data[i + 2] = 90;
      data[i + 3] = 255;
    }
    const png = new Uint8Array(await encodePng({ data, width, height } as never));
    const env = readEnv({
      SOLANA_CLUSTER: 'devnet',
      VAULT_ADDRESS: vault.publicKey,
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
      API_URL: 'http://localhost:8787',
    });
    const blob = filesystemBlob(
      await mkdtemp(join(tmpdir(), 'tm-img-')),
      env.sessionSecret,
      env.apiUrl,
    );
    const base: Deps = {
      sql,
      blob,
      env,
      now: () => now,
      getTx: async () => null,
      blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
    };
    const creatorId = randomUUID();
    const listingId = randomUUID();
    await sql`insert into users (id, wallet, roles) values (${creatorId}, ${randomKeypair().publicKey}, ${sql.array(['creator'])}::user_role[])`;
    await sql`
      insert into listings (id, creator_id, slug, title, summary, description, category, price)
      values (${listingId}, ${creatorId}, 'img', 'Img', 'Sum', 'Desc', 'userscript', ${1n})
    `;
    // Without an optimizer (old behaviour) the PNG is stored as is...
    const legacy = await uploadImage(base, listingId, creatorId, png);
    const stored = await sql<
      { mime: string; bytes: number }[]
    >`select mime, bytes from listing_media where id = ${legacy.id}`;
    expect(stored[0]).toEqual({ mime: 'image/png', bytes: png.length });
    // ...and the backfill converts it in place, keeping the row id the live page points at.
    const deps = { ...base, optimizeImage: createImageOptimizer(modules) };
    const backfilled = await optimizeStoredImages(deps);
    expect(backfilled.map((b) => b.id)).toEqual([legacy.id]);
    const after = (
      await sql<Record<string, any>[]>`select * from listing_media where id = ${legacy.id}`
    )[0]!;
    expect(after.mime).toBe('image/webp');
    expect([after.width, after.height]).toEqual([1600, 800]);
    expect(after.bytes).toBeLessThan(png.length);
    expect(await blob.get(after.r2_key as string)).not.toBeNull();
    // New uploads are converted on the way in.
    const fresh = await uploadImage(deps, listingId, creatorId, png);
    const row = (
      await sql<Record<string, any>[]>`select mime, width from listing_media where id = ${fresh.id}`
    )[0]!;
    expect(row).toEqual({ mime: 'image/webp', width: 1600 });
  });
});

// Seller updates, buyer update entitlement, daily limits and SOL supplements (2026-10-18).
describe('versioning: updates, entitlement windows, limits and supplements', () => {
  const DAY = 86_400_000;
  let clock = new Date('2026-06-01T10:00:00.000Z');
  const txs = new Map<string, import('@trenchmart/chain').ChainTx>();

  beforeEach(async () => {
    sql = createSql(databaseUrl);
    await migrate(sql);
    await reset();
    txs.clear();
    clock = new Date('2026-06-01T10:00:00.000Z');
    // The verification fee is covered elsewhere; zero keeps these flows to the new gates.
    await sql`update config set value = '0' where key = 'verification_fee_lamports'`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  async function app(dir?: string) {
    return appFor({}, { now: () => clock, getTx: async (sig) => txs.get(sig) ?? null }, dir);
  }

  /** A confirmed vault transfer with the memo the server asked for. */
  function paid(from: string, lamports: bigint | string, memo: string): string {
    const sig = bs58.encode(nacl.randomBytes(64));
    txs.set(sig, {
      signature: sig,
      err: null,
      blockTime: Math.floor(clock.getTime() / 1000),
      confirmationStatus: 'finalized',
      transfers: [{ source: from, destination: vault.publicKey, lamports: BigInt(lamports) }],
      memos: [memo],
    });
    return sig;
  }

  async function json(res: Response) {
    return (await res.json()) as Record<string, any>;
  }

  async function post(
    a: Awaited<ReturnType<typeof app>>,
    path: string,
    cookie: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return a.request(`/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function creatorWithListing(
    a: Awaited<ReturnType<typeof app>>,
    opts: { updatePrice?: bigint } = {},
  ) {
    const wallet = keypair();
    const cookie = await login(a, wallet);
    const [user] = await sql<
      { id: string }[]
    >`select id from users where wallet = ${wallet.publicKey}`;
    await sql`update users set roles = '{buyer,creator}', x_handle = 'maker' where id = ${user!.id}`;
    const listingId = randomUUID();
    const v1 = randomUUID();
    await sql`
      insert into listings (id, creator_id, slug, title, summary, description, category, price, update_price)
      values (${listingId}, ${user!.id}, ${'pack-' + listingId.slice(0, 6)}, 'Pack', 'Sum', 'Desc', 'userscript',
        ${1_000_000_000n}, ${opts.updatePrice ?? 100_000_000n})
    `;
    await sql`
      insert into versions (id, listing_id, semver, changelog, file_name, file_size, sha256, r2_key, status, live_at, created_at)
      values (${v1}, ${listingId}, '1.0.0', 'initial', 'pack.user.js', 5, 'h100', 'blobs/h100', 'live', ${clock}, ${new Date(clock.getTime() - DAY)})
    `;
    await sql`update listings set live_version_id = ${v1}, first_live_at = ${clock} where id = ${listingId}`;
    return { wallet, cookie, userId: user!.id, listingId, v1 };
  }

  it('suggests a patch bump, needs a changelog and a newer semver, and allows one free update a day', async () => {
    const a = await app();
    const seller = await creatorWithListing(a);
    const quota = await json(
      await a.request(`/api/v1/studio/listings/${seller.listingId}/upload-quota`, {
        headers: { cookie: seller.cookie },
      }),
    );
    expect(quota).toMatchObject({
      isUpdate: true,
      currentSemver: '1.0.0',
      suggestedSemver: '1.0.1',
      updatesToday: 0,
      supplementRequired: false,
      supplementLamports: '50000000',
      resetsAt: '2026-06-02T00:00:00.000Z',
    });
    const base = { fileName: 'pack.user.js', fileSize: 10 };
    const noLog = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      ...base,
      semver: '1.0.1',
      changelog: '',
    });
    expect((await json(noLog)).error.code).toBe('CHANGELOG_REQUIRED');
    const older = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      ...base,
      semver: '1.0.0',
      changelog: 'same',
    });
    expect((await json(older)).error.code).toBe('SEMVER_NOT_NEWER');
    const first = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      ...base,
      semver: '1.0.1',
      changelog: 'Fixes the badge',
    });
    expect(first.status).toBe(200);
    expect((await json(first)).supplement).toBeNull();

    // Second update the same UTC day: 402 with the amount, until the creator accepts it.
    const second = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      ...base,
      semver: '1.0.2',
      changelog: 'Another fix',
    });
    expect(second.status).toBe(402);
    const due = await json(second);
    expect(due.error).toMatchObject({
      code: 'SUPPLEMENT_REQUIRED',
      supplement: { kind: 'upload', lamports: '50000000', reasons: ['listing_update_limit'] },
    });
    const wrong = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      ...base,
      semver: '1.0.2',
      changelog: 'Another fix',
      acceptSupplementLamports: '1',
    });
    expect(wrong.status).toBe(402);
    const accepted = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      ...base,
      semver: '1.0.2',
      changelog: 'Another fix',
      acceptSupplementLamports: '50000000',
    });
    expect(accepted.status).toBe(200);
    const created = await json(accepted);
    expect(created.supplement).toMatchObject({ lamports: '50000000' });
    expect(created.supplement.tx.txBase64).toBeTruthy();

    // /complete refuses until the supplement is paid on chain to the vault.
    const blocked = await post(a, `/studio/versions/${created.versionId}/complete`, seller.cookie);
    expect((await json(blocked)).error.code).toBe('SUPPLEMENT_UNPAID');
    const [row] = await sql<
      { memo: string }[]
    >`select memo from supplements where id = ${created.supplement.id}`;
    const short = paid(seller.wallet.publicKey, 49_000_000n, row!.memo);
    expect(
      (
        await json(
          await post(a, `/supplements/${created.supplement.id}/submitted`, seller.cookie, {
            txSig: short,
          }),
        )
      ).error.code,
    ).toBe('WRONG_AMOUNT');
    const sig = paid(seller.wallet.publicKey, 50_000_000n, row!.memo);
    expect(
      (
        await post(a, `/supplements/${created.supplement.id}/submitted`, seller.cookie, {
          txSig: sig,
        })
      ).status,
    ).toBe(200);
    // Past the supplement gate; the file was never uploaded here.
    const after = await post(a, `/studio/versions/${created.versionId}/complete`, seller.cookie);
    expect((await json(after)).error.code).toBe('FILE_MISSING');
    const payouts = await sql<
      { bucket: string; amount: bigint }[]
    >`select bucket, amount from payouts order by bucket`;
    expect(payouts.reduce((sum, p) => sum + p.amount, 0n)).toBe(50_000_000n);
    expect(payouts.some((p) => p.bucket === 'creator')).toBe(false);

    // A new UTC day resets the limit.
    clock = new Date('2026-06-02T00:00:01.000Z');
    const nextDay = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      ...base,
      semver: '1.0.3',
      changelog: 'Next day',
    });
    expect(nextDay.status).toBe(200);
  });

  it('allows five free uploads per creator per UTC day across listings, then needs the supplement', async () => {
    const a = await app();
    const seller = await creatorWithListing(a);
    const others: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = randomUUID();
      await sql`
        insert into listings (id, creator_id, slug, title, summary, description, category, price)
        values (${id}, ${seller.userId}, ${'new-' + i}, 'New', 'Sum', 'Desc', 'userscript', 1)
      `;
      others.push(id);
    }
    for (let i = 0; i < 5; i += 1) {
      const res = await post(a, `/studio/listings/${others[i]}/versions`, seller.cookie, {
        semver: '1.0.0',
        changelog: 'initial',
        fileName: 'a.user.js',
        fileSize: 5,
      });
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    }
    const sixth = await post(a, `/studio/listings/${others[5]}/versions`, seller.cookie, {
      semver: '1.0.0',
      changelog: 'initial',
      fileName: 'a.user.js',
      fileSize: 5,
    });
    expect(sixth.status).toBe(402);
    expect((await json(sixth)).error.supplement.reasons).toEqual(['creator_upload_limit']);
    // The update on the live listing is over both limits now.
    const update = await post(a, `/studio/listings/${seller.listingId}/versions`, seller.cookie, {
      semver: '1.1.0',
      changelog: 'More',
      fileName: 'a.user.js',
      fileSize: 5,
    });
    expect((await json(update)).error.supplement.reasons).toEqual(['creator_upload_limit']);
    // The supplement amount comes from the config table.
    await sql`insert into config (key, value) values ('upload_supplement_lamports', '70000000') on conflict (key) do update set value = excluded.value`;
    const quota = await json(
      await a.request(`/api/v1/studio/listings/${others[5]}/upload-quota`, {
        headers: { cookie: seller.cookie },
      }),
    );
    expect(quota).toMatchObject({
      supplementRequired: true,
      supplementLamports: '70000000',
      uploadsToday: 5,
    });
    await sql`update config set value = '50000000' where key = 'upload_supplement_lamports'`;
  });

  it('serves the latest entitled version by default, the exact purchased one on request, and renews monthly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tm-blob-'));
    const a = await app(dir);
    const blob = filesystemBlob(
      dir,
      'test-secret-test-secret-test-secret',
      'http://localhost:8787',
    );
    const seller = await creatorWithListing(a);
    const buyer = keypair();
    let cookie = await login(a, buyer);
    // Checkout through the vault and pay it.
    const order = await json(await post(a, '/orders', cookie, { listingId: seller.listingId }));
    const sig = paid(buyer.publicKey, order.total, order.memo);
    expect(
      (await post(a, `/orders/${order.orderId}/submitted`, cookie, { txSig: sig })).status,
    ).toBe(200);
    const [row] = await sql<
      Record<string, any>[]
    >`select updates_until, updates_forever from orders where id = ${order.orderId}`;
    expect(row!.updates_until.toISOString()).toBe(
      new Date(clock.getTime() + 30 * DAY).toISOString(),
    );
    expect(row!.updates_forever).toBe(false);

    const t0 = clock.getTime();
    async function release(semver: string, atDay: number, file: string) {
      const id = randomUUID();
      const at = new Date(t0 + atDay * DAY);
      await sql`update versions set status = 'superseded', superseded_at = ${at} where listing_id = ${seller.listingId} and status = 'live'`;
      await sql`
        insert into versions (id, listing_id, semver, changelog, file_name, file_size, sha256, r2_key, status, live_at, created_at)
        values (${id}, ${seller.listingId}, ${semver}, ${'Changes in ' + semver}, 'pack.user.js', 5, ${'h' + semver}, ${'blobs/' + file}, 'live', ${at}, ${at})
      `;
      await sql`update listings set live_version_id = ${id} where id = ${seller.listingId}`;
      await blob.put(`blobs/${file}`, new TextEncoder().encode(`// ${semver}\nconsole.log(1);\n`));
      return id;
    }
    await blob.put('blobs/h100', new TextEncoder().encode('// 1.0.0\nconsole.log(1);\n'));
    async function download(versionId?: string) {
      const res = await post(
        a,
        `/orders/${order.orderId}/download`,
        cookie,
        versionId ? { versionId } : undefined,
      );
      return { status: res.status, body: await json(res) };
    }

    await release('1.0.1', 10, 'f101');
    clock = new Date(t0 + 12 * DAY);
    expect((await download()).body.semver).toBe('1.0.1');
    expect((await download(seller.v1)).body.semver).toBe('1.0.0');
    // Watermarked per order, from the chosen version.
    const signed = await download(seller.v1);
    const file = await a.request(signed.body.url.replace('http://localhost:8787', ''));
    expect(await file.text()).toContain(order.orderId);

    // Day 33: a version released after the free month, superseded inside the gap.
    const gap = await release('1.0.2', 33, 'f102');
    const v110 = await release('1.1.0', 40, 'f110');
    clock = new Date(t0 + 45 * DAY);
    cookie = await login(a, buyer);
    const lapsed = await download();
    expect(lapsed.body.semver, JSON.stringify(lapsed.body)).toBe('1.0.1');
    const refused = await download(v110);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('NOT_ENTITLED');

    const list = await json(await a.request('/api/v1/me/orders', { headers: { cookie } }));
    const updates = list.orders[0].updates;
    expect(updates).toMatchObject({
      updateAvailable: true,
      entitledToLatest: false,
      active: false,
      current: { semver: '1.0.1' },
      latest: { semver: '1.1.0', changelog: 'Changes in 1.1.0' },
      latestEntitled: { semver: '1.0.1' },
      updatePrice: '100000000',
      renewTotal: '105000000',
      periodDays: 30,
    });
    expect(updates.versions.map((v: { semver: string }) => v.semver)).toEqual(['1.0.1', '1.0.0']);

    // Renew: platform fee on top, 30 days from now because updates had lapsed.
    const quote = await json(await post(a, `/orders/${order.orderId}/updates/quote`, cookie));
    expect(quote).toMatchObject({
      price: '100000000',
      fee: '5000000',
      total: '105000000',
      startsAt: clock.toISOString(),
    });
    const renewal = await json(await post(a, `/orders/${order.orderId}/updates/renew`, cookie));
    expect(renewal.txBase64).toBeTruthy();
    const underpaid = paid(buyer.publicKey, 100_000_000n, renewal.memo);
    expect(
      (
        await json(
          await post(a, `/orders/${order.orderId}/updates/${renewal.renewalId}/submitted`, cookie, {
            txSig: underpaid,
          }),
        )
      ).error.code,
    ).toBe('WRONG_AMOUNT');
    const renewSig = paid(buyer.publicKey, renewal.total, renewal.memo);
    const renewed = await json(
      await post(a, `/orders/${order.orderId}/updates/${renewal.renewalId}/submitted`, cookie, {
        txSig: renewSig,
      }),
    );
    expect(renewed.updatesUntil).toBe(new Date(t0 + 75 * DAY).toISOString());
    expect((await download()).body.semver).toBe('1.1.0');
    // The version that came and went while updates were lapsed stays out of reach.
    expect((await download(gap)).status).toBe(403);
    const creatorPayout = await sql<
      { amount: bigint }[]
    >`select amount from payouts where bucket = 'creator' and recipient = ${seller.wallet.publicKey}`;
    expect(creatorPayout.map((p) => p.amount)).toEqual([100_000_000n]);

    // Renewing while active extends from the current expiry, not from now.
    clock = new Date(t0 + 50 * DAY);
    cookie = await login(a, buyer);
    const again = await json(await post(a, `/orders/${order.orderId}/updates/renew`, cookie));
    const againSig = paid(buyer.publicKey, again.total, again.memo);
    const extended = await json(
      await post(a, `/orders/${order.orderId}/updates/${again.renewalId}/submitted`, cookie, {
        txSig: againSig,
      }),
    );
    expect(extended.updatesUntil).toBe(new Date(t0 + 105 * DAY).toISOString());
    // The same signature cannot pay twice.
    const third = await json(await post(a, `/orders/${order.orderId}/updates/renew`, cookie));
    expect(
      (
        await json(
          await post(a, `/orders/${order.orderId}/updates/${third.renewalId}/submitted`, cookie, {
            txSig: againSig,
          }),
        )
      ).error.code,
    ).toBeTruthy();

    // Another wallet cannot use this order.
    const stranger = await login(a, keypair());
    expect((await post(a, `/orders/${order.orderId}/download`, stranger)).status).toBe(404);
  });

  it('keeps updates free forever when the seller prices them at 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tm-blob-'));
    const a = await app(dir);
    const blob = filesystemBlob(
      dir,
      'test-secret-test-secret-test-secret',
      'http://localhost:8787',
    );
    const seller = await creatorWithListing(a, { updatePrice: 0n });
    const buyer = keypair();
    let cookie = await login(a, buyer);
    const order = await json(await post(a, '/orders', cookie, { listingId: seller.listingId }));
    expect(
      (
        await post(a, `/orders/${order.orderId}/submitted`, cookie, {
          txSig: paid(buyer.publicKey, order.total, order.memo),
        })
      ).status,
    ).toBe(200);
    const id = randomUUID();
    const later = new Date(clock.getTime() + 400 * DAY);
    await sql`update versions set status = 'superseded', superseded_at = ${later} where id = ${seller.v1}`;
    await sql`
      insert into versions (id, listing_id, semver, changelog, file_name, file_size, sha256, r2_key, status, live_at)
      values (${id}, ${seller.listingId}, '2.0.0', 'Big', 'pack.user.js', 5, 'h2', 'blobs/h2', 'live', ${later})
    `;
    await blob.put('blobs/h2', new TextEncoder().encode('// 2\n'));
    clock = new Date(later.getTime() + DAY);
    cookie = await login(a, buyer);
    const dl = await json(await post(a, `/orders/${order.orderId}/download`, cookie));
    expect(dl.semver).toBe('2.0.0');
    const renew = await post(a, `/orders/${order.orderId}/updates/quote`, cookie);
    expect((await json(renew)).error.code).toBe('FREE_UPDATES');
  });

  it('gives one free file verification per wallet and network per UTC day, then needs the supplement', async () => {
    const a = await app();
    const body = { fileName: 'x.user.js', contentBase64: btoa('console.log(1)') };
    const anon = await a.request('/api/v1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(anon.status).toBe(401);
    expect((await json(anon)).error.code).toBe('SIGN_IN_REQUIRED');

    const wallet = keypair();
    const cookie = await login(a, wallet);
    const ip = { 'cf-connecting-ip': '203.0.113.7' };
    const quota = await json(
      await a.request('/api/v1/verify/quota', { headers: { cookie, ...ip } }),
    );
    expect(quota).toMatchObject({ signedIn: true, freeLeft: true, supplementLamports: '10000000' });
    const first = await post(a, '/verify', cookie, body, ip);
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({ match: false, free: true });
    const second = await post(a, '/verify', cookie, body, ip);
    expect(second.status).toBe(402);
    expect((await json(second)).error).toMatchObject({
      code: 'SUPPLEMENT_REQUIRED',
      supplement: { kind: 'verify', lamports: '10000000' },
    });
    // A fresh wallet on the same network does not get another free check.
    const other = await login(a, keypair());
    expect(
      (await post(a, '/verify', other, body, { ...ip, 'x-forwarded-for': '9.9.9.9' })).status,
    ).toBe(402);
    // Nor does the same wallet from another network.
    expect(
      (await post(a, '/verify', cookie, body, { 'cf-connecting-ip': '198.51.100.9' })).status,
    ).toBe(402);

    // Pay the supplement on chain; it buys exactly one more verification.
    const sup = await json(await post(a, '/verify/supplement', cookie));
    expect(sup).toMatchObject({ lamports: '10000000' });
    expect(
      (
        await post(a, `/supplements/${sup.supplementId}/submitted`, cookie, {
          txSig: paid(wallet.publicKey, 10_000_000n, 'sup:wrong'),
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(a, '/verify', cookie, { ...body, supplementId: sup.supplementId }, ip)).status,
    ).toBe(402);
    const sig = paid(wallet.publicKey, 10_000_000n, sup.memo);
    expect(
      (await post(a, `/supplements/${sup.supplementId}/submitted`, cookie, { txSig: sig })).status,
    ).toBe(200);
    const paidCheck = await post(
      a,
      '/verify',
      cookie,
      { ...body, supplementId: sup.supplementId },
      ip,
    );
    expect(paidCheck.status).toBe(200);
    expect((await json(paidCheck)).free).toBe(false);
    expect(
      (await post(a, '/verify', cookie, { ...body, supplementId: sup.supplementId }, ip)).status,
    ).toBe(402);

    // Midnight UTC resets the free check.
    clock = new Date('2026-06-02T00:00:00.000Z');
    expect((await post(a, '/verify', cookie, body, ip)).status).toBe(200);
  });
});
