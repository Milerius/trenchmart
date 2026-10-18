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
import { filesystemBlob, type BlobStore } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';
import { deliverAlerts, opsCheck, recordOpsEvent } from './ops';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
let sql: Sql;
let now = new Date('2026-06-01T00:00:00.000Z');
const TOKEN = 'internal-token-internal-token-internal-token-0123';
const HOOK = 'hook-secret-hook-secret-hook-secret-hook-0123';
const PROGRAM = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
const vaultAuthority = randomKeypair().publicKey;
const programData = randomKeypair().publicKey;

type World = {
  lamports: bigint;
  authority: string;
  rpc: 'ok' | 'down';
  web: number;
  sent: { url: string; headers: Record<string, string>; body: string }[];
  blobBroken: boolean;
};

async function setup(extra: Record<string, string> = {}) {
  const resolver = nacl.sign.keyPair();
  const crank = nacl.sign.keyPair();
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: randomKeypair().publicKey,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    INTERNAL_TOKEN: TOKEN,
    HELIUS_WEBHOOK_SECRET: HOOK,
    AI_ATTEST_SECRET: 'attest-secret-attest-secret-attest-secret-0123',
    API_URL: 'http://localhost:8787',
    APP_URL: 'https://web.example',
    SOLANA_RPC_URL: 'https://rpc.example',
    ESCROW_PROGRAM_ID: PROGRAM,
    ESCROW_RESOLVER_SECRET: bs58.encode(resolver.secretKey),
    ESCROW_CRANK_SECRET: bs58.encode(crank.secretKey),
    EXPECTED_UPGRADE_AUTHORITY: vaultAuthority,
    ALERT_NTFY_TOPIC: 'secret-topic',
    ALERT_EMAIL: 'owner@example.com',
    TELEGRAM_BOT_TOKEN: 'tg-token',
    TELEGRAM_CHAT_ID: '42',
    ...extra,
  });
  const world: World = {
    lamports: 1_000_000_000n,
    authority: vaultAuthority,
    rpc: 'ok',
    web: 200,
    sent: [],
    blobBroken: false,
  };
  const real = filesystemBlob(
    await mkdtemp(join(tmpdir(), 'tm-ops-')),
    env.sessionSecret,
    env.apiUrl,
  );
  const blob: BlobStore = {
    ...real,
    put: async (k, v) => {
      if (world.blobBroken) throw new Error('R2 503');
      return real.put(k, v);
    },
  };
  const opsFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://rpc.example')) {
      if (world.rpc === 'down') throw new Error('connect timeout');
      return Response.json({ result: 'ok' });
    }
    if (url.startsWith('https://web.example')) return new Response('', { status: world.web });
    world.sent.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ''),
    });
    return new Response('{}');
  }) as typeof fetch;
  const deps: Deps = {
    sql,
    blob,
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: async () => ({
      blockhash: bs58.encode(new Uint8Array(32)),
      lastValidBlockHeight: 1,
    }),
    opsFetch,
    escrowChain: {
      account: async (address: string) => {
        if (address === PROGRAM) {
          const data = new Uint8Array(36);
          data.set(bs58.decode(programData), 4);
          return { data, owner: 'BPFLoaderUpgradeab1e11111111111111111111111', lamports: 1n };
        }
        if (address === programData) {
          const data = new Uint8Array(45);
          data[12] = 1;
          data.set(bs58.decode(world.authority), 13);
          return { data, owner: 'BPFLoaderUpgradeab1e11111111111111111111111', lamports: 1n };
        }
        return {
          data: new Uint8Array(),
          owner: '11111111111111111111111111111111',
          lamports: world.lamports,
        };
      },
      sendAndConfirm: async () => '',
    },
  };
  return { deps, world };
}

const codes = async (deps: Deps) => (await opsCheck(deps)).map((a) => a.code).sort();

