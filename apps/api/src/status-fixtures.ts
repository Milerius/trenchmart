// Test harness for the status page (status.test.ts, status-public.test.ts): a real Postgres
// database with a stubbed watchdog, RPC, web, file storage and escrow chain.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomKeypair } from '@trenchmart/chain';
import type { Sql } from '@trenchmart/db';
import { filesystemBlob, type BlobStore } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';

export const STATUS_TOKEN = 'internal-token-internal-token-internal-token-0123';
export const STATUS_PROGRAM = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';

export type StatusWorld = {
  /** null: the watchdog binding is absent (direct probes). */
  watchdog: 'ok' | 'broken' | null;
  web: number;
  api: boolean;
  rpc: boolean;
  /** Added latency (ms) reported by the watchdog for each of its checks. */
  watchdogMs: { web: number; api: number; rpc: number };
  program: boolean;
  blobBroken: boolean;
  direct: string[];
};

export async function statusSetup(
  sql: Sql,
  clock: { now: Date },
  extra: Record<string, string> = {},
) {
  const resolver = nacl.sign.keyPair();
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: randomKeypair().publicKey,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    INTERNAL_TOKEN: STATUS_TOKEN,
    HELIUS_WEBHOOK_SECRET: 'hook-secret-hook-secret-hook-secret-hook-0123',
    AI_ATTEST_SECRET: 'attest-secret-attest-secret-attest-secret-0123',
    API_URL: 'https://api.example',
    APP_URL: 'https://web.example',
    SOLANA_RPC_URL: 'https://rpc.example',
    ESCROW_PROGRAM_ID: STATUS_PROGRAM,
    ESCROW_RESOLVER_SECRET: bs58.encode(resolver.secretKey),
    ...extra,
  });
  const world: StatusWorld = {
    watchdog: 'ok',
    web: 200,
    api: true,
    rpc: true,
    watchdogMs: { web: 120, api: 80, rpc: 150 },
    program: true,
    blobBroken: false,
    direct: [],
  };
  const real = filesystemBlob(
    await mkdtemp(join(tmpdir(), 'tm-status-')),
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
  const opsFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    world.direct.push(new URL(url).host);
    if (url.startsWith('https://rpc.example'))
      return Response.json({ result: world.rpc ? 'ok' : 'behind' });
    if (url.startsWith('https://web.example')) return new Response('', { status: world.web });
    if (url.startsWith('https://api.example'))
      return Response.json({ ok: world.api }, { status: world.api ? 200 : 503 });
    return new Response('{}');
  }) as typeof fetch;
  const watchdog = {
    fetch: async () => {
      if (world.watchdog === 'broken') throw new Error('service binding unavailable');
      // Same shape as watchdog.ts GET /, including the detail text the API must not copy.
      const checks = [
        {
          name: 'web',
          ok: world.web < 500,
          detail: world.web < 500 ? 'ok' : `https://web.example HTTP ${world.web}`,
          ms: world.watchdogMs.web,
        },
        {
          name: 'api',
          ok: world.api,
          detail: world.api ? 'ok' : 'https://api.example/api/v1/health HTTP 503',
          ms: world.watchdogMs.api,
        },
        {
          name: 'rpc',
          ok: world.rpc,
          detail: world.rpc ? 'ok' : 'RPC getHealth HTTP 200 behind',
          ms: world.watchdogMs.rpc,
        },
      ];
      return Response.json({ ok: checks.every((c) => c.ok), checks });
    },
  };
  const deps: Deps = {
    sql,
    blob,
    env,
    now: () => clock.now,
    getTx: async () => null,
    blockhash: async () => ({
      blockhash: bs58.encode(new Uint8Array(32)),
      lastValidBlockHeight: 1,
    }),
    opsFetch,
    escrowChain: {
      account: async (address: string) => {
        if (address === STATUS_PROGRAM)
          return world.program
            ? {
                data: new Uint8Array(36),
                owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
                lamports: 1n,
              }
            : null;
        return {
          data: new Uint8Array(),
          owner: '11111111111111111111111111111111',
          lamports: 1_000_000_000n,
        };
      },
      sendAndConfirm: async () => '',
    },
  };
  Object.defineProperty(deps, 'watchdog', {
    enumerable: true,
    get: () => (world.watchdog === null ? undefined : watchdog),
  });
  return { deps, world };
}
