import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { createApp } from './app';
import type { OpsAlert } from './ops';
import {
  STATUS_COMPONENTS,
  recordStatus,
  rollupStatus,
  runStatusProbes,
  statusTick,
} from './status';
import { STATUS_TOKEN, statusSetup } from './status-fixtures';

// Status page probes against real Postgres (docs/ops/status-page.md).
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
let sql: Sql;
const clock = { now: new Date('2026-10-18T06:00:00.000Z') };
const ids = STATUS_COMPONENTS.map((c) => c.id);
const byId = (probes: { component: string; state: string }[]) =>
  Object.fromEntries(probes.map((p) => [p.component, p.state]));

describe('status page probes', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`truncate table status_probes, status_daily, status_incidents restart identity`;
    clock.now = new Date('2026-10-18T06:00:00.000Z');
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('records one operational probe per component with its latency', async () => {
    const { deps, world } = await statusSetup(sql, clock);
    const probes = await statusTick(deps);
    expect(probes.map((p) => p.component).sort()).toEqual([...ids].sort());
    expect(probes.every((p) => p.state === 'operational')).toBe(true);
    expect(probes.every((p) => Number.isInteger(p.latencyMs) && p.latencyMs! >= 0)).toBe(true);
    // Web, API and RPC come from the watchdog (its reported latency), not from direct fetches.
    expect(
      byId(probes.map((p) => ({ component: p.component, state: String(p.latencyMs) }))),
    ).toMatchObject({
      web: '120',
      api: '80',
      rpc: '150',
    });
    expect(world.direct).toEqual([]);
    const rows = await sql<{ component: string; state: string }[]>`
      select component, state from status_probes order by component
    `;
    expect(rows.map((r) => r.component)).toEqual([...ids].sort());
    // The auth probe leaves no nonce behind.
    expect(await sql`select 1 from auth_nonces where wallet = 'status-probe'`).toHaveLength(0);
    expect(await sql`select 1 from status_incidents`).toHaveLength(0);
  });

  it('probes web, API and RPC directly when the watchdog binding is absent or broken', async () => {
    const { deps, world } = await statusSetup(sql, clock);
    world.watchdog = null;
    expect(Object.values(byId(await runStatusProbes(deps)))).toEqual(ids.map(() => 'operational'));
    expect(world.direct.sort()).toEqual(['api.example', 'rpc.example', 'web.example']);
    world.direct = [];
    world.watchdog = 'broken';
    world.api = false;
    expect(byId(await runStatusProbes(deps)).api).toBe('down');
    expect(world.direct).toContain('api.example');
  });

  it('marks failures down, slow answers degraded', async () => {
    const { deps, world } = await statusSetup(sql, clock);
    world.web = 502;
    world.rpc = false;
    world.program = false;
    world.blobBroken = true;
    world.watchdogMs.api = 4000;
    const states = byId(await runStatusProbes(deps));
    expect(states).toMatchObject({
      web: 'down',
      rpc: 'down',
      escrow: 'down',
      uploads: 'down',
      api: 'degraded',
      db: 'operational',
      auth: 'operational',
    });
  });

  it('maps ops alerts onto components without carrying their messages', async () => {
    const { deps } = await statusSetup(sql, clock);
    const wallet = 'HSGhq8Yx1yzSJ3vXwXrEJm5KHuK3G3NJ9bQ6P9Yq5pZ8';
    const alerts: OpsAlert[] = [
      {
        level: 'critical',
        code: 'LOW_BALANCE',
        message: `fee payer (crank) ${wallet} holds 0.01 SOL`,
      },
      { level: 'critical', code: 'SCHEMA_BEHIND', message: 'missing 0099_secret.sql' },
      { level: 'warn', code: 'SCAN_STUCK', message: '2 version(s) stuck' },
      { level: 'warn', code: 'DISPUTES_WAITING', message: '1 dispute(s) open' },
    ];
    const probes = await statusTick(deps, alerts);
    expect(byId(probes)).toMatchObject({
      escrow: 'degraded',
      db: 'degraded',
      uploads: 'degraded',
      web: 'operational',
      api: 'operational',
      auth: 'operational',
    });
    const dump = JSON.stringify(
      [
        await sql`select * from status_probes`,
        await sql`select * from status_incidents`,
        await sql`select * from status_daily`,
      ],
      (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    );
    for (const leak of [
      wallet,
      'SOL',
      '0099_secret',
      'LOW_BALANCE',
      'dispute',
      'web.example',
      'HTTP',
    ])
      expect(dump).not.toContain(leak);
  });

  it('opens one incident per component, escalates it, and resolves it on recovery', async () => {
    const { deps, world } = await statusSetup(sql, clock);
    world.watchdogMs.rpc = 5000;
    await statusTick(deps);
    clock.now = new Date(clock.now.getTime() + 5 * 60_000);
    world.rpc = false;
    await statusTick(deps);
    clock.now = new Date(clock.now.getTime() + 5 * 60_000);
    world.rpc = true;
    world.watchdogMs.rpc = 150;
    await statusTick(deps);
    const incidents = await sql<
      {
        component: string;
        worst: string;
        started_at: Date;
        last_seen_at: Date;
        resolved_at: Date | null;
      }[]
    >`select component, worst, started_at, last_seen_at, resolved_at from status_incidents`;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ component: 'rpc', worst: 'down' });
    expect(incidents[0]!.started_at.toISOString()).toBe('2026-10-18T06:00:00.000Z');
    expect(incidents[0]!.last_seen_at.toISOString()).toBe('2026-10-18T06:05:00.000Z');
    expect(incidents[0]!.resolved_at?.toISOString()).toBe('2026-10-18T06:10:00.000Z');
    // A later failure opens a new incident rather than reopening the resolved one.
    clock.now = new Date(clock.now.getTime() + 5 * 60_000);
    world.rpc = false;
    await statusTick(deps);
    expect(await sql`select 1 from status_incidents where resolved_at is null`).toHaveLength(1);
    expect(await sql`select 1 from status_incidents`).toHaveLength(2);
  });

  it('rolls probes up per UTC day with uptime counts and p50/p95, and prunes old rows', async () => {
    const { deps } = await statusSetup(sql, clock);
    const day = (iso: string, state: 'operational' | 'degraded' | 'down', latencyMs: number) => {
      clock.now = new Date(iso);
      return recordStatus(deps, [{ component: 'api', state, latencyMs }]);
    };
    await day('2026-10-17T23:55:00.000Z', 'down', 900);
    for (let i = 1; i <= 19; i++)
      await day(`2026-10-18T00:${String(i * 2).padStart(2, '0')}:00.000Z`, 'operational', i * 10);
    await day('2026-10-18T01:00:00.000Z', 'degraded', 2000);
    await sql`insert into status_probes (component, state, latency_ms, checked_at) values ('api', 'down', 1, ${new Date('2026-09-01T00:00:00Z')})`;
    await sql`insert into status_daily (day, component, samples, operational, degraded, down) values ('2026-06-01', 'api', 1, 1, 0, 0), ('2026-08-01', 'api', 1, 1, 0, 0)`;
    clock.now = new Date('2026-10-18T01:00:00.000Z');
    await rollupStatus(deps);
    const rows = await sql<Record<string, unknown>[]>`
      select day::text as day, samples, operational, degraded, down, p50_ms, p95_ms
      from status_daily where component = 'api' order by day
    `;
    expect(rows).toEqual([
      {
        day: '2026-08-01',
        samples: 1,
        operational: 1,
        degraded: 0,
        down: 0,
        p50_ms: null,
        p95_ms: null,
      },
      {
        day: '2026-10-17',
        samples: 1,
        operational: 0,
        degraded: 0,
        down: 1,
        p50_ms: 900,
        p95_ms: 900,
      },
      {
        day: '2026-10-18',
        samples: 20,
        operational: 19,
        degraded: 1,
        down: 0,
        p50_ms: 105,
        p95_ms: 281,
      },
    ]);
    // 14 days of raw probes, about 100 days of roll-up.
    expect(await sql`select 1 from status_probes where checked_at < '2026-10-01'`).toHaveLength(0);
  });

  it('POST /internal/status/run needs the internal token and runs one tick', async () => {
    const { deps } = await statusSetup(sql, clock);
    const app = createApp(deps);
    const denied = await app.request('/api/v1/internal/status/run', { method: 'POST' });
    expect(denied.status).toBe(401);
    expect(await sql`select 1 from status_probes`).toHaveLength(0);
    const res = await app.request('/api/v1/internal/status/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${STATUS_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { probes: { component: string; state: string }[] };
    expect(body.probes).toHaveLength(ids.length);
    expect(await sql`select 1 from status_probes`).toHaveLength(ids.length);
  });
});
