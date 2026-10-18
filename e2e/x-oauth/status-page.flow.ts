import { expect, test } from '@playwright/test';

// /status in a real browser against the real API and Postgres (no stubs): one probe tick, then
// the page shows every component from real data, today's bar filled in and days without data
// grey, and nothing internal in the page.

const API = `http://127.0.0.1:${process.env.XO_API_PORT ?? '8817'}`;
const TOKEN = process.env.XO_INTERNAL_TOKEN ?? 'e2e-internal-token-e2e-internal-token-0001';

test('the status page renders real probe data with honest grey days', async ({ page, request }) => {
  const tick = await request.post(`${API}/api/v1/internal/status/run`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(tick.status()).toBe(200);
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
  await expect(page.getByTestId('status-components')).toBeVisible();
  for (const id of ['web', 'api', 'rpc', 'db', 'uploads', 'auth'])
    await expect(page.getByTestId(`status-${id}`)).toBeVisible();
  await expect(page.getByTestId('status-db')).toHaveAttribute('data-state', /operational|degraded/);
  await expect(page.getByTestId('latency-db')).toContainText('p50');
  const bar = page.getByTestId('bar-db').locator('span');
  await expect(bar).toHaveCount(90);
  await expect(bar.last()).not.toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('status-checked')).toContainText('last check');
  const text = await page.locator('main').innerText();
  for (const leak of [TOKEN, 'mockup', 'example data', 'status-probe', 'internal/'])
    expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
  await page.screenshot({ path: 'test-results/status-page/real-api.png', fullPage: true });
});
