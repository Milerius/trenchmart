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
  await expect(page.getByRole('heading', { name: 'Trojan Intel' })).toBeVisible();
  await page.goto('/u/nobody');
  await expect(page.getByText('Creator not found.')).toBeVisible();
});
