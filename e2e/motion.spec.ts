import { expect, test, type Page } from '@playwright/test';

async function stubHome(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/stats') {
      await route.fulfill({
        json: {
          source: 'live',
          listings: 8,
          creators: 4,
          orders: 128,
          volume: { lamports: '11500000000', sol: '11.500', usdCents: '207000' },
          solUsd: { centsPerSol: '18000' },
        },
      });
      return;
    }
    if (path === '/listings') {
      await route.fulfill({
        json: [
          {
            slug: 'bundle-detector-overlay',
            title: 'Bundle Detector Overlay',
            summary: 'Overlay that flags bundled launches.',
            category: 'userscript',
            terminals: ['Axiom'],
            price: '1200000000',
          },
        ],
      });
      return;
    }
    if (path === '/config/public') {
      await route.fulfill({
        json: {
          feeBps: 500,
          tierRebateBps: { none: 0, scout: 2500, trencher: 6000, og: 10000 },
          tierThresholds: { scout: '[X]', trencher: '[Y]', og: '[Z]' },
          feeSplitBps: { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 },
          escrowHours: 48,
          verificationFeeLamports: '0',
          bondLamportsByCategory: { userscript: '5000000000' },
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });
}

test('home keeps the same structure and does not overflow', async ({ page }) => {
  await stubHome(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The verified edge, for sale.' })).toBeVisible();
  const heading = await page
    .getByRole('heading', { name: 'The verified edge, for sale.' })
    .boundingBox();
  expect(heading?.width).toBeGreaterThan(280);
  expect(heading?.y).toBeGreaterThan(40);
  expect(heading?.y).toBeLessThan(420);

  const stats = await page.getByTestId('landing-stats').boundingBox();
  expect(stats?.height).toBeGreaterThan(60);
  expect(stats?.height).toBeLessThan(240);

  const ticker = await page.getByTestId('ticker').boundingBox();
  expect(ticker?.height).toBeGreaterThan(20);
  expect(ticker?.height).toBeLessThan(48);

  const nav = await page.getByTestId('nav').boundingBox();
  expect(nav?.height).toBeGreaterThan(40);
  expect(nav?.height).toBeLessThan(120);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(true);
  await expect(page.getByTestId('count-up').first()).toHaveText('8');
  await expect(page.getByTestId('ticker')).toContainText('Bundle Detector Overlay');
});

test('reduced motion keeps content visible and stops decorative animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubHome(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The verified edge, for sale.' })).toBeVisible();
  await expect(page.getByTestId('count-up').first()).toHaveText('8');

  const tickerName = await page
    .getByTestId('ticker-track')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(tickerName).toBe('none');

  const glowName = await page
    .locator('[data-motion="hero-glow"]')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(glowName).toBe('none');

  const reveal = page.locator('[data-reveal]').first();
  await expect(reveal).toBeVisible();
  const opacity = await reveal.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBe(1);

  await page.getByTestId('connect').click();
  const modal = page.getByTestId('connect-modal');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('wallet picker opens and closes with a motion phase', async ({ page }) => {
  await stubHome(page);
  await page.goto('/');
  await page.getByTestId('connect').click();
  const modal = page.getByTestId('connect-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('data-phase', 'open');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('a route change fades the page without moving the nav', async ({ page }) => {
  await stubHome(page);
  await page.goto('/');
  const nav = await page.getByTestId('nav').boundingBox();
  await page.getByTestId('nav').getByRole('link', { name: 'Sell', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Sell your tooling/ })).toBeVisible();
  const next = await page.getByTestId('nav').boundingBox();
  expect(Math.abs((next?.y ?? 0) - (nav?.y ?? 0))).toBeLessThan(4);
  expect(Math.abs((next?.height ?? 0) - (nav?.height ?? 0))).toBeLessThan(4);
});
