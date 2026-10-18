import { expect, test } from '@playwright/test';

// Mainnet-readiness hardening that is visible from the browser. The e2e dev server runs
// without an API, which is exactly the "API down" case these checks need.

test('pages send clickjacking and transport security headers', async ({ request }) => {
  const res = await request.get('/');
  const headers = res.headers();
  expect(headers['strict-transport-security']).toContain('max-age=31536000');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  // No script-src: a script policy blocks wallet extensions from registering (see next.config).
  expect(headers['content-security-policy']).not.toContain('script-src');
});

test('the same-origin /api/v1 proxy answers 502 quickly when the API is unreachable', async ({
  request,
}) => {
  const started = Date.now();
  const res = await request.post('/api/v1/auth/nonce', {
    data: { wallet: 'x' },
    headers: { 'x-tm-client-ip': '1.2.3.4', 'x-tm-proxy': 'forged' },
  });
  expect(res.status()).toBe(502);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPSTREAM');
  expect(Date.now() - started).toBeLessThan(5_000);
});

test('a listing page renders without stalling when the API is down (no double timeout)', async ({
  page,
}) => {
  const started = Date.now();
  const res = await page.goto('/l/api-down-check');
  expect(res?.status()).toBeLessThan(500);
  await expect(page.locator('main')).toBeVisible();
  // One failed read, not a timeout followed by a second full timeout (was ~16 s).
  expect(Date.now() - started).toBeLessThan(10_000);
});
