// External watchdog (docs/ops/monitoring.md): a separate tiny Worker with its own 5-minute cron
// that checks the web app, the API and the Solana RPC from outside the API Worker, so an API
// outage (which also stops the API's own cron alerts) still surfaces. Deployed with
// `wrangler deploy -c watchdog.wrangler.toml`. Alert delivery is chat-only: the owner's
// assistant polls GET / (this Worker) and GET /api/v1/internal/ops/alerts every 10 min.
// Each cron tick also pushes the checks (name, ok, ms; never the detail text) to the API's
// POST /api/v1/internal/status/external for the public status page (status.ts), authenticated
// with STATUS_PUSH_TOKEN (a Worker secret that can do nothing else). Unset = no push.
// Each tick also reports the health check (web and API up) to POST /api/v1/internal/ops/report
// as check "health-check" with the same token, which the API only accepts for that check. The
// ops check raises HEALTH_CHECK_FAILED on a failure, or when these reports stop for 20 min.
// Failures are logged as `ALERT {...}` in Workers Logs; there is no ntfy/email/Telegram push.

export type WatchdogEnv = {
  WEB_URL: string;
  API_URL: string;
  /** Public RPC: the fallback when HELIUS_RPC_URL is set, the only RPC otherwise. */
  RPC_URL: string;
  /** Primary RPC (Worker secret, URL carries the API key). Never logged, pushed or returned. */
  HELIUS_RPC_URL?: string;
  CLUSTER?: string;
  STATUS_PUSH_TOKEN?: string;
};

// ms: wall time of the check, read by the API cron for the public status page (status.ts).
// provider (rpc only): which RPC answered, 'helius' (primary) or 'public' (fallback). When both
// fail it names the last one tried.
export type RpcProvider = 'helius' | 'public';
export type Check = {
  name: 'web' | 'api' | 'rpc';
  ok: boolean;
  detail: string;
  ms: number;
  provider?: RpcProvider;
};

/** Helius gets this long before the watchdog falls back to the public RPC. */
export const PRIMARY_RPC_TIMEOUT_MS = 4_000;

