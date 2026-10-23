// GET /api/v1/status: the sanitized, public view of the status tables (docs/ops/status-page.md).
// Every field is built here from an allowlist: component ids and names, states, timestamps and
// numbers. Nothing from ops_alerts, ops_events, env or the probe internals is ever read, so an
// alert message, wallet, balance, URL or secret cannot reach this response.
import type { Deps } from './logic';
import { STATUS_COMPONENTS, type ComponentId, type ProbeState } from './status';

export const STATUS_WINDOW_DAYS = 90;
/** A component whose newest probe is older than this shows as unknown (the cron is behind). */
export const STATUS_STALE_MS = 20 * 60_000;
/** Incidents seen on a single tick are blips: they stay in the bars, not in the history. */
const INCIDENT_MIN_MS = 5 * 60_000;

export type PublicState = ProbeState | 'unknown';
export type PublicDay = {
  date: string;
  state: ProbeState | 'none';
  /** Percent of probes that day that were not down, 2 decimals; null when there is no data. */
  uptime: number | null;
  samples: number;
};
export type PublicComponent = {
  id: ComponentId;
  name: string;
  state: PublicState;
  checkedAt: string | null;
  latencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  uptime90: number | null;
  /** rpc only: which RPC answered the newest probe ('helius' or 'public' fallback). */
  provider: 'helius' | 'public' | null;
  days: PublicDay[];
};
export type PublicIncident = {
  id: number;
  component: ComponentId;
  componentName: string;
  title: string;
  impact: 'minor' | 'major';
  status: 'ongoing' | 'resolved';
  startedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
};
export type PublicStatus = {
  checkedAt: string | null;
  generatedAt: string;
  cluster: string;
  overall: PublicState;
  intervalMinutes: number;
  windowDays: number;
  components: PublicComponent[];
  incidents: PublicIncident[];
};

const PROBE_STATES: readonly ProbeState[] = ['operational', 'degraded', 'down'];
const RANK: Record<PublicState, number> = { operational: 0, unknown: 1, degraded: 2, down: 3 };

function asState(value: unknown): ProbeState | null {
  return PROBE_STATES.includes(value as ProbeState) ? (value as ProbeState) : null;
}

function int(value: unknown): number | null {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : Math.round(n);
}

