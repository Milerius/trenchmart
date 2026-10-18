import { expect, test, type Page } from '@playwright/test';
import { expectTerminalLogo } from './terminal-logo-helpers';

// Supported terminals (unit-tested in packages/shared/src/terminals.test.ts): Axiom, GMGN, Photon, Terminal (formerly Padre) and Trojan. BullX is gone.
// Also guards the performance work on the market grid: first covers load eagerly, the rest lazily.

const listing = (slug: string, terminals: string[], cover = true) => ({
  slug,
  title: `Listing ${slug}`,
  summary: 'A reviewed listing.',
  category: 'userscript',
  terminals,
  price: '100000000',
  handle: 'maker',
  sales7d: 1,
  cover: cover
    ? { url: `/api/v1/media/00000000-0000-4000-8000-00000000000${slug.length % 10}`, alt: slug }
    : null,
});

const ALL = [
  listing('trojan-trenches-intel', ['Trojan']),
  listing('terminal-tools', ['Terminal', 'Axiom']),
  listing('gmgn-pack', ['GMGN']),
  listing('photon-pack', ['Photon']),
  listing('axiom-pack', ['Axiom']),
];

async function stub(page: Page) {
  const listingQueries: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/listings') {
      listingQueries.push(url.search);
      const terminal = url.searchParams.get('terminal');
      const rows = terminal
        ? ALL.filter((row) => row.terminals.some((t) => t.toLowerCase() === terminal.toLowerCase()))
        : ALL;
      return route.fulfill({ json: rows });
    }
    if (path.startsWith('/media/')) {
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64',
        ),
      });
    }
    if (path === '/me')
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED', message: 'no' } },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return listingQueries;
}

test('home terminal pills list the supported terminals and filter the market', async ({ page }) => {
  const queries = await stub(page);
  await page.goto('/');
  const pills = page.getByTestId('terminal-filter').getByRole('button');
  await expect(pills).toHaveText(['All', 'Axiom', 'GMGN', 'Photon', 'Terminal', 'Trojan']);
  await expect(page.getByTestId('terminal-filter')).not.toContainText(/BullX|Padre/);
  await expect(
    page.getByTestId('terminal-filter').getByRole('button', { name: 'All' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('terminal-filter').getByRole('button', { name: 'Trojan' }).click();
  await expect(
    page.getByTestId('terminal-filter').getByRole('button', { name: 'Trojan' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => queries.some((q) => q.includes('terminal=Trojan'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Listing trojan-trenches-intel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Listing gmgn-pack' })).toHaveCount(0);

  await page.getByTestId('terminal-filter').getByRole('button', { name: 'Terminal' }).click();
  await expect.poll(() => queries.some((q) => q.includes('terminal=Terminal'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Listing terminal-tools' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Listing trojan-trenches-intel' })).toHaveCount(0);
});

test("terminal pills and market cards show each terminal's logo next to its name", async ({
  page,
}) => {
  await stub(page);
  await page.goto('/');
  const filter = page.getByTestId('terminal-filter');
  for (const name of ['Axiom', 'GMGN', 'Photon', 'Terminal', 'Trojan']) {
    await expectTerminalLogo(filter.getByRole('button', { name }), name);
  }
  // "All" has no logo; pill names and accessible names are unchanged.
  await expect(filter.getByRole('button', { name: 'All' }).locator('img')).toHaveCount(0);
  await expect(filter.locator('img')).toHaveCount(5);

  const card = page.getByRole('link', { name: /Listing terminal-tools/ });
  const line = card.getByTestId('card-terminals');
  await expect(line).toHaveText('Terminal · Axiom');
  await expectTerminalLogo(line, 'Terminal', 14);
  await expectTerminalLogo(line, 'Axiom', 14);
});

test('market grid: first three covers load eagerly with high priority, the rest lazily', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/search');
  await expect(page.getByText('5 reviewed listings')).toBeVisible();
  const covers = page.locator('main img[src^="/api/v1/media/"]');
  await expect(covers).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) {
    const cover = covers.nth(i);
    if (i < 3) {
      await expect(cover).not.toHaveAttribute('loading', 'lazy');
      await expect(cover).toHaveAttribute('fetchpriority', 'high');
    } else {
      await expect(cover).toHaveAttribute('loading', 'lazy');
    }
  }
  // Card shows the canonical terminal names.
  await expect(page.getByText('Terminal · Axiom')).toBeVisible();
});

test('market covers are responsive: phones download the 480 px copy, not the 1600 px original', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/media/')) asked.push(new URL(r.url()).search);
  });
  await stub(page);
  await page.goto('/search');
  const cover = page.locator('main img[src^="/api/v1/media/"]').first();
  await expect(cover).toHaveAttribute('srcset', /\?w=480 480w, .*\?w=960 960w, .* 1600w/);
  await expect(cover).toHaveAttribute('sizes', /100vw/);
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  // DPR 1 phone: one-column card, ~390 px wide.
  expect(asked[0]).toBe('?w=480');
});

test('search page keeps its height while loading (no footer jump)', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/listings*', async (route) => {
    await gate;
    await route.fulfill({ json: ALL });
  });
  await page.goto('/search');
  const before = await page.locator('footer').first().boundingBox();
  release();
  await expect(page.getByText('5 reviewed listings')).toBeVisible();
  const after = await page.locator('footer').first().boundingBox();
  expect(before && after).toBeTruthy();
  expect(after!.y).toBeGreaterThanOrEqual(before!.y);
});
