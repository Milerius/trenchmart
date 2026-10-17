import { createSql } from '@trenchmart/db';
import { accountData, fetchTransaction, latestBlockhash, sendAndConfirm } from '@trenchmart/chain';
import { createApp, type PriceCacheBox } from './app';
import { r2Blob, unavailableBlob, type R2BucketLike } from './blob';
import { readEnv } from './env';
import { expireOrders, proposePayouts, releaseOrders } from './logic';

type Binding = Record<string, unknown> & {
  DATABASE_URL?: string;
  SOLANA_CLUSTER?: string;
  // Cloudflare Hyperdrive binding. When present it wins over DATABASE_URL: Hyperdrive
  // terminates TLS to Supabase (whose CA workerd cannot verify) and pools connections.
  HYPERDRIVE?: { connectionString: string };
  SCAN_QUEUE?: { send(body: unknown): Promise<void> };
  // R2 bucket for uploads and licensed copies. workerd's node:fs is a per-request VFS,
  // so a disk-backed store loses every upload between requests.
  FILES?: R2BucketLike;
};

type Ctx = { waitUntil: (p: Promise<unknown>) => void };

// Only plain data lives at module scope. Sockets opened in one request cannot be used by
// another in workerd ("Cannot perform I/O on behalf of a different request"), so every
// fetch and scheduled invocation opens its own postgres.js client and closes it afterwards.
const priceCache: PriceCacheBox = { value: null };

export function databaseUrl(env: Binding): string | undefined {
  return env.HYPERDRIVE?.connectionString || env.DATABASE_URL || undefined;
}

function stringEnv(env: Binding): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function depsFor(env: Binding, url: string) {
  const parsed = readEnv(stringEnv(env));
  // One request rarely needs more than a few concurrent queries; keep the socket count low.
  const sql = createSql(url, { max: 5 });
  return {
    sql,
    blob: env.FILES
      ? r2Blob(env.FILES, parsed.sessionSecret, parsed.apiUrl)
      : unavailableBlob(parsed.sessionSecret, parsed.apiUrl),
    env: parsed,
    now: () => new Date(),
    getTx: (signature: string) => fetchTransaction(parsed.rpcUrl, signature),
    blockhash: () => latestBlockhash(parsed.rpcUrl),
    escrowChain: {
      account: (address: string) => accountData(parsed.rpcUrl, address),
      sendAndConfirm: (tx: Uint8Array) => sendAndConfirm(parsed.rpcUrl, tx),
    },
  };
}

export default {
  async fetch(request: Request, env: Binding, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/health') {
      const cluster = env.SOLANA_CLUSTER || 'devnet';
      if (cluster === 'mainnet' || cluster === 'mainnet-beta') {
        return Response.json(
          { error: { code: 'MAINNET_REFUSED', message: 'refusing mainnet' } },
          { status: 500 },
        );
      }
      return Response.json({ ok: true, cluster });
    }
    const dbUrl = databaseUrl(env);
    if (!dbUrl) throw new Error('HYPERDRIVE or DATABASE_URL is required');
    const deps = depsFor(env, dbUrl);
    const app = createApp({ ...deps, sandboxQueue: env.SCAN_QUEUE }, priceCache);
    try {
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(deps.sql.end({ timeout: 5 }));
    }
  },
  async scheduled(_event: unknown, env: Binding, ctx: Ctx): Promise<void> {
    const dbUrl = databaseUrl(env);
    if (!dbUrl) return;
    const deps = depsFor(env, dbUrl);
    ctx.waitUntil(
      expireOrders(deps)
        .then(() => releaseOrders(deps))
        .then(() => proposePayouts(deps))
        .finally(() => deps.sql.end({ timeout: 5 })),
    );
  },
};