function pct(up: number, samples: number): number | null {
  return samples > 0 ? Math.round((up / samples) * 10_000) / 100 : null;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function utcDay(d: Date, offsetDays = 0): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + offsetDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function titleOf(name: string, worst: ProbeState): string {
  return worst === 'down' ? `${name} unavailable` : `${name} degraded`;
}

export async function publicStatus(deps: Deps): Promise<PublicStatus> {
  const now = deps.now();
  const known = new Set<string>(STATUS_COMPONENTS.map((c) => c.id));
  const firstDay = utcDay(now, -(STATUS_WINDOW_DAYS - 1));
  const [latest, latency, daily, incidents] = await Promise.all([
    deps.sql<
      {
        component: string;
        state: string;
        latency_ms: number | null;
        provider: string | null;
        checked_at: Date;
      }[]
    >`
      select distinct on (component) component, state, latency_ms, provider, checked_at
      from status_probes order by component, checked_at desc
    `,
    deps.sql<{ component: string; p50: number | null; p95: number | null }[]>`
      select component,
        percentile_cont(0.5) within group (order by latency_ms) as p50,
        percentile_cont(0.95) within group (order by latency_ms) as p95
      from status_probes where checked_at >= ${new Date(now.getTime() - 86_400_000)}
      group by component
    `,
    deps.sql<
      {
        day: string;
        component: string;
        samples: number;
        operational: number;
        degraded: number;
        down: number;
      }[]
    >`
      select day::text as day, component, samples, operational, degraded, down
      from status_daily where day >= ${firstDay}::date
    `,
    deps.sql<
      {
        id: string | number;
        component: string;
        worst: string;
        started_at: Date;
        last_seen_at: Date;
        resolved_at: Date | null;
      }[]
    >`
      select id, component, worst, started_at, last_seen_at, resolved_at from status_incidents
      where started_at >= ${new Date(`${firstDay}T00:00:00.000Z`)} or resolved_at is null
      order by started_at desc limit 200
    `,
  ]);

  const components: PublicComponent[] = STATUS_COMPONENTS.map(({ id, name }) => {
    const last = latest.find((r) => r.component === id);
    const lastAt = last ? iso(last.checked_at) : null;
    const fresh = lastAt !== null && now.getTime() - new Date(lastAt).getTime() <= STATUS_STALE_MS;
    const state: PublicState = fresh ? (asState(last?.state) ?? 'unknown') : 'unknown';
    const lat = latency.find((r) => r.component === id);
    let samples90 = 0;
    let up90 = 0;
    const days: PublicDay[] = [];
    for (let i = STATUS_WINDOW_DAYS - 1; i >= 0; i--) {
      const date = utcDay(now, -i);
      const row = daily.find((r) => r.component === id && r.day === date);
      const samples = int(row?.samples) ?? 0;
      if (!row || samples === 0) {
        days.push({ date, state: 'none', uptime: null, samples: 0 });
        continue;
      }
      const down = int(row.down) ?? 0;
      const degraded = int(row.degraded) ?? 0;
      samples90 += samples;
      up90 += samples - down;
      days.push({
        date,
        state: down > 0 ? 'down' : degraded > 0 ? 'degraded' : 'operational',
        uptime: pct(samples - down, samples),
        samples,
      });
    }
    return {
      id,
      name,
      state,
      checkedAt: lastAt,
      latencyMs: fresh ? int(last?.latency_ms) : null,
      p50Ms: int(lat?.p50),
      p95Ms: int(lat?.p95),
      uptime90: pct(up90, samples90),
      // Allowlisted provider name only (never a URL), and only while the probe is fresh.
      provider:
        id === 'rpc' && fresh && (last?.provider === 'helius' || last?.provider === 'public')
          ? last.provider
          : null,
      days,
    };
  });

  const nameOf = new Map<string, string>(STATUS_COMPONENTS.map((c) => [c.id, c.name]));
  const publicIncidents: PublicIncident[] = [];
  for (const row of incidents) {
    const worst = asState(row.worst);
    if (!known.has(row.component) || !worst || worst === 'operational') continue;
    const started = new Date(row.started_at);
    const seen = new Date(row.last_seen_at);
    const resolved = row.resolved_at ? new Date(row.resolved_at) : null;
    if (resolved && seen.getTime() - started.getTime() < INCIDENT_MIN_MS) continue;
    const end = resolved ?? now;
    const name = nameOf.get(row.component)!;
    publicIncidents.push({
      id: Number(row.id),
      component: row.component as ComponentId,
      componentName: name,
      title: titleOf(name, worst),
      impact: worst === 'down' ? 'major' : 'minor',
      status: resolved ? 'resolved' : 'ongoing',
      startedAt: started.toISOString(),
      resolvedAt: resolved ? resolved.toISOString() : null,
      durationMinutes: Math.max(0, Math.round((end.getTime() - started.getTime()) / 60_000)),
    });
    if (publicIncidents.length >= 50) break;
  }

  const states = components.map((c) => c.state);
  const overall: PublicState = states.every((s) => s === 'unknown')
    ? 'unknown'
    : states.reduce<PublicState>((a, b) => (RANK[b] > RANK[a] ? b : a), 'operational');
  const checkedAt = components
    .map((c) => c.checkedAt)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);
  return {
    checkedAt: checkedAt ?? null,
    generatedAt: now.toISOString(),
    cluster: deps.env.cluster,
    overall,
    intervalMinutes: 5,
    windowDays: STATUS_WINDOW_DAYS,
    components,
    incidents: publicIncidents,
  };
}
