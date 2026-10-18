import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Public /status page over a stubbed GET /api/v1/status (the real API version runs in
// e2e/x-oauth/status-page.flow.ts). Covers: no history yet (grey days), a partial history,
// degraded + incidents, mobile layout, API failure, and that nothing mock or internal shows.

const IDS: [string, string][] = [
  ['web', 'Website'],
  ['api', 'API'],
  ['rpc', 'Solana RPC'],
  ['escrow', 'Escrow program & resolver'],
  ['db', 'Database'],
  ['uploads', 'Uploads & scanning'],
  ['auth', 'Sign-in'],
];

function days(withData: number, state = 'operational', lastState = state) {
  const out = [];
  for (let i = 89; i >= 0; i--) {
    const date = new Date(Date.UTC(2026, 9, 18) - i * 86_400_000).toISOString().slice(0, 10);
    const has = i < withData;
    const s = !has ? 'none' : i === 0 ? lastState : state;
    out.push({
      date,
      state: s,
      uptime: has ? (s === 'down' ? 97.5 : 100) : null,
      samples: has ? 288 : 0,
    });
  }
  return out;
}

function body(kind: 'empty' | 'healthy' | 'degraded') {
  const checkedAt = kind === 'empty' ? null : '2026-10-18T07:45:00.000Z';
  return {
    checkedAt,
    generatedAt: '2026-10-18T07:46:00.000Z',
    cluster: 'devnet',
    overall: kind === 'empty' ? 'unknown' : kind === 'healthy' ? 'operational' : 'degraded',
    intervalMinutes: 5,
    windowDays: 90,
    components: IDS.map(([id, name]) => {
      const degraded = kind === 'degraded' && id === 'uploads';
      return {
        id,
        name,
        state: kind === 'empty' ? 'unknown' : degraded ? 'degraded' : 'operational',
        checkedAt,
        latencyMs: kind === 'empty' ? null : 90,
        p50Ms: kind === 'empty' ? null : id === 'api' ? 96 : 120,
        p95Ms: kind === 'empty' ? null : id === 'api' ? 312 : 480,
        uptime90: kind === 'empty' ? null : degraded ? 99.31 : 100,
        days:
          kind === 'empty'
            ? days(0)
            : days(3, 'operational', degraded ? 'degraded' : 'operational'),
      };
    }),
    incidents:
      kind === 'degraded'
        ? [
            {
              id: 2,
              component: 'uploads',
              componentName: 'Uploads & scanning',
              title: 'Uploads & scanning degraded',
              impact: 'minor',
              status: 'ongoing',
              startedAt: '2026-10-18T07:20:00.000Z',
              resolvedAt: null,
              durationMinutes: 25,
            },
            {
              id: 1,
              component: 'rpc',
              componentName: 'Solana RPC',
              title: 'Solana RPC unavailable',
              impact: 'major',
              status: 'resolved',
              startedAt: '2026-10-17T14:00:00.000Z',
              resolvedAt: '2026-10-17T15:10:00.000Z',
              durationMinutes: 70,
            },
          ]
        : [],
  };
}

async function stub(page: Page, kind: 'empty' | 'healthy' | 'degraded' | 'error') {
  const calls: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    calls.push(path);
    if (path === '/status')
      return kind === 'error'
        ? route.fulfill({ status: 503, json: { error: { code: 'DOWN', message: 'unavailable' } } })
        : route.fulfill({ json: body(kind) });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return calls;
}

async function noMockup(page: Page) {
  const text = (await page.locator('main').innerText()).toLowerCase();
  for (const word of ['mockup', 'example data', 'internal', 'low_balance', 'sol '])
    expect(text, word).not.toContain(word);
}

test('no history yet: every component says so and all 90 days are grey', async ({ page }) => {
  await stub(page, 'empty');
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
  await expect(page.getByTestId('status-overall')).toContainText('No recent checks');
  await expect(page.getByTestId('status-checked')).toContainText('no checks yet');
  await expect(page.getByTestId('summary-uptime')).toHaveText('No data yet');
  await expect(page.getByTestId('summary-history')).toHaveText('0 of 90');
  for (const [id] of IDS) {
    await expect(page.getByTestId(`status-${id}`)).toHaveAttribute('data-state', 'unknown');
    await expect(page.getByTestId(`latency-${id}`)).toHaveText('no data yet');
    await expect(page.getByTestId(`bar-${id}`).locator('[data-state="none"]')).toHaveCount(90);
  }
  await expect(page.getByTestId('incidents-empty')).toBeVisible();
  await noMockup(page);
});

test('partial history: real numbers, three coloured days, the rest grey and explained', async ({
  page,
}) => {
  await stub(page, 'healthy');
  await page.goto('/status');
  await expect(page.getByTestId('status-overall')).toContainText('All systems operational');
  await expect(page.getByTestId('status-checked')).toContainText('18 Oct, 07:45 UTC');
  await expect(page.getByTestId('summary-api')).toHaveText('96 ms / 312 ms');
  await expect(page.getByTestId('summary-history')).toHaveText('3 of 90');
  await expect(page.getByTestId('latency-api')).toHaveText('p50 96 ms · p95 312 ms');
  await expect(page.getByTestId('uptime-api')).toHaveText('100%');
  const bar = page.getByTestId('bar-db');
  await expect(bar.locator('[data-state="none"]')).toHaveCount(87);
  await expect(bar.locator('[data-state="operational"]')).toHaveCount(3);
  await expect(bar.locator('span').last()).toHaveAttribute(
    'title',
    /2026-10-18: operational · 100% up/,
  );
  await expect(page.getByTestId('history-note')).toContainText('History starts 2026-10-16');
  await noMockup(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

test('degraded component and incident history', async ({ page }) => {
  await stub(page, 'degraded');
  await page.goto('/status');
  await expect(page.getByTestId('status-overall')).toContainText('Uploads & scanning is degraded');
  await expect(page.getByTestId('status-uploads')).toHaveAttribute('data-state', 'degraded');
  await expect(page.getByTestId('status-uploads')).toContainText('DEGRADED');
  await expect(page.getByTestId('status-db')).toContainText('OPERATIONAL');
  await expect(page.getByTestId('summary-open')).toHaveText('1');
  await expect(page.getByTestId('summary-uptime')).toHaveText('99.31%');
  const incidents = page.getByTestId('incidents').locator('li');
  await expect(incidents).toHaveCount(2);
  await expect(incidents.first()).toContainText('Uploads & scanning degraded');
  await expect(incidents.first()).toContainText('ONGOING');
  await expect(incidents.nth(1)).toContainText('Solana RPC unavailable');
  await expect(incidents.nth(1)).toContainText('RESOLVED');
  await expect(incidents.nth(1)).toContainText('1 h 10 min');
  await expect(page.getByTestId('bar-uploads').locator('[data-state="degraded"]')).toHaveCount(1);
});

test('mobile: last 30 days, no sideways scroll; footer links here', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, 'healthy');
  await page.goto('/status');
  const bar = page.getByTestId('bar-api');
  await expect(bar.locator('span:visible')).toHaveCount(30);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Status' })).toHaveAttribute(
    'href',
    '/status',
  );
});

test('API failure shows an error with retry, and refresh refetches', async ({ page }) => {
  const calls = await stub(page, 'error');
  await page.goto('/status');
  await expect(page.getByTestId('error-state')).toContainText("Couldn't load the status");
  await page.unroute('**/api/v1/**');
  await stub(page, 'healthy');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('status-overall')).toContainText('All systems operational');
  expect(calls.filter((c) => c === '/status').length).toBeGreaterThanOrEqual(1);
});

test('prototype header and the glowing all-clear card', async ({ page }) => {
  await stub(page, 'healthy');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/status');
  const h1 = page.getByRole('heading', { level: 1, name: 'System status' });
  await expect(h1).toBeVisible();
  await expect(h1.locator('em')).toHaveText('status');
  expect(await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(48);
  const overall = page.getByTestId('status-overall');
  await expect(overall).toContainText('All systems operational');
  expect(await overall.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('26px');
});
