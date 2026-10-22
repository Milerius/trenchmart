import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { randomKeypair } from '@trenchmart/chain';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';

/**
 * Integration: one deployment served on two hostnames (trenchmart.fun and
 * devnet.trenchmart.fun, docs/ops/networks.md). The sign-in message names the page's host when
 * it is allow-listed, both hosts verify, and anything else falls back to SIWS_DOMAIN.
 */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const vault = randomKeypair();
const blockhash = bs58.encode(new Uint8Array(32).fill(3));
let sql: Sql;
let app: ReturnType<typeof createApp>;
const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  sql ??= createSql(databaseUrl);
  await migrate(sql);
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
    SIWS_DOMAIN: 'trenchmart.test',
    SIWS_EXTRA_DOMAINS: 'devnet.trenchmart.test, bad domain!',
  });
  const dir = await mkdtemp(join(tmpdir(), 'tm-hosts-'));
  app = createApp({
    sql,
    blob: filesystemBlob(dir, env.sessionSecret, env.apiUrl),
    env,
    now: () => new Date(),
    getTx: async () => null,
    blockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
  });
});
afterAll(async () => {
  await sql?.end();
});

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

async function signInVia(host: string | null) {
  const wallet = keypair();
  const res = await app.request('/api/v1/auth/nonce', {
    method: 'POST',
    headers: host ? { ...json, 'x-tm-site-host': host } : json,
    body: JSON.stringify({ wallet: wallet.publicKey }),
  });
  expect(res.status).toBe(200);
  const { message } = (await res.json()) as { message: string };
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey),
  );
  const verified = await app.request('/api/v1/auth/verify', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ wallet: wallet.publicKey, signature }),
  });
  return { message, status: verified.status };
}

describe('cluster hostnames (SIWS_EXTRA_DOMAINS)', () => {
  it('names the apex domain by default and signs in', async () => {
    const { message, status } = await signInVia(null);
    expect(message.split('\n')[0]).toContain('trenchmart.test');
    expect(message.split('\n')[0]).not.toContain('devnet.');
    expect(status).toBe(200);
  });

  it('names the devnet subdomain when the page is on it, and that signature verifies', async () => {
    const { message, status } = await signInVia('devnet.trenchmart.test');
    expect(message.split('\n')[0]).toContain('devnet.trenchmart.test');
    expect(message).toContain('URI: http://devnet.trenchmart.test');
    expect(status).toBe(200);
  });

  it('ignores a host that is not allow-listed (falls back to SIWS_DOMAIN)', async () => {
    const { message, status } = await signInVia('evil.example');
    expect(message).not.toContain('evil.example');
    expect(message.split('\n')[0]).toContain('trenchmart.test');
    expect(status).toBe(200);
  });

  it('drops malformed entries from the allow-list', () => {
    const env = readEnv({ SIWS_EXTRA_DOMAINS: 'a.example,bad domain!, B.Example:8080' });
    expect(env.siwsExtraDomains).toEqual(['a.example', 'b.example:8080']);
  });
});
