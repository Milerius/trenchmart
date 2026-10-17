import { createSql } from '@trenchmart/db';
import { fetchTransaction, latestBlockhash } from '@trenchmart/chain';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import { expireOrders, proposePayouts, releaseOrders } from './logic';

type Binding = Record<string, string | undefined>;

let cached: ReturnType<typeof createApp> | null = null;

function appFor(env: Binding) {
  if (cached) return cached;
  const parsed = readEnv(env);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const sql = createSql(databaseUrl);
  cached = createApp({
    sql,
    blob: filesystemBlob(parsed.blobDir, parsed.sessionSecret, parsed.apiUrl),
    env: parsed,
    now: () => new Date(),
    getTx: (signature) => fetchTransaction(parsed.rpcUrl, signature),
    blockhash: () => latestBlockhash(parsed.rpcUrl),
  });
  return cached;
}

export default {
  async fetch(request: Request, env: Binding): Promise<Response> {
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
    return appFor(env).fetch(request);
  },
  async scheduled(
    _event: unknown,
    env: Binding,
    ctx: { waitUntil: (p: Promise<unknown>) => void },
  ): Promise<void> {
    const parsed = readEnv(env);
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) return;
    const sql = createSql(databaseUrl);
    const deps = {
      sql,
      blob: filesystemBlob(parsed.blobDir, parsed.sessionSecret, parsed.apiUrl),
      env: parsed,
      now: () => new Date(),
      getTx: (signature: string) => fetchTransaction(parsed.rpcUrl, signature),
      blockhash: () => latestBlockhash(parsed.rpcUrl),
    };
    ctx.waitUntil(
      expireOrders(deps)
        .then(() => releaseOrders(deps))
        .then(() => proposePayouts(deps))
        .finally(() => sql.end()),
    );
  },
};
