import { expect, test, type Page } from '@playwright/test';

// Market browsing: search query, category pages, creators and creator profiles.

const row = (slug: string, title: string, category = 'userscript') => ({
  slug,
  title,
  summary: `${title} summary.`,
  category,
  terminals: ['Axiom'],
  price: '100000000',
  handle: 'maker',
  sales7d: 2,
  cover: null,
});

async function stub(page: Page, routes: (path: string, search: URLSearchParams) => unknown) {
  const seen: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    seen.push(path + url.search);
    const json = routes(path, url.searchParams);
    if (json === undefined) {
      return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
    }
    return route.fulfill({ json });
  });
  return seen;
}

test('header search goes to /search?q= and sends the query', async ({ page }) => {
  const seen = await stub(page, (path, search) =>
    path === '/listings'
      ? search.get('q') === 'trojan'
        ? [row('trojan-intel', 'Trojan Intel')]
        : []
      : undefined,
  );
  await page.goto('/');
  await page.getByTestId('search').fill('trojan');
  await page.getByTestId('search').press('Enter');
  await page.waitForURL('**/search?q=trojan');
  await expect(page.getByRole('heading', { name: 'Results for “trojan”' })).toBeVisible();
  await expect(page.getByText('1 reviewed listing', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trojan Intel' })).toBeVisible();
  expect(seen).toContain('/listings?q=trojan');
});

test('search with no results explains what to try', async ({ page }) => {
  await stub(page, (path) => (path === '/listings' ? [] : undefined));
  await page.goto('/search?q=nothing-here');
  await expect(page.getByText('Nothing matches “nothing-here”')).toBeVisible();
  await expect(page.getByText('Try a terminal name, a category, or fewer words.')).toBeVisible();
});

test('category page asks for that category only', async ({ page }) => {
  const seen = await stub(page, (path, search) =>
    path === '/listings' && search.get('category') === 'wallet_list'
      ? [row('smart-wallets', 'Smart Wallets', 'wallet_list')]
      : undefined,
  );
  await page.goto('/c/wallet_list');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Smart Wallets' })).toBeVisible();
  expect(seen).toContain('/listings?category=wallet_list');
});

test('creator profile shows the handle, X link and listings; unknown handles say so', async ({
  page,
}) => {
  await stub(page, (path) =>
    path === '/creators/maker'
      ? {
          handle: 'maker',
          wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
          xHandle: 'trenchmaker',
          bond: '5000000000',
          listings: [row('trojan-intel', 'Trojan Intel')],
        }
      : undefined,
  );
  await page.goto('/u/maker');
  await expect(page.getByRole('heading', { name: '@maker' })).toBeVisible();
  await expect(page.getByText(/X @trenchmaker/)).toBeVisible();
  // M-04: a handle not proven through X sign-in is labelled.
  await expect(page.getByTestId('x-unverified')).toHaveText('(unverified)');
  await expect(page.getByRole('heading', { name: 'Trojan Intel' })).toBeVisible();
  await page.goto('/u/nobody');
  await expect(page.getByText('Creator not found.')).toBeVisible();
});

test('creator profile: an X handle verified through X sign-in has no unverified label', async ({
  page,
}) => {
  await stub(page, (path) =>
    path === '/creators/verified'
      ? {
          handle: 'verified',
          wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
          xHandle: 'realtrader',
          xVerified: true,
          bond: '5000000000',
          listings: [],
        }
      : undefined,
  );
  await page.goto('/u/verified');
  await expect(page.getByText(/X @realtrader/)).toBeVisible();
  await expect(page.getByTestId('x-unverified')).toHaveCount(0);
});

test.describe('market pages follow the prototype', () => {
  const rows = [
    {
      ...row('cheap-filter', 'Cheap Filter', 'filter'),
      terminals: ['GMGN'],
      price: '50000000',
      sales7d: 1,
      ratingAvg: '4.9',
    },
    {
      ...row('hot-script', 'Hot Script'),
      terminals: ['Axiom'],
      price: '300000000',
      sales7d: 9,
      ratingAvg: '4.1',
    },
    {
      ...row('wallet-pack', 'Wallet Pack', 'wallet_list'),
      terminals: ['Photon'],
      price: '200000000',
      sales7d: 4,
      ratingAvg: null,
    },
  ];
  const titles = (page: Page) => page.locator('main ul h3').allInnerTexts();

  test('search: full-width hero, category and terminal filters, sort', async ({ page }) => {
    await stub(page, (path) => (path === '/listings' ? rows : undefined));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/search');
    const h1 = page.getByRole('heading', { level: 1, name: 'All live listings' });
    await expect(h1).toBeVisible();
    // Full bleed: the hero spans the viewport, the content column stays 1280 px.
    const hero = page.locator('main section').first();
    expect((await hero.boundingBox())!.width).toBeGreaterThan(1400);
    await expect(page.getByText('3 reviewed listings')).toBeVisible();
    // Trending: most sales this week first.
    expect(await titles(page)).toEqual(['Hot Script', 'Wallet Pack', 'Cheap Filter']);

    const filters = page.getByTestId('market-filters');
    await filters.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(filters.getByRole('button', { name: 'Filters', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('1 reviewed listing', { exact: true })).toBeVisible();
    await filters.getByRole('button', { name: 'All', exact: true }).click();

    await filters.getByRole('button', { name: 'Photon' }).click();
    await expect(page.getByText('1 reviewed listing', { exact: true })).toBeVisible();
    expect(await titles(page)).toEqual(['Wallet Pack']);
    await filters.getByRole('button', { name: 'GMGN' }).click();
    await expect(page.getByText('2 reviewed listings')).toBeVisible();
    await filters.getByRole('button', { name: 'GMGN' }).click();
    await filters.getByRole('button', { name: 'Photon' }).click();

    await page.getByTestId('market-sort').selectOption('price');
    expect(await titles(page)).toEqual(['Cheap Filter', 'Wallet Pack', 'Hot Script']);
    await page.getByTestId('market-sort').selectOption('rating');
    expect(await titles(page)).toEqual(['Cheap Filter', 'Hot Script', 'Wallet Pack']);
  });

  test('filters that match nothing say so', async ({ page }) => {
    await stub(page, (path) => (path === '/listings' ? rows : undefined));
    await page.goto('/search');
    await page
      .getByTestId('market-filters')
      .getByRole('button', { name: 'Alerts', exact: true })
      .click();
    await expect(page.getByText('Nothing matches these filters')).toBeVisible();
  });

  test('category: hero with bond, escrow and other categories; no category pills', async ({
    page,
  }) => {
    await stub(page, (path) =>
      path === '/listings'
        ? [rows[1]]
        : path === '/config/public'
          ? { bondLamportsByCategory: { userscript: '5000000000' }, escrowHours: 1 }
          : undefined,
    );
    await page.goto('/c/userscript');
    const hero = page.getByTestId('category-hero');
    await expect(hero.getByRole('heading', { level: 1, name: 'Userscripts' })).toBeVisible();
    await expect(hero.getByText('01 / SCRIPTS')).toBeVisible();
    await expect(hero.getByText('Creator bond 5 SOL')).toBeVisible();
    await expect(hero.getByText('0% creator commission')).toBeVisible();
    const others = hero.getByRole('navigation', { name: 'Other categories' }).getByRole('link');
    await expect(others).toHaveCount(5);
    await expect(others.first()).toHaveAttribute('href', '/c/wallet_list');
    await expect(
      page.getByTestId('market-filters').getByRole('group', { name: 'Category' }),
    ).toHaveCount(0);
    await expect(page.getByText('1 reviewed listing', { exact: true })).toBeVisible();
  });

  test('category title stays a static gradient on phones and in automation', async ({ page }) => {
    await stub(page, (path) => (path === '/listings' ? [] : undefined));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/c/filter');
    const h1 = page.getByRole('heading', { level: 1, name: 'Terminal filters' });
    await expect(h1).toBeVisible();
    await expect(page.locator('[data-fx="gradient-text"]')).toHaveCount(0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });

  test('desktop with effects on: the category title uses React Bits GradientText', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as Window & { __TM_FX__?: boolean }).__TM_FX__ = true;
    });
    await stub(page, (path) => (path === '/listings' ? [] : undefined));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/c/userscript');
    const fx = page.locator('[data-fx="gradient-text"]');
    await expect(fx).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Userscripts' })).toBeVisible();
  });
});
