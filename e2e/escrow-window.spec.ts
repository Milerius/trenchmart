import { expect, test, type Page } from '@playwright/test';

// Owner decision 2026-10-18: the escrow window is 1 hour (maximum). Every page that states
// the window must say so, and none may still say 48 hours.

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

const LISTING = {
  id: 'listing-1',
  slug: 'escrow-window-pack',
  title: 'Escrow Window Pack',
  summary: 'A listing used to check the escrow copy.',
  description: 'A listing used to check the escrow copy.',
  category: 'userscript',
  terminals: ['Axiom'],
  price: '1000000000',
  license: 'single',
  holderOnly: false,
  creator: {
    handle: 'maker',
    wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
    bondLamports: '5000000000',
  },
  preview: null,
  security: null,
};

async function stub(page: Page, routes: Record<string, unknown>) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path in routes) await route.fulfill({ status: 200, json: routes[path] });
    else
      await route.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'not found' } },
      });
  });
}

const NO_48 = /48[\s-]?h(ours?)?\b/i;

test('home states a 1h escrow on every order', async ({ page }) => {
  await stub(page, {
    '/config/public': CONFIG,
    '/listings': [],
    '/stats': {},
    '/prices/sol': { centsPerSol: '18000' },
  });
  await page.goto('/');
  await expect(page.getByText('1h escrow on every order')).toBeVisible();
  await expect(
    page.getByText('Your SOL is held in escrow for 1 hour.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(NO_48);
});

test('listing checkout says the SOL is held for 1 hour', async ({ page }) => {
  await stub(page, {
    '/config/public': CONFIG,
    [`/listings/${LISTING.slug}`]: LISTING,
    [`/listings/${LISTING.slug}/reviews`]: [],
    [`/listings/${LISTING.slug}/versions`]: [],
    '/prices/sol': { centsPerSol: '18000' },
  });
  await page.goto(`/l/${LISTING.slug}`);
  await expect(page.getByTestId('checkout')).toContainText('Held in escrow for 1 hour');
  await expect(page.locator('main')).not.toContainText(NO_48);
});

for (const path of ['/docs/buyers', '/docs/escrow', '/docs/faq', '/terms']) {
  test(`${path} states the 1 hour window and never 48 hours`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main')).toContainText('1 hour');
    await expect(page.locator('main')).not.toContainText(NO_48);
  });
}

test('buyer docs fact grid reads 1 hour', async ({ page }) => {
  await page.goto('/docs/buyers');
  await expect(page.getByTestId('buyer-escrow-hours')).toHaveText('1 hour');
  await page.goto('/docs/escrow');
  await expect(page.getByTestId('escrow-hours')).toHaveText('1 hour');
});
