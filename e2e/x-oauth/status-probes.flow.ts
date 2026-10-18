import { expect, test } from '@playwright/test';
import { createSql } from '@trenchmart/db';

// Status page probes end to end: the real API (Node, real Postgres) runs one cron-equivalent
// tick through POST /internal/status/run and stores what the public page will read. The local
// web dev server and the local API are the probed web and API (no STATUS_PUSH_TOKEN locally, so
// the API probes them itself instead of waiting for the watchdog's push).

const API = `http://127.0.0.1:${process.env.XO_API_PORT ?? '8817'}`;
const TOKEN = process.env.XO_INTERNAL_TOKEN ?? 'e2e-internal-token-e2e-internal-token-0001';
const sql = createSql(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
);

test.afterAll(async () => {
  await sql.end();
});

test('a status tick needs the internal token and records every component with its latency', async ({
  request,
}) => {
  const before = await sql<{ n: number }[]>`select count(*)::int as n from status_probes`;
  const denied = await request.post(`${API}/api/v1/internal/status/run`);
  expect(denied.status()).toBe(401);
  const wrong = await request.post(`${API}/api/v1/internal/status/run`, {
    headers: { authorization: 'Bearer not-the-token' },
  });
  expect(wrong.status()).toBe(401);
  const after401 = await sql<{ n: number }[]>`select count(*)::int as n from status_probes`;
  expect(after401[0]!.n).toBe(before[0]!.n);

  const res = await request.post(`${API}/api/v1/internal/status/run`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    probes: { component: string; state: string; latencyMs: number | null }[];
  };
  const states = Object.fromEntries(body.probes.map((p) => [p.component, p.state]));
  // Served by this stack, so they must answer (a cold dev server may be slow: degraded is fine).
  for (const id of ['web', 'api', 'db', 'uploads', 'auth'])
    expect(['operational', 'degraded'], id).toContain(states[id]);
  // Devnet RPC is the public internet from CI: present, any state.
  expect(states.rpc).toBeDefined();
  for (const p of body.probes) expect(p.latencyMs).toBeGreaterThanOrEqual(0);

  const rows = await sql<{ component: string; state: string; latency_ms: number }[]>`
    select component, state, latency_ms from status_probes
    where checked_at = (select max(checked_at) from status_probes)
  `;
  expect(rows.map((r) => r.component).sort()).toEqual(body.probes.map((p) => p.component).sort());
  const daily = await sql<{ samples: number }[]>`
    select samples from status_daily
    where component = 'db' and day = (now() at time zone 'UTC')::date
  `;
  expect(daily[0]!.samples).toBeGreaterThanOrEqual(1);
  // The watchdog push route is off without STATUS_PUSH_TOKEN, and the internal token does not open it.
  for (const authorization of ['', `Bearer ${TOKEN}`]) {
    const push = await request.post(`${API}/api/v1/internal/status/external`, {
      headers: { authorization },
      data: { checks: [{ name: 'api', ok: false, ms: 1 }] },
    });
    expect(push.status()).toBe(401);
  }
  // The sign-in probe cleans up after itself.
  expect(await sql`select 1 from auth_nonces where wallet = 'status-probe'`).toHaveLength(0);
});
