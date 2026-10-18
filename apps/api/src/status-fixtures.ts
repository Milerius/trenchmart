// Test harness for the status page (status.test.ts, status-public.test.ts): a real Postgres
// database with stubbed RPC, web, API health, file storage and escrow chain. Pass
// STATUS_PUSH_TOKEN in `extra` for the production shape (web/API/RPC pushed by the watchdog).
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
export const STATUS_PUSH = 'push-token-push-token-push-token-0001';
export const STATUS_PROGRAM = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';

export type StatusWorld = {
  web: number;
  api: boolean;
  rpc: boolean;
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
    web: 200,
    api: true,
    rpc: true,
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
  return { deps, world };
}