async function timed(f: typeof fetch, url: string, init: RequestInit = {}, ms = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function runChecks(env: WatchdogEnv, f: typeof fetch = fetch): Promise<Check[]> {
  const probe = async (name: Check['name'], run: () => Promise<string | null>): Promise<Check> => {
    const start = Date.now();
    try {
      const problem = await run();
      return { name, ok: problem === null, detail: problem ?? 'ok', ms: Date.now() - start };
    } catch (err) {
      return {
        name,
        ok: false,
        detail: `unreachable: ${(err as Error).message}`,
        ms: Date.now() - start,
      };
    }
  };
  return Promise.all([
    probe('web', async () => {
      const res = await timed(f, env.WEB_URL, { redirect: 'manual' });
      return res.status >= 500 ? `${env.WEB_URL} HTTP ${res.status}` : null;
    }),
    probe('api', async () => {
      const res = await timed(f, `${env.API_URL}/api/v1/health`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      return res.ok && body.ok ? null : `${env.API_URL}/api/v1/health HTTP ${res.status}`;
    }),
    checkRpc(env, f),
  ]);
}

/**
 * One getHealth call. Returns null when healthy, else a problem text that never holds the URL.
 * One deadline covers headers and body: a server that sends headers then stalls the body still
 * times out, so the fallback runs.
 */
async function rpcHealth(f: typeof fetch, url: string, ms: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: ctrl.signal,
    });
    // 429 means the RPC is up but rate-limiting us; treat as reachable.
    if (res.status === 429) return null;
    const read = res.json().catch((err: unknown) => {
      if ((err as Error)?.name === 'AbortError') throw err;
      return {};
    });
    const aborted = new Promise<never>((_, reject) =>
      ctrl.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      ),
    );
    if (ctrl.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const body = (await Promise.race([read, aborted])) as { result?: unknown };
    return body.result === 'ok'
      ? null
      : `getHealth HTTP ${res.status} ${typeof body.result === 'string' ? body.result : ''}`.trim();
  } catch (err) {
    // Only the error name: a message could echo the request URL (the Helius key).
    return (err as Error).name === 'AbortError' ? 'timeout' : 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * RPC check: Helius first (when HELIUS_RPC_URL is set), the public RPC_URL when Helius fails or
 * times out. Healthy if either answers; provider names the one that did.
 */
export async function checkRpc(env: WatchdogEnv, f: typeof fetch = fetch): Promise<Check> {
  // ms is the latency of the provider that answered (a Helius timeout before a fast fallback
  // must not read as a slow RPC on the status page).
  let start = Date.now();
  // provider is set only on success: a down RPC was answered by no provider.
  const done = (ok: boolean, detail: string, provider?: RpcProvider): Check => ({
    name: 'rpc',
    ok,
    detail,
    ms: Date.now() - start,
    ...(provider ? { provider } : {}),
  });
  let heliusProblem: string | null = null;
  if (env.HELIUS_RPC_URL) {
    heliusProblem = await rpcHealth(f, env.HELIUS_RPC_URL, PRIMARY_RPC_TIMEOUT_MS);
    if (heliusProblem === null) return done(true, 'ok (Helius)', 'helius');
  }
  if (!env.RPC_URL) return done(false, `Helius ${heliusProblem ?? 'not configured'}`);
  start = Date.now();
  const publicProblem = await rpcHealth(f, env.RPC_URL, 10_000);
  if (publicProblem === null) {
    return done(
      true,
      heliusProblem === null ? 'ok (public)' : `ok (public fallback; Helius ${heliusProblem})`,
      'public',
    );
  }
  return done(
    false,
    heliusProblem === null
      ? `RPC ${publicProblem}`
      : `Helius ${heliusProblem}; public ${publicProblem}`,
  );
}

/** Sends the checks to the API for the status page. Never throws: alerting must still run. */
export async function pushStatus(
  env: WatchdogEnv,
  checks: Check[],
  f: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.STATUS_PUSH_TOKEN) return false;
  try {
    const res = await timed(f, `${env.API_URL}/api/v1/internal/status/external`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.STATUS_PUSH_TOKEN}`,
      },
      body: JSON.stringify({
        checks: checks.map((c) => ({
          name: c.name,
          ok: c.ok,
          ms: Math.max(0, Math.round(c.ms)),
          ...(c.provider ? { provider: c.provider } : {}),
        })),
      }),
    });
    if (!res.ok) console.error('STATUS_PUSH', res.status);
    return res.ok;
  } catch (err) {
    // The API being down is exactly when this fails; the page then shows no data for the gap.
    console.error('STATUS_PUSH', (err as Error).message);
    return false;
  }
}

/**
 * Reports the health check (web + API; RPC has its own RPC_DOWN alert in the API) to the ops
 * alerts feed. Never throws. When the API is down the report cannot land; the assistant then
 * sees /internal/ops/alerts unreachable and this Worker's GET / failing.
 */
export async function reportHealth(
  env: WatchdogEnv,
  checks: Check[],
  f: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.STATUS_PUSH_TOKEN) return false;
  const failing = checks.filter((c) => c.name !== 'rpc' && !c.ok);
  const body = {
    check: 'health-check',
    source: 'watchdog',
    ok: failing.length === 0,
    detail: failing.length
      ? failing.map((c) => `${c.name}: ${c.detail}`).join('; ')
      : 'web, api ok (watchdog)',
  };
  try {
    const res = await timed(f, `${env.API_URL}/api/v1/internal/ops/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.STATUS_PUSH_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error('HEALTH_REPORT', res.status);
    return res.ok;
  } catch (err) {
    console.error('HEALTH_REPORT', (err as Error).message);
    return false;
  }
}

/** Log failing checks; delivery is via the assistant poller, not push. */
export async function watchdog(env: WatchdogEnv, f: typeof fetch = fetch): Promise<string[]> {
  const checks = await runChecks(env, f);
  await Promise.all([pushStatus(env, checks, f), reportHealth(env, checks, f)]);
  const logged: string[] = [];
  for (const c of checks) {
    if (c.ok) continue;
    console.error('ALERT', JSON.stringify(c));
    logged.push(`[TrenchMart ${env.CLUSTER || 'devnet'}] watchdog DOWN ${c.name}`);
  }
  return logged;
}

export default {
  async scheduled(
    _event: unknown,
    env: WatchdogEnv,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ) {
    ctx.waitUntil(watchdog(env));
  },
  // GET / returns the current check results (no secrets), for the assistant poller.
  async fetch(_request: Request, env: WatchdogEnv): Promise<Response> {
    const checks = await runChecks(env);
    return Response.json(
      { ok: checks.every((c) => c.ok), checks },
      { status: checks.every((c) => c.ok) ? 200 : 503 },
    );
  },
};
