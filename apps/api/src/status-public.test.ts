import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { createApp } from './app';
import { ruleFor } from './edge-cache';
import type { OpsAlert } from './ops';
import { recordOpsEvent } from './ops';
import { STATUS_COMPONENTS, recordStatus, rollupStatus, statusTick } from './status';
import { STATUS_TOKEN, statusSetup } from './status-fixtures';
import type { PublicStatus } from './status-public';

// GET /api/v1/status against real Postgres: shape, 90-day bars, incidents, and no leaks.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
let sql: Sql;
const clock = { now: new Date('2026-10-18T06:00:00.000Z') };
const WALLET = 'HSGhq8Yx1yzSJ3vXwXrEJm5KHuK3G3NJ9bQ6P9Yq5pZ8';

/** Every key path in a JSON value (array items collapse to []). */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => keyPaths(v, `${prefix}[]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => [
      `${prefix}.${k}`,
      ...keyPaths(v, `${prefix}.${k}`),
    ]);
  return [];
}

const ALLOWED = new Set([
  '.checkedAt',
  '.generatedAt',
  '.cluster',
  '.overall',
  '.intervalMinutes',
  '.windowDays',
  '.components',
  '.components[].id',
  '.components[].name',
  '.components[].state',
  '.components[].checkedAt',
  '.components[].latencyMs',
  '.components[].p50Ms',
  '.components[].p95Ms',
  '.components[].uptime90',
  '.components[].provider',
  '.components[].days',
  '.components[].days[].date',
  '.components[].days[].state',
  '.components[].days[].uptime',
  '.components[].days[].samples',
  '.incidents',
  '.incidents[].id',
  '.incidents[].component',
  '.incidents[].componentName',
  '.incidents[].title',
  '.incidents[].impact',
  '.incidents[].status',
  '.incidents[].startedAt',
  '.incidents[].resolvedAt',
  '.incidents[].durationMinutes',
]);

async function get(app: ReturnType<typeof createApp>, headers: Record<string, string> = {}) {
  const res = await app.request('/api/v1/status', { headers });
  expect(res.status).toBe(200);
  return { res, body: (await res.json()) as PublicStatus };
}

describe('GET /api/v1/status', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`truncate table status_probes, status_daily, status_incidents restart identity`;
    clock.now = new Date('2026-10-18T06:00:00.000Z');
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('with no history: every component unknown and 90 grey no-data days', async () => {
    const { deps } = await statusSetup(sql, clock);
    const { body } = await get(createApp(deps));
    expect(body.overall).toBe('unknown');
    expect(body.checkedAt).toBeNull();
    expect(body.windowDays).toBe(90);
    expect(body.components.map((c) => c.id)).toEqual(STATUS_COMPONENTS.map((c) => c.id));
    for (const c of body.components) {
      expect(c).toMatchObject({ state: 'unknown', latencyMs: null, uptime90: null, p50Ms: null });
      expect(c.days).toHaveLength(90);
      expect(c.days.every((d) => d.state === 'none' && d.uptime === null && d.samples === 0)).toBe(
        true,
      );
    }
    expect(body.components[0]!.days[0]!.date).toBe('2026-07-21');
    expect(body.components[0]!.days[89]!.date).toBe('2026-10-18');
    expect(body.incidents).toEqual([]);
  });

  it('after a tick: current state, latency, today filled in, older days still no data', async () => {
    const { deps } = await statusSetup(sql, clock);
    await statusTick(deps);
    const { body, res } = await get(createApp(deps));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(body.overall).toBe('operational');
    expect(body.checkedAt).toBe('2026-10-18T06:00:00.000Z');
    const api = body.components.find((c) => c.id === 'api')!;
    expect(api.state).toBe('operational');
    expect(api.latencyMs).toBeGreaterThanOrEqual(0);
    expect(api.p50Ms).toBe(api.latencyMs);
    expect(api.uptime90).toBe(100);
    expect(api.days[89]).toEqual({
      date: '2026-10-18',
      state: 'operational',
      uptime: 100,
      samples: 1,
    });
    expect(api.days.slice(0, 89).every((d) => d.state === 'none')).toBe(true);
  });

  it('colours days by their worst probe, computes uptime, and goes unknown when stale', async () => {
    const { deps } = await statusSetup(sql, clock);
    const tick = async (iso: string, state: 'operational' | 'degraded' | 'down') => {
      clock.now = new Date(iso);
      await recordStatus(deps, [{ component: 'rpc', state, latencyMs: 100 }]);
      await rollupStatus(deps);
    };
    await tick('2026-10-16T10:00:00.000Z', 'operational');
    await tick('2026-10-16T10:05:00.000Z', 'degraded');
    await tick('2026-10-17T10:00:00.000Z', 'operational');
    await tick('2026-10-17T10:05:00.000Z', 'operational');
    await tick('2026-10-17T10:10:00.000Z', 'operational');
    await tick('2026-10-17T10:15:00.000Z', 'down');
    await tick('2026-10-18T05:55:00.000Z', 'operational');
    clock.now = new Date('2026-10-18T06:00:00.000Z');
    const rpc = (await get(createApp(deps))).body.components.find((c) => c.id === 'rpc')!;
    expect(rpc.days.slice(-3).map((d) => [d.date, d.state, d.uptime])).toEqual([
      ['2026-10-16', 'degraded', 100],
      ['2026-10-17', 'down', 75],
      ['2026-10-18', 'operational', 100],
    ]);
    expect(rpc.uptime90).toBe(85.71);
    expect(rpc.state).toBe('operational');
    clock.now = new Date('2026-10-18T06:30:00.000Z');
    const stale = (await get(createApp(deps))).body.components.find((c) => c.id === 'rpc')!;
    expect(stale).toMatchObject({ state: 'unknown', latencyMs: null });
  });

  it('lists incidents in plain words, skips single-tick blips, keeps ongoing ones', async () => {
    const { deps, world } = await statusSetup(sql, clock);
    const step = () => (clock.now = new Date(clock.now.getTime() + 5 * 60_000));
    // RPC down for three ticks, then back.
    world.rpc = false;
    await statusTick(deps);
    step();
    await statusTick(deps);
    step();
    await statusTick(deps);
    step();
    world.rpc = true;
    // A one-tick slow upload probe: shown in the bar, not in the history.
    world.blobBroken = true;
    await statusTick(deps);
    step();
    world.blobBroken = false;
    await statusTick(deps);
    step();
    // Escrow degraded by an alert and still ongoing.
    const alerts: OpsAlert[] = [
      { level: 'critical', code: 'LOW_BALANCE', message: `resolver ${WALLET} holds 0.01 SOL` },
    ];
    await statusTick(deps, alerts);
    const { body } = await get(createApp(deps));
    expect(body.incidents.map((i) => [i.title, i.impact, i.status, i.durationMinutes])).toEqual([
      ['Escrow program & resolver degraded', 'minor', 'ongoing', 0],
      ['Solana RPC unavailable', 'major', 'resolved', 15],
    ]);
    expect(body.overall).toBe('degraded');
    const uploads = body.components.find((c) => c.id === 'uploads')!;
    expect(uploads.days[89]!.state).toBe('down');
  });

  it('never leaks internal fields, alert text, wallets, balances, URLs or secrets', async () => {
    const { deps, world } = await statusSetup(sql, clock);
    await sql`
      insert into ops_alerts (code, level, message, first_at, last_at)
      values ('LOW_BALANCE', 'critical', ${`fee payer (crank) ${WALLET} holds 0.01 SOL`}, now(), now())
      on conflict (code) do update set message = excluded.message
    `;
    await recordOpsEvent(deps, '5xx', 'GET /api/v1/internal/ops boom at https://rpc.example');
    world.web = 502;
    world.blobBroken = true;
    const alerts: OpsAlert[] = [
      { level: 'critical', code: 'LOW_BALANCE', message: `resolver ${WALLET} holds 0.01 SOL` },
      { level: 'critical', code: 'SCHEMA_BEHIND', message: 'missing 0099_secret.sql' },
      { level: 'critical', code: 'UPGRADE_AUTHORITY_CHANGED', message: `authority ${WALLET}` },
    ];
    await statusTick(deps, alerts);
    clock.now = new Date(clock.now.getTime() + 5 * 60_000);
    await statusTick(deps, alerts);
    // Signed in or not, same public body.
    const variants: Record<string, string>[] = [{}, { authorization: `Bearer ${STATUS_TOKEN}` }];
    for (const headers of variants) {
      const { body } = await get(createApp(deps), headers);
      for (const path of new Set(keyPaths(body))) expect(ALLOWED, path).toContain(path);
      const text = JSON.stringify(body);
      for (const leak of [
        WALLET,
        'SOL',
        '0099_secret',
        'LOW_BALANCE',
        'SCHEMA_BEHIND',
        'UPGRADE_AUTHORITY',
        'crank',
        'balance',
        'https://',
        'example',
        'HTTP',
        'R2',
        'internal',
        'status-probe',
        STATUS_TOKEN,
        deps.env.sessionSecret,
        deps.env.escrowProgramId,
        deps.env.vaultAddress,
      ])
        expect(text, leak).not.toContain(leak);
      expect(body.components.find((c) => c.id === 'web')!.state).toBe('down');
      expect(body.components.find((c) => c.id === 'escrow')!.state).toBe('degraded');
    }
  });

  it('is edge-cached for a minute and shared by signed-in visitors', () => {
    const rule = ruleFor(new Request('https://api.trenchmart.fun/api/v1/status'));
    expect(rule).toMatchObject({ fresh: 60, shared: true });
    const authed = ruleFor(
      new Request('https://api.trenchmart.fun/api/v1/status', {
        headers: { cookie: 'tm_session=abc' },
      }),
    );
    expect(authed).toMatchObject({ fresh: 60 });
  });

  it('keeps the internal endpoints private', async () => {
    const { deps } = await statusSetup(sql, clock);
    const app = createApp(deps);
    for (const [method, path] of [
      ['GET', '/api/v1/internal/ops/alerts'],
      ['GET', '/api/v1/internal/ops'],
      ['POST', '/api/v1/internal/status/run'],
      ['POST', '/api/v1/internal/status/external'],
    ] as const)
      expect((await app.request(path, { method })).status, path).toBe(401);
  });
});
