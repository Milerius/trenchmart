import { expect, test } from '@playwright/test';
import { createSql } from '@trenchmart/db';
import { watchdog } from '../../apps/api/src/watchdog';

// Health check end to end: the watchdog Worker's tick (the same code its Cloudflare cron runs)
// probes the local web dev server and the real local API, reports to POST
// /internal/ops/report, and the API's ops alerts feed (/internal/ops/alerts, what the chat
// relay polls) shows HEALTH_CHECK_FAILED only while a probe fails. Locally the API has no
// STATUS_PUSH_TOKEN, so the watchdog uses the internal token, which may report any check.

const WEB = `http://127.0.0.1:${process.env.XO_WEB_PORT ?? '3317'}`;
const API = `http://127.0.0.1:${process.env.XO_API_PORT ?? '8817'}`;
const TOKEN = process.env.XO_INTERNAL_TOKEN ?? 'e2e-internal-token-e2e-internal-token-0001';
const sql = createSql(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
);
const env = (web: string) => ({
  WEB_URL: web,
  API_URL: API,
  RPC_URL: 'http://127.0.0.1:9/rpc', // RPC has its own alert; not part of the health check
  STATUS_PUSH_TOKEN: TOKEN,
});

test.afterAll(async () => {
  await sql`delete from ops_events where kind = 'scheduled_check'`;
  await sql.end();
});

test('watchdog tick reports the health check; the alerts feed raises and clears HEALTH_CHECK_FAILED', async ({
  request,
}) => {
  await sql`delete from ops_events where kind = 'scheduled_check'`;
  const alerts = async () => {
    const res = await request.get(`${API}/api/v1/internal/ops/alerts`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      timeout: 60_000,
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { live: { code: string; level: string; message: string }[] };
    return body.live.filter((a) => a.code === 'HEALTH_CHECK_FAILED');
  };
  const unauthorized = await request.post(`${API}/api/v1/internal/ops/report`, {
    data: { check: 'health-check', ok: false },
  });
  expect(unauthorized.status()).toBe(401);

  await watchdog(env(WEB));
  const [ok] = await sql<{ detail: string }[]>`
    select detail from ops_events where kind = 'scheduled_check' order by id desc limit 1
  `;
  expect(JSON.parse(ok!.detail)).toMatchObject({
    check: 'health-check',
    ok: true,
    source: 'watchdog',
  });
  expect(await alerts()).toEqual([]);

  // The web app is unreachable: the next tick raises a critical alert naming it.
  await watchdog(env('http://127.0.0.1:9'));
  const down = await alerts();
  expect(down).toHaveLength(1);
  expect(down[0]!.level).toBe('critical');
  expect(down[0]!.message).toContain('web: unreachable');

  await watchdog(env(WEB));
  expect(await alerts()).toEqual([]);
});
