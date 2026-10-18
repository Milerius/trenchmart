import { createSql } from '@trenchmart/db';
import { configureSandboxWasm } from '@trenchmart/scanner';
// workerd cannot fetch the QuickJS engine at runtime; wrangler bundles it as a compiled module.
// The package's exports map hides the .wasm path, and wrangler's CompiledWasm rule needs it.
import quickjsWasm from '../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm';
import {
  accountData,
  fetchTransaction,
  latestBlockhash,
  simulateUnsigned,
  sendAndConfirm,
  tokenBalance,
  walletHistory,
} from '@trenchmart/chain';
import { createApp, type PriceCacheBox } from './app';
import { scanWalletIntel } from './social';
import { r2Blob, unavailableBlob, type R2BucketLike } from './blob';
// @ts-expect-error the package's .wasm.d.ts types the instance exports; wrangler imports a WebAssembly.Module
import PNG_WASM from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import JPEG_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import WEBP_ENC_WASM from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';
// @ts-expect-error the package's .wasm.d.ts types the instance exports; wrangler imports a WebAssembly.Module
import RESIZE_WASM from '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';
import { createImageOptimizer } from './image-optimize';
import { assertDeployedEnv, readEnv, weakSecrets, isLocalAppUrl } from './env';
import { closeAfterResponse } from './lifetime';
import { withEdgeCache } from './edge-cache';
import { escrowHousekeeping, expireOrders, proposePayouts, releaseOrders } from './logic';
import { deliverAlerts, opsCheck, recordOpsEvent } from './ops';

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
  // Workers Rate Limiting binding (M-03): edge counter, no database write per request.
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
};

type Ctx = { waitUntil: (p: Promise<unknown>) => void };

// Only plain data lives at module scope. Sockets opened in one request cannot be used by
// another in workerd ("Cannot perform I/O on behalf of a different request"), so every
// fetch and scheduled invocation opens its own postgres.js client and closes it afterwards.
const priceCache: PriceCacheBox = { value: null };
configureSandboxWasm(quickjsWasm);

function edgeCache() {
  const caches = (globalThis as { caches?: { default?: unknown } }).caches;
  return (caches?.default as Parameters<typeof withEdgeCache>[3]) ?? null;
}

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

// Upload-time WebP re-encode (no Cloudflare Images permission needed). Lazily initialized.
const optimizeImage = createImageOptimizer(() => ({
  png: PNG_WASM,
  jpeg: JPEG_WASM,
  webpEncode: WEBP_ENC_WASM,
  resize: RESIZE_WASM,
}));

function depsFor(env: Binding, url: string) {
  assertDeployedEnv(stringEnv(env));
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
    simulate: (tx: Uint8Array) => simulateUnsigned(parsed.rpcUrl, tx),
    trenchBalance: parsed.trenchMint
      ? (wallet: string) => tokenBalance(parsed.rpcUrl, wallet, parsed.trenchMint as string)
      : undefined,
    walletHistory: (wallet: string, sinceMs: number) =>
      walletHistory(parsed.rpcUrl, wallet, sinceMs),
    // Wasm re-encode of a 2560 px PNG exceeds this account's Worker CPU limit (error 1102),
    // so it is opt-in. Browsers convert to WebP before upload instead (studio page).
    optimizeImage: parsed.imageOptimize ? optimizeImage : undefined,
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
      // H-01: report (names only) and fail closed if a secret is missing or a default.
      const weak = isLocalAppUrl(env.APP_URL as string | undefined)
        ? []
        : weakSecrets(stringEnv(env));
      if (weak.length) {
        return Response.json(
          {
            ok: false,
            error: { code: 'INSECURE_CONFIG', message: 'weak or missing secrets', names: weak },
          },
          { status: 503 },
        );
      }
      return Response.json({ ok: true, cluster });
    }
    const dbUrl = databaseUrl(env);
    if (!dbUrl) throw new Error('HYPERDRIVE or DATABASE_URL is required');
    const run = async (): Promise<Response> => {
      const deps = depsFor(env, dbUrl);
      const app = createApp(
        { ...deps, sandboxQueue: env.SCAN_QUEUE, rateLimiter: env.RATE_LIMITER },
        priceCache,
      );
      const close = () => deps.sql.end({ timeout: 5 });
      let response: Response;
      try {
        response = await app.fetch(request.clone());
      } catch (error) {
        ctx.waitUntil(close());
        throw error;
      }
      // Streamed reviews keep querying after the handler returns: close once the body is sent.
      return closeAfterResponse(response, close, (p) => ctx.waitUntil(p));
    };
    // Anonymous public reads are served from the Cloudflare edge cache (s-maxage + SWR).
    return withEdgeCache(request, run, (p) => ctx.waitUntil(p), edgeCache());
  },
  async scheduled(_event: unknown, env: Binding, ctx: Ctx): Promise<void> {
    const dbUrl = databaseUrl(env);
    if (!dbUrl) return;
    const deps = depsFor(env, dbUrl);
    // Each job runs even if an earlier one failed, and every failure is logged as an ALERT.
    const step = async (name: string, job: () => Promise<unknown>) => {
      try {
        await job();
      } catch (err) {
        console.error(
          'ALERT',
          JSON.stringify({
            level: 'critical',
            code: 'CRON_FAILED',
            message: `${name}: ${(err as Error).message}`,
          }),
        );
        await recordOpsEvent(deps, 'cron_failed', `${name}: ${(err as Error).message}`);
      }
    };
    ctx.waitUntil(
      (async () => {
        await step('expire', () => expireOrders(deps));
        await step('release', () => releaseOrders(deps));
        await step('payouts', () => proposePayouts(deps));
        await step('escrow-housekeeping', () => escrowHousekeeping(deps));
        await step('wallet-intel', () => scanWalletIntel(deps));
        await step('ops', async () => deliverAlerts(deps, await opsCheck(deps)));
      })().finally(() => deps.sql.end({ timeout: 5 })),
    );
  },
};
