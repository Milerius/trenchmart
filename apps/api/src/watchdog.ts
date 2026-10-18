// External watchdog (docs/ops/monitoring.md): a separate tiny Worker with its own 5-minute cron
// that checks the web app, the API and the Solana RPC from outside the API Worker, so an API
// outage (which also stops the API's own cron alerts) still pages the owner.
// Deployed with `wrangler deploy -c watchdog.wrangler.toml`. Stateless: it reads its own recent
// ntfy messages to send DOWN once per 6 h per target and UP once on recovery.

import { postNtfy } from './ops';

export type WatchdogEnv = {
  WEB_URL: string;
  API_URL: string;
  RPC_URL: string;
  ALERT_NTFY_SERVER?: string;
  ALERT_NTFY_TOPIC?: string;
  ALERT_EMAIL?: string;
  ALERT_NTFY_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  CLUSTER?: string;
};

type Check = { name: 'web' | 'api' | 'rpc'; ok: boolean; detail: string };

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
    try {
      const problem = await run();
      return { name, ok: problem === null, detail: problem ?? 'ok' };
    } catch (err) {
      return { name, ok: false, detail: `unreachable: ${(err as Error).message}` };
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
      // Shared public endpoints rate-limit Cloudflare's egress IPs: 429 means reachable.
      if (res.status === 429) return null;
      const body = (await res.json().catch(() => ({}))) as { result?: string };
      return body.result === 'ok'
        ? null
        : `RPC getHealth HTTP ${res.status} ${body.result ?? ''}`.trim();
    }),
  ]);
}

/** Last DOWN/UP title per target in the past 6 h, read back from the ntfy topic. */
async function lastStates(env: WatchdogEnv, f: typeof fetch): Promise<Map<string, 'DOWN' | 'UP'>> {
  const states = new Map<string, 'DOWN' | 'UP'>();
  const server = env.ALERT_NTFY_SERVER || 'https://ntfy.sh';
  const res = await timed(f, `${server}/${env.ALERT_NTFY_TOPIC}/json?poll=1&since=6h`);
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line) as { title?: string };
      const hit = /watchdog (DOWN|UP) (web|api|rpc)/.exec(m.title ?? '');
      if (hit) states.set(hit[2]!, hit[1] as 'DOWN' | 'UP');
    } catch {
      /* keepalive or partial line */
    }
  }
  return states;
}

export async function watchdog(env: WatchdogEnv, f: typeof fetch = fetch): Promise<string[]> {
  const checks = await runChecks(env, f);
  const sent: string[] = [];
  if (!env.ALERT_NTFY_TOPIC) {
    for (const c of checks) if (!c.ok) console.error('ALERT', JSON.stringify(c));
    return sent;
  }
  const states = await lastStates(env, f).catch(() => new Map<string, 'DOWN' | 'UP'>());
  const cluster = env.CLUSTER || 'devnet';
  for (const c of checks) {
    const last = states.get(c.name);
    const verdict = c.ok ? (last === 'DOWN' ? 'UP' : null) : last === 'DOWN' ? null : 'DOWN';
    if (!c.ok) console.error('ALERT', JSON.stringify(c));
    if (!verdict) continue;
    const title = `[TrenchMart ${cluster}] watchdog ${verdict} ${c.name}`;
    const body = `${c.detail}\n\nRunbook: https://github.com/Milerius/trenchmart/blob/main/docs/ops/monitoring.md#${verdict === 'DOWN' ? `${c.name}_down` : 'recovery'}`;
    const headers: Record<string, string> = {
      Title: title,
      Priority: verdict === 'DOWN' ? 'urgent' : 'default',
      Tags: verdict === 'DOWN' ? 'rotating_light' : 'white_check_mark',
    };
    await postNtfy(
      f,
      {
        alertNtfyServer: env.ALERT_NTFY_SERVER || 'https://ntfy.sh',
        alertNtfyTopic: env.ALERT_NTFY_TOPIC,
        alertEmail: env.ALERT_EMAIL ?? '',
        alertNtfyToken: env.ALERT_NTFY_TOKEN ?? '',
      },
      headers,
      body,
    ).catch(() => null);
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
      await timed(f, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `${title}\n\n${body}` }),
      }).catch(() => null);
    sent.push(title);
  }
  return sent;
}

export default {
  async scheduled(
    _event: unknown,
    env: WatchdogEnv,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ) {
    ctx.waitUntil(watchdog(env));
  },
  // GET / returns the current check results (no secrets), for a quick manual look.
  async fetch(_request: Request, env: WatchdogEnv): Promise<Response> {
    const checks = await runChecks(env);
    return Response.json(
      { ok: checks.every((c) => c.ok), checks },
      { status: checks.every((c) => c.ok) ? 200 : 503 },
    );
  },
};