async function listingWithVersion(status = 'live') {
  const buyerId = randomUUID();
  const creatorId = randomUUID();
  const listingId = randomUUID();
  const versionId = randomUUID();
  await sql`insert into users (id, wallet) values (${buyerId}, ${randomKeypair().publicKey}), (${creatorId}, ${randomKeypair().publicKey})`;
  await sql`
    insert into listings (id, creator_id, slug, title, summary, description, category, price)
    values (${listingId}, ${creatorId}, ${'ops-' + listingId.slice(0, 8)}, 'Ops', 'Sum', 'Desc', 'userscript', ${1n})
  `;
  await sql`
    insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status, created_at)
    values (${versionId}, ${listingId}, '1.0.0', 'o.user.js', 1, ${'o' + versionId}, 'blobs/o', ${status}, ${new Date(now.getTime() - 3_600_000)})
  `;
  return { buyerId, listingId, versionId };
}

describe('monitoring and alerts', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`truncate table ops_events, ops_alerts, disputes, payouts, orders, versions, listings, users restart identity cascade`;
    now = new Date('2026-06-01T00:00:00.000Z');
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('is quiet when everything is healthy', async () => {
    const { deps, world } = await setup();
    expect(await opsCheck(deps)).toEqual([]);
    expect(await deliverAlerts(deps, [])).toEqual([]);
    expect(world.sent).toEqual([]);
  });

  it('fires each infrastructure alert: RPC, web, R2, low balance, upgrade authority, resolver', async () => {
    const { deps, world } = await setup();
    world.rpc = 'down';
    expect(await codes(deps)).toEqual(['RPC_DOWN']);
    world.rpc = 'ok';
    world.web = 502;
    expect(await codes(deps)).toEqual(['WEB_DOWN']);
    world.web = 200;
    world.blobBroken = true;
    expect(await codes(deps)).toEqual(['R2_ERROR']);
    world.blobBroken = false;
    world.lamports = 1_000n;
    const low = await opsCheck(deps);
    expect(low.map((a) => a.code)).toEqual(['LOW_BALANCE', 'LOW_BALANCE']);
    expect(low.map((a) => a.message).join(' ')).toMatch(/resolver .* fee payer/s);
    world.lamports = 1_000_000_000n;
    world.authority = randomKeypair().publicKey;
    expect(await codes(deps)).toEqual(['UPGRADE_AUTHORITY_CHANGED']);
    const bad = await setup({ ESCROW_RESOLVER: randomKeypair().publicKey });
    expect(await codes(bad.deps)).toEqual(['RESOLVER_MISCONFIGURED']);
  });

  it('fires each business alert: stuck release, cron, webhook, scans, 5xx, disputes, payouts, kill switch, DB', async () => {
    const { deps } = await setup({ CHECKOUT_PAUSED: '1' });
    expect(await codes(deps)).toEqual(['CHECKOUT_PAUSED']);
    const { deps: d } = await setup();
    const { buyerId, listingId, versionId } = await listingWithVersion();
    const orderId = randomUUID();
    await sql`
      insert into orders (id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total, tier_at_purchase, memo, status, expires_at, escrow_until)
      values (${orderId}, ${buyerId}, ${listingId}, ${versionId}, 1, 0, 0, 0, 0, 1, 'none', 'tm:ops', 'paid', ${now}, ${new Date(now.getTime() - 3_600_000)})
    `;
    expect(await codes(d)).toEqual(['RELEASE_STUCK']);
    await sql`update orders set status = 'released' where id = ${orderId}`;
    await recordOpsEvent(d, 'cron_failed', 'release: boom');
    await recordOpsEvent(d, 'webhook_error', 'hooks: boom');
    await recordOpsEvent(d, 'scan_error', 'complete: boom');
    for (let i = 0; i < 10; i += 1) await recordOpsEvent(d, '5xx', 'x');
    expect(await codes(d)).toEqual([
      'CRON_FAILED',
      'HTTP_5XX_SPIKE',
      'SCAN_ERRORS',
      'WEBHOOK_FAILED',
    ]);
    now = new Date(Date.now() + 3_600_000); // events age out of the 15 min window
    await sql`update versions set status = 'scanning', created_at = ${new Date(now.getTime() - 3_600_000)} where id = ${versionId}`;
    expect(await codes(d)).toEqual(['SCAN_STUCK']);
    await sql`update versions set status = 'live' where id = ${versionId}`;
    for (let i = 0; i < 5; i += 1) {
      const o = randomUUID();
      await sql`
        insert into orders (id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total, tier_at_purchase, memo, status, expires_at, escrow_until)
        values (${o}, ${buyerId}, ${listingId}, ${versionId}, 1, 0, 0, 0, 0, 1, 'none', ${'tm:d' + i}, 'disputed', ${now}, ${now})
      `;
      await sql`insert into disputes (order_id, opened_by, reason, details, status, created_at) values (${o}, ${buyerId}, 'broken', 'x', 'open', ${new Date(now.getTime() - (i === 0 ? 30 * 3_600_000 : 60_000))})`;
    }
    expect(await codes(d)).toEqual(['DISPUTES_WAITING']);
    await sql`update disputes set created_at = ${new Date(now.getTime() - 60_000)}`;
    expect(await codes(d)).toEqual(['DISPUTE_SPIKE']);
    await sql`update disputes set status = 'rejected', created_at = ${new Date(now.getTime() - 5 * 3_600_000)}`;
    await sql`insert into payouts (recipient, amount, bucket, status, created_at) values (${randomKeypair().publicKey}, 1, 'creator', 'pending', ${new Date(now.getTime() - 72 * 3_600_000)})`;
    expect(await codes(d)).toEqual(['PAYOUTS_WAITING']);
    const broken = await setup();
    broken.deps.sql = (() => Promise.reject(new Error('connection refused'))) as unknown as Sql;
    expect(await codes(broken.deps)).toEqual(['DB_ERROR']);
  });

  it('delivers once on open, re-sends after 6 h, once on resolve, through ntfy (with email) and Telegram', async () => {
    const { deps, world } = await setup();
    world.lamports = 1_000n;
    const first = await deliverAlerts(deps, await opsCheck(deps));
    expect(first.map((n) => n.title)).toEqual(['CRITICAL LOW_BALANCE']);
    expect(world.sent.map((s) => new URL(s.url).host)).toEqual(['ntfy.sh', 'api.telegram.org']);
    expect(world.sent[0]!.url).toBe('https://ntfy.sh/secret-topic');
    expect(world.sent[0]!.headers.Email).toBe('owner@example.com');
    expect(world.sent[0]!.headers.Priority).toBe('urgent');
    expect(world.sent[0]!.body).toContain('docs/ops/monitoring.md');
    world.sent = [];
    expect(await deliverAlerts(deps, await opsCheck(deps))).toEqual([]);
    now = new Date(now.getTime() + 6 * 3_600_000);
    expect((await deliverAlerts(deps, await opsCheck(deps))).length).toBe(1);
    world.lamports = 1_000_000_000n;
    world.sent = [];
    const resolved = await deliverAlerts(deps, await opsCheck(deps));
    expect(resolved.map((n) => n.title)).toEqual(['RESOLVED LOW_BALANCE']);
    expect(world.sent.length).toBe(2);
    expect(await deliverAlerts(deps, await opsCheck(deps))).toEqual([]);
  });

  it('records API 5xx and webhook errors; internal and admin endpoints are protected', async () => {
    const { deps, world } = await setup();
    const app = createApp({
      ...deps,
      getTx: async () => {
        throw new Error('rpc exploded');
      },
    });
    const hook = await app.request('/api/v1/hooks/helius', {
      method: 'POST',
      headers: { authorization: `Bearer ${HOOK}`, 'content-type': 'application/json' },
      body: JSON.stringify([{ signature: 'sig1' }]),
    });
    expect(hook.status).toBe(500);
    await new Promise((r) => setTimeout(r, 50));
    const kinds = await sql<{ kind: string }[]>`select kind from ops_events order by kind`;
    expect(kinds.map((k) => k.kind)).toEqual(['5xx', 'webhook_error']);
    expect((await app.request('/api/v1/internal/ops')).status).toBe(401);
    expect((await app.request('/api/v1/admin/ops')).status).toBe(401);
    const run = await app.request('/api/v1/internal/ops/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(
      ((await run.json()) as { notices: { title: string }[] }).notices.map((n) => n.title),
    ).toEqual(['CRITICAL WEBHOOK_FAILED']);
    world.sent = [];
    const test = await app.request('/api/v1/internal/ops/test?code=LOW_BALANCE', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(await test.json()).toEqual({ channels: ['ntfy', 'telegram'] });
    expect(world.sent[0]!.headers.Title).toContain('TEST LOW_BALANCE');
  });
});
