// Public status page data (docs/ops/status-page.md).
//
// Every 5-minute cron tick (worker.ts) runs statusTick(): one light probe per public component,
// timed, merged with the ops alerts of the same tick, then stored in status_probes. Incidents open
// when a component stops being operational and resolve when it is again; status_daily rolls the
// probes up per UTC day for the 90-day bars. Stored rows hold component ids, states and numbers
// only. Alert messages, addresses, balances and URLs never reach these tables.
//
// Web, API and Solana RPC are measured from outside the API Worker: the external watchdog pushes
// its 5-minute checks to POST /internal/status/external (recordExternal). The API cannot ask the
// watchdog itself: Cloudflare blocks the watchdog's fetch back to the calling Worker (a loop), so
// the API row read "down" on every tick. Without STATUS_PUSH_TOKEN (local runs, tests) the cron
// probes the three directly instead.
import type { Deps } from './logic';
import type { OpsAlert } from './ops';

export const STATUS_COMPONENTS = [
  { id: 'web', name: 'Website', slowMs: 2500 },
  { id: 'api', name: 'API', slowMs: 1500 },
  { id: 'rpc', name: 'Solana RPC', slowMs: 2000 },
  { id: 'escrow', name: 'Escrow program & resolver', slowMs: 2000 },
  { id: 'db', name: 'Database', slowMs: 750 },
  { id: 'uploads', name: 'Uploads & scanning', slowMs: 2500 },
  { id: 'auth', name: 'Sign-in', slowMs: 1000 },
] as const;

export type ComponentId = (typeof STATUS_COMPONENTS)[number]['id'];
export type ProbeState = 'operational' | 'degraded' | 'down';
export type Probe = { component: ComponentId; state: ProbeState; latencyMs: number | null };

/** Probe rows are kept this long; the daily roll-up keeps the 90-day history. */
export const STATUS_RETENTION = { probesDays: 14, dailyDays: 100 };

/**
 * Ops alert codes that make a public component degraded or down. Only the component and the
 * state cross over: the alert's message (which can name wallets, balances or files) never does.
 * Codes not listed here (disputes, payouts, ...) are internal and never affect the public page.
 */
export const ALERT_COMPONENT: Readonly<Record<string, readonly [ComponentId, ProbeState]>> = {
  WEB_DOWN: ['web', 'degraded'],
  RPC_DOWN: ['rpc', 'degraded'],
  HTTP_5XX_SPIKE: ['api', 'degraded'],
  DB_ERROR: ['db', 'down'],
  SCHEMA_BEHIND: ['db', 'degraded'],
  DB_POOL_FULL: ['db', 'degraded'],
  R2_ERROR: ['uploads', 'degraded'],
  SCAN_ERRORS: ['uploads', 'degraded'],
  SCAN_STUCK: ['uploads', 'degraded'],
  RELEASE_STUCK: ['escrow', 'degraded'],
  LOW_BALANCE: ['escrow', 'degraded'],
  RESOLVER_MISCONFIGURED: ['escrow', 'degraded'],
  UPGRADE_AUTHORITY_CHANGED: ['escrow', 'degraded'],
  WEBHOOK_FAILED: ['escrow', 'degraded'],
  CHECKOUT_PAUSED: ['escrow', 'degraded'],
};

const RANK: Record<ProbeState, number> = { operational: 0, degraded: 1, down: 2 };

export function worse(a: ProbeState, b: ProbeState): ProbeState {
  return RANK[a] >= RANK[b] ? a : b;
}

function slowMs(id: ComponentId): number {
  return STATUS_COMPONENTS.find((c) => c.id === id)!.slowMs;
}

function stateOf(id: ComponentId, ok: boolean, ms: number | null): ProbeState {
  if (!ok) return 'down';
  return ms !== null && ms > slowMs(id) ? 'degraded' : 'operational';
}

