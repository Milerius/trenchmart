import { expect, test } from '@playwright/test';

// GET /api/v1/status end to end: real API + Postgres, read directly and through the web's
// same-origin /api/v1 proxy, after one probe tick. Checks the public shape and that nothing
// internal (tokens, secrets, alert text, URLs) is in it.

const API = `http://127.0.0.1:${process.env.XO_API_PORT ?? '8817'}`;
const TOKEN = process.env.XO_INTERNAL_TOKEN ?? 'e2e-internal-token-e2e-internal-token-0001';
const SESSION_SECRET = 'e2e-session-secret-e2e-session-secret';

const COMPONENT_KEYS = [
  'checkedAt',
  'days',
  'id',
  'latencyMs',
  'name',
  'p50Ms',
  'p95Ms',
  'provider',
  'state',
  'uptime90',
];

test('the public status summary is complete, anonymous and sanitized', async ({ request }) => {
  const tick = await request.post(`${API}/api/v1/internal/status/run`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(tick.status()).toBe(200);

  for (const url of [`${API}/api/v1/status`, '/api/v1/status']) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      overall: string;
      windowDays: number;
      cluster: string;
      components: Record<string, unknown>[];
      incidents: unknown[];
    };
    expect(Object.keys(body).sort()).toEqual([
      'checkedAt',
      'cluster',
      'components',
      'generatedAt',
      'incidents',
      'intervalMinutes',
      'overall',
      'windowDays',
    ]);
    expect(body.cluster).toBe('devnet');
    expect(body.windowDays).toBe(90);
    expect(body.components.map((c) => c.id)).toEqual(
      expect.arrayContaining(['web', 'api', 'rpc', 'db', 'uploads', 'auth']),
    );
    for (const c of body.components) {
      expect(Object.keys(c).sort()).toEqual(COMPONENT_KEYS);
      // RPC provider: a name only (never a URL); local ticks probe directly, so none here.
      expect([null, 'helius', 'public']).toContain(c.provider);
      if (c.id !== 'rpc') expect(c.provider).toBeNull();
      const days = c.days as { date: string; state: string }[];
      expect(days).toHaveLength(90);
      expect(['operational', 'degraded', 'down', 'none']).toContain(days[89]!.state);
    }
    const db = body.components.find((c) => c.id === 'db')!;
    expect(['operational', 'degraded']).toContain(db.state);
    expect((db.days as { state: string }[])[89]!.state).not.toBe('none');
    for (const leak of [TOKEN, SESSION_SECRET, 'internal', 'status-probe', 'http://', 'https://'])
      expect(text, `${url} leaks ${leak}`).not.toContain(leak);
  }
});
