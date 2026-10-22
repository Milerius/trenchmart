import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import { ruleFor } from './edge-cache';

/** Integration: the public "Recent payouts" feed (GET /api/v1/payouts/recent). */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const now = new Date('2026-06-01T12:00:00.000Z');
const minutes = (n: number) => new Date(now.getTime() - n * 60_000);
let sql: Sql;

async function appFor() {
  const dir = await mkdtemp(join(tmpdir(), 'tm-blob-'));
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: randomKeypair().publicKey,
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
    now: () => now,
    getTx: async () => null,
    blockhash: async () => ({
      blockhash: bs58.encode(new Uint8Array(32).fill(3)),
      lastValidBlockHeight: 1,
    }),
  });
}

const wallet = () => randomKeypair().publicKey;
const sig = () => bs58.encode(new Uint8Array(64).map(() => Math.floor(Math.random() * 256)));

async function payout(p: {
  recipient: string;
  bucket?: string;
  status?: string;
  txSig?: string | null;
  sentAt: Date;
  amount?: bigint;
}) {
  await sql`
    insert into payouts (id, recipient, bucket, amount, status, tx_sig, sent_at, created_at)
    values (${randomUUID()}, ${p.recipient}, ${p.bucket ?? 'creator'}, ${p.amount ?? 27_000_000n},
      ${p.status ?? 'sent'}, ${p.txSig === undefined ? sig() : p.txSig}, ${p.sentAt}, ${p.sentAt})
  `;
}

async function get(app: Awaited<ReturnType<typeof appFor>>, query = '') {
  const res = await app.request(`/api/v1/payouts/recent${query}`);
  return { status: res.status, body: (await res.json()) as any };
}

afterAll(async () => {
  await sql?.end();
});

beforeEach(async () => {
  sql ??= createSql(databaseUrl);
  await migrate(sql);
  await sql`truncate table payouts, orders, versions, listings, users restart identity cascade`;
});

describe('GET /payouts/recent', () => {
  it('lists only sent creator lines with a signature, never refunds or fee buckets', async () => {
    const creator = wallet();
    const shown = sig();
    await payout({ recipient: creator, txSig: shown, sentAt: minutes(30) });
    for (const bucket of ['refund', 'buyback', 'ai_verification', 'ops', 'safety'])
      await payout({ recipient: wallet(), bucket, sentAt: minutes(30) });
    await payout({ recipient: creator, status: 'pending', sentAt: minutes(30) });
    await payout({ recipient: creator, status: 'failed', sentAt: minutes(30) });
    await payout({ recipient: creator, txSig: null, sentAt: minutes(30) });
    const res = await get(await appFor());
    expect(res.status).toBe(200);
    expect(res.body.payouts).toHaveLength(1);
    const [row] = res.body.payouts;
    expect(row.txSig).toBe(shown);
    expect(row.amount).toEqual({ lamports: '27000000', sol: expect.any(String), usdCents: '270' });
    expect(res.body.solUsd.centsPerSol).toBe('10000');
  });

  it('holds lines for 10 minutes and rounds times down to 15 minutes', async () => {
    await payout({ recipient: wallet(), sentAt: minutes(5) });
    await payout({ recipient: wallet(), sentAt: new Date('2026-06-01T11:37:42.000Z') });
    const res = await get(await appFor());
    expect(res.body.payouts).toHaveLength(1);
    expect(res.body.payouts[0].at).toBe('2026-06-01T11:30:00.000Z');
    expect(res.body).toMatchObject({ delayMinutes: 10, roundMinutes: 15 });
  });

  it('never carries order, listing or buyer fields', async () => {
    await payout({ recipient: wallet(), sentAt: minutes(60) });
    const res = await get(await appFor());
    expect(Object.keys(res.body.payouts[0]).sort()).toEqual([
      'amount',
      'at',
      'creator',
      'id',
      'txSig',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/order|listing|buyer|slug/i);
  });

  it('names X-verified creators and pseudonyms; everyone else is a shortened wallet', async () => {
    const [x, pseudo, plain, unknown] = [wallet(), wallet(), wallet(), wallet()];
    await sql`insert into users (wallet, handle, x_user_id, x_handle) values (${x}, 'kaelvoss', '12345', 'kaelvoss')`;
    await sql`insert into users (wallet, handle, display_name) values (${pseudo}, 'nightowl', 'nightowl')`;
    await sql`insert into users (wallet, handle) values (${plain}, 'plainuser')`;
    await payout({ recipient: x, sentAt: minutes(20) });
    await payout({ recipient: pseudo, sentAt: minutes(40) });
    await payout({ recipient: plain, sentAt: minutes(60) });
    await payout({ recipient: unknown, sentAt: minutes(80) });
    const { body } = await get(await appFor());
    const creators = body.payouts.map((p: any) => p.creator);
    expect(creators.map((c: any) => c.kind)).toEqual(['x', 'pseudonym', 'wallet', 'wallet']);
    expect(creators[0].name).toBe('kaelvoss');
    expect(creators[1].name).toBe('nightowl');
    expect(creators[2].name).toBe(`${plain.slice(0, 4)}…${plain.slice(-4)}`);
    expect(creators[3]).toMatchObject({
      name: `${unknown.slice(0, 4)}…${unknown.slice(-4)}`,
      handle: null,
      avatarUrl: null,
    });
  });

  it('caps limit at 50, defaults to 20, newest first', async () => {
    for (let i = 0; i < 25; i++)
      await payout({ recipient: wallet(), sentAt: minutes(20 + i * 15) });
    const app = await appFor();
    const def = await get(app);
    expect(def.body.payouts).toHaveLength(20);
    const ats = def.body.payouts.map((p: any) => p.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect((await get(app, '?limit=3')).body.payouts).toHaveLength(3);
    expect((await get(app, '?limit=999')).body.payouts).toHaveLength(25);
  });

  it('is edge-cached about a minute and shared across viewers', () => {
    expect(
      ruleFor(new Request('https://api.trenchmart.fun/api/v1/payouts/recent?limit=20')),
    ).toMatchObject({ fresh: 60, shared: true });
  });
});
