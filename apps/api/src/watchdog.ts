// External watchdog (docs/ops/monitoring.md): a separate tiny Worker with its own 5-minute cron
// that checks the web app, the API and the Solana RPC from outside the API Worker, so an API
// outage (which also stops the API's own cron alerts) still surfaces. Deployed with
// `wrangler deploy -c watchdog.wrangler.toml`. Alert delivery is chat-only: the owner's
// assistant polls GET / (this Worker) and GET /api/v1/internal/ops/alerts every 10 min.
// Each cron tick also pushes the checks (name, ok, ms; never the detail text) to the API's
// POST /api/v1/internal/status/external for the public status page (status.ts), authenticated
// with STATUS_PUSH_TOKEN (a Worker secret that can do nothing else). Unset = no push.
// Failures are logged as `ALERT {...}` in Workers Logs; there is no ntfy/email/Telegram push.

export type WatchdogEnv = {
  WEB_URL: string;
  API_URL: string;
  RPC_URL: string;
  CLUSTER?: string;
  STATUS_PUSH_TOKEN?: string;
};

// ms: wall time of the check, read by the API cron for the public status page (status.ts).
export type Check = { name: 'web' | 'api' | 'rpc'; ok: boolean; detail: string; ms: number };

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
    probe('rpc', async () => {
      const res = await timed(f, env.RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      // 429 means the RPC is up but rate-limiting us; treat as reachable.
      if (res.status === 429) return null;
      const body = (await res.json().catch(() => ({}))) as { result?: string };
      return body.result === 'ok'
        ? null
        : `RPC getHealth HTTP ${res.status} ${body.result ?? ''}`.trim();
    }),
  ]);
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
        checks: checks.map((c) => ({ name: c.name, ok: c.ok, ms: Math.max(0, Math.round(c.ms)) })),
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

/** Log failing checks; delivery is via the assistant poller, not push. */
export async function watchdog(env: WatchdogEnv, f: typeof fetch = fetch): Promise<string[]> {
  const checks = await runChecks(env, f);
  await pushStatus(env, checks, f);
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
