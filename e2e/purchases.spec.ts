import { expect, test, type Page } from '@playwright/test';

// Purchases page: tabs with counts, order cards with escrow progress, compact closed rows.
// The CI e2e job runs without the API, so /api/v1 is stubbed in the browser.

const HOUR = 3_600_000;
const CONFIG = {
  feeBps: 500,
  tierRebateBps: { none: 0, scout: 2500, trencher: 6000, og: 10000 },
  tierThresholds: { scout: '100000', trencher: '1000000', og: '10000000' },
  tierWindowHours: 72,
  feeSplitBps: { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 },
  escrowHours: 1,
  verificationFeeLamports: '0',
  bondLamportsByCategory: { userscript: '5000000000' },
  terminals: ['Axiom'],
};
const SESSION = {
  user: { id: 'u1', wallet: '7xKpQ2nV8mJr3sTa9Fq', handle: 'buyer', roles: [] },
  tier: 'none',
};

function orders(now: number) {
  const base = {
    slug: 'bundle-detector-overlay',
    tier_at_purchase: 'none',
    amount: { lamports: '1050000000', usdCents: '18900' },
    escrow_address: null,
    released_at: null,
    tx_sig: '5'.repeat(88),
  };
  return [
    {
      ...base,
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      title: 'Paid Pack',
      status: 'paid',
      paid_at: new Date(now - 10 * 60_000).toISOString(),
      escrow_until: new Date(now + 50 * 60_000).toISOString(),
      cover: { url: '/api/v1/media/11111111-1111-4111-8111-111111111111', alt: 'Paid Pack cover' },
    },
    {
      ...base,
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      title: 'Disputed Pack',
      status: 'disputed',
      paid_at: new Date(now - 20 * 60_000).toISOString(),
      escrow_until: new Date(now + 40 * 60_000).toISOString(),
      cover: null,
    },
    {
      ...base,
      id: 'cccccccc-0000-4000-8000-000000000003',
      title: 'Released Pack',
      status: 'released',
      paid_at: new Date(now - 3 * HOUR).toISOString(),
      escrow_until: new Date(now - 2 * HOUR).toISOString(),
      released_at: new Date(now - 2 * HOUR).toISOString(),
      cover: null,
    },
    {
      ...base,
      id: 'dddddddd-0000-4000-8000-000000000004',
      title: 'Expired Pack',
      status: 'expired',
      paid_at: null,
      tx_sig: null,
      escrow_until: null,
      expires_at: new Date(now - 5 * HOUR).toISOString(),
      cover: null,
    },
    {
      ...base,
      id: 'eeeeeeee-0000-4000-8000-000000000005',
      title: 'Refunded Pack',
      status: 'refunded',
      paid_at: new Date(now - 6 * HOUR).toISOString(),
      escrow_until: null,
      refund_sig: '4'.repeat(88),
      cover: null,
    },
  ];
}

async function stub(page: Page, list: unknown[], onDownload?: (id: string) => void) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/me') return route.fulfill({ json: SESSION });
    if (path === '/me/orders') return route.fulfill({ json: { orders: list } });
    if (path === '/config/public') return route.fulfill({ json: CONFIG });
    if (path.startsWith('/media/'))
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    const dl = path.match(/^\/orders\/([^/]+)\/download$/);
    if (dl && route.request().method() === 'POST') {
      onDownload?.(dl[1]!);
      return route.fulfill({ json: { url: '/me/purchases#downloaded' } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
}

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('tabs show counts and split orders into Active, Completed, Expired & refunded', async ({
  page,
}) => {
  await stub(page, orders(Date.now()));
  await page.goto('/me/purchases');
  const tabs = page.getByTestId('purchase-tabs');
  await expect(tabs.getByRole('tab', { name: /Active/ })).toContainText('2');
  await expect(tabs.getByRole('tab', { name: /Completed/ })).toContainText('1');
  await expect(tabs.getByRole('tab', { name: /Expired & refunded/ })).toContainText('2');
  await expect(tabs.getByRole('tab', { name: /Active/ })).toHaveAttribute('aria-selected', 'true');

  // Active: disputes first, then paid. Cover thumbnail when the listing has one.
  const cards = page.getByTestId('order-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Disputed Pack');
  await expect(cards.nth(1)).toContainText('Paid Pack');
  await expect(cards.nth(1).locator('img')).toHaveAttribute('src', /\/api\/v1\/media\/1{8}-/);
  await expect(cards.nth(0).getByTestId('download-state')).toContainText(
    'Paused during the dispute',
  );
  await expect(cards.nth(1).getByTestId('download-state')).toContainText('Download: Available');
  await expect(cards.nth(1).getByRole('link', { name: 'Open a dispute' })).toHaveAttribute(
    'href',
    '/me/purchases/aaaaaaaa-0000-4000-8000-000000000001/dispute',
  );
  await expect(cards.nth(1).getByTestId('escrow-timeline')).toContainText('In escrow');

  await tabs.getByRole('tab', { name: /Completed/ }).click();
  await expect(page.getByTestId('order-card')).toHaveCount(1);
  await expect(page.getByTestId('order-card')).toContainText('Released Pack');
  await expect(page.getByTestId('download-state')).toContainText('Available');

  await tabs.getByRole('tab', { name: /Expired & refunded/ }).click();
  await expect(page.getByTestId('order-card')).toHaveCount(0);
  const rows = page.getByTestId('closed-order');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Expired Pack');
  await expect(rows.nth(1)).toContainText('Refunded Pack');
  await expect(rows.nth(1).getByRole('link', { name: /Refund tx/ })).toHaveAttribute(
    'href',
    /explorer\.solana\.com\/tx\/4+\?cluster=devnet/,
  );
});

test('download is one click once paid and asks the API for a signed link', async ({ page }) => {
  const asked: string[] = [];
  await stub(page, orders(Date.now()), (id) => asked.push(id));
  await page.goto('/me/purchases');
  const ready = page.locator('[data-testid="download-button"][data-state="ready"]');
  await expect(ready).toHaveCount(1);
  await ready.click();
  await expect.poll(() => asked).toEqual(['aaaaaaaa-0000-4000-8000-000000000001']);
});

test('empty tabs explain what shows up there', async ({ page }) => {
  await stub(
    page,
    orders(Date.now()).filter((order) => order.status === 'released'),
  );
  await page.goto('/me/purchases');
  await expect(page.getByRole('tabpanel')).toContainText('Nothing in escrow right now.');
  await page.getByRole('tab', { name: /Expired & refunded/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('No expired or refunded orders.');
});

test('purchases fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, orders(Date.now()));
  await page.goto('/me/purchases');
  await expect(page.getByTestId('order-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('prototype layout: large title, three stat tiles, rounded order cards in a 5xl column', async ({
  page,
}) => {
  await stub(page, orders(Date.now()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/me/purchases');
  const h1 = page.getByRole('heading', { level: 1, name: 'Purchases' });
  await expect(h1).toBeVisible();
  await expect(page.getByTestId('purchase-stats')).toBeVisible();
  await expect.poll(() => h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(48);
  const stats = page.getByTestId('purchase-stats');
  await expect(stats.locator(':scope > div')).toHaveCount(3);
  await expect(stats).toContainText('2.10 SOL');
  await expect(stats).toContainText('2 orders · ≈ $378.00');
  expect((await page.getByTestId('dashboard').boundingBox())!.width).toBeLessThanOrEqual(1024);
  const card = page.getByTestId('order-card').first();
  expect(await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('24px');
});