async function timedFetch(f: typeof fetch, url: string, init: RequestInit = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `check`, timing it. A throw counts as a failed check. */
async function measure(id: ComponentId, check: () => Promise<boolean>): Promise<Probe> {
  const start = Date.now();
  const ok = await check().catch(() => false);
  const ms = Date.now() - start;
  return { component: id, state: stateOf(id, ok, ms), latencyMs: ms };
}

/** Same three checks as the watchdog, made from here (local runs without a push token). */
async function direct(deps: Deps): Promise<Probe[]> {
  const f = deps.opsFetch ?? fetch;
  const { appUrl, apiUrl, rpcUrl } = deps.env;
  return Promise.all([
    measure('web', async () => {
      const res = await timedFetch(f, appUrl, { redirect: 'manual' });
      return res.status < 500;
    }),
    measure('api', async () => {
      const res = await timedFetch(f, `${apiUrl}/api/v1/health`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      return res.ok && body.ok === true;
    }),
    measure('rpc', async () => {
      const res = await timedFetch(f, rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      // 429: the RPC is up and rate-limiting us.
      if (res.status === 429) return true;
      const body = (await res.json().catch(() => ({}))) as { result?: string };
      return body.result === 'ok';
    }),
  ]);
}

/**
 * Sign-in writes a nonce, the same insert as POST /auth/nonce. The probe writes an already-expired
 * one (unusable), times only the insert, and deletes the row afterwards, outside the timing.
 */
async function probeDbThenAuth(deps: Deps): Promise<[Probe, Probe]> {
  const db = await measure('db', async () => {
    await deps.sql`select 1`;
    return true;
  });
  const nonce = `status-probe-${crypto.randomUUID()}`;
  const auth = await measure('auth', async () => {
    await deps.sql`
      insert into auth_nonces (nonce, wallet, expires_at)
      values (${nonce}, 'status-probe', ${new Date(0)})
    `;
    return true;
  });
  await deps.sql`delete from auth_nonces where nonce = ${nonce}`.catch(() => undefined);
  return [db, auth];
}

/** One light probe per public component, then the ops alerts of the same tick on top. */
export async function runStatusProbes(deps: Deps, alerts: OpsAlert[] = []): Promise<Probe[]> {
  // With a push token the watchdog reports these three from outside (recordExternal).
  const external = deps.env.statusPushToken ? [] : await direct(deps);
  // Database then sign-in run one after the other, so sign-in reuses the connection the database
  // probe opened. Run side by side, with the cleanup delete inside the timing, the sign-in row
  // read ~1.2 s ("degraded") on every cron tick while the real POST /auth/nonce answered in
  // ~0.4 s. Escrow and uploads touch other services, so they still run alongside.
  const [escrow, uploads, [db, auth]] = await Promise.all([
    deps.env.escrowProgramId && deps.escrowChain
      ? measure('escrow', async () => {
          const program = await deps.escrowChain!.account(deps.env.escrowProgramId);
          return program !== null && program.data.length > 0;
        })
      : null,
    measure('uploads', async () => {
      const key = 'status/probe';
      const stamp = new TextEncoder().encode(String(Date.now()));
      await deps.blob.put(key, stamp);
      const back = await deps.blob.get(key);
      await deps.blob.delete(key);
      return back !== null && back.length === stamp.length;
    }),
    probeDbThenAuth(deps),
  ]);
  const internal = [escrow, db, uploads, auth];
  const probes = [...external, ...internal.filter((p): p is Probe => p !== null)];
  return applyAlerts(
    probes,
    alerts.map((a) => a.code),
  );
}

/** Makes components worse for each mapped alert code (codes only; messages never cross over). */
function applyAlerts(probes: Probe[], codes: string[]): Probe[] {
  for (const code of codes) {
    const mapped = ALERT_COMPONENT[code];
    if (!mapped) continue;
    const probe = probes.find((p) => p.component === mapped[0]);
    if (probe) probe.state = worse(probe.state, mapped[1]);
  }
  return probes;
}

export type ExternalCheck = { name: 'web' | 'api' | 'rpc'; ok: boolean; ms: number };

/**
 * Stores the watchdog's pushed web/API/RPC checks as probes. Open ops alerts (codes only) for
 * those components are applied like on the cron tick.
 */
export async function recordExternal(deps: Deps, checks: ExternalCheck[]): Promise<Probe[]> {
  const probes: Probe[] = checks.map((c) => {
    const ms = Math.round(c.ms);
    return { component: c.name, state: stateOf(c.name, c.ok, ms), latencyMs: ms };
  });
  const open = await deps.sql<{ code: string }[]>`
    select code from ops_alerts where resolved_at is null
  `;
  applyAlerts(
    probes,
    open.map((r) => r.code),
  );
  await recordStatus(deps, probes);
  return probes;
}

/** Stores one tick of probes and opens, escalates or resolves incidents. */
export async function recordStatus(deps: Deps, probes: Probe[]): Promise<void> {
  if (probes.length === 0) return;
  const at = deps.now();
  const rows = probes.map((p) => ({
    component: p.component,
    state: p.state,
    latency_ms: p.latencyMs,
    checked_at: at,
  }));
  await deps.sql`
    insert into status_probes ${deps.sql(rows, 'component', 'state', 'latency_ms', 'checked_at')}
  `;
  for (const p of probes) {
    if (p.state === 'operational') {
      await deps.sql`
        update status_incidents set resolved_at = ${at}
        where component = ${p.component} and resolved_at is null
      `;
    } else {
      await deps.sql`
        insert into status_incidents (component, worst, started_at, last_seen_at)
        values (${p.component}, ${p.state}, ${at}, ${at})
        on conflict (component) where resolved_at is null do update set
          last_seen_at = excluded.last_seen_at,
          worst = case when status_incidents.worst = 'down' or excluded.worst = 'down'
            then 'down' else 'degraded' end
      `;
    }
  }
}

function utcDay(d: Date, offsetDays = 0): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + offsetDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Recomputes yesterday and today in status_daily, then drops rows past retention. */
export async function rollupStatus(deps: Deps): Promise<void> {
  const now = deps.now();
  const from = new Date(`${utcDay(now, -1)}T00:00:00.000Z`);
  await deps.sql`
    insert into status_daily (day, component, samples, operational, degraded, down, p50_ms, p95_ms)
    select (checked_at at time zone 'UTC')::date, component, count(*)::int,
      (count(*) filter (where state = 'operational'))::int,
      (count(*) filter (where state = 'degraded'))::int,
      (count(*) filter (where state = 'down'))::int,
      round(percentile_cont(0.5) within group (order by latency_ms))::int,
      round(percentile_cont(0.95) within group (order by latency_ms))::int
    from status_probes where checked_at >= ${from}
    group by 1, 2
    on conflict (day, component) do update set samples = excluded.samples,
      operational = excluded.operational, degraded = excluded.degraded, down = excluded.down,
      p50_ms = excluded.p50_ms, p95_ms = excluded.p95_ms
  `;
  await deps.sql`
    delete from status_probes
    where checked_at < ${new Date(now.getTime() - STATUS_RETENTION.probesDays * 86_400_000)}
  `;
  await deps.sql`
    delete from status_daily where day < ${utcDay(now, -STATUS_RETENTION.dailyDays)}::date
  `;
}

/** The cron step: probe, store, roll up. Returns the probes (internal endpoint, logs). */
export async function statusTick(deps: Deps, alerts: OpsAlert[] = []): Promise<Probe[]> {
  const probes = await runStatusProbes(deps, alerts);
  await recordStatus(deps, probes);
  await rollupStatus(deps);
  return probes;
}
