import { expect, test, type Page } from '@playwright/test';

// X is optional (a trust badge), never a gate to sell. The badge shows only for an X account
// verified through X sign-in; other creators show their pseudonym or their short wallet.
const WALLET = 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ';

function listing(slug: string, creator: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-000000000009',
    slug,
    title: 'Badge Pack',
    summary: 'Flags bundled launches.',
    description: 'Overlay.',
    category: 'userscript',
    terminals: ['Axiom'],
    price: '100000000',
    license: 'single',
    holderOnly: false,
    sales7d: 0,
    ratingAvg: null,
    ratingCount: 0,
    upvotes: 0,
    creator: { wallet: WALLET, bondLamports: '1000000000', ...creator },
    preview: null,
    security: null,
  };
}

async function stub(page: Page, routes: Record<string, unknown>) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path in routes) return route.fulfill({ status: 200, json: routes[path] });
    if (path === '/me')
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHORIZED', message: 'x' } },
      });
    if (path === '/prices/sol')
      return route.fulfill({
        status: 200,
        json: { centsPerSol: '10000', source: 'live', fetchedAt: new Date().toISOString() },
      });
    if (path.endsWith('/versions') || path.endsWith('/reviews'))
      return route.fulfill({ status: 200, json: [] });
    return route.fallback();
  });
}

test('listing: a creator with X verified through X sign-in shows the verified badge', async ({
  page,
}) => {
  await stub(page, {
    '/listings/verified-pack': listing('verified-pack', {
      handle: 'rugradar',
      xHandle: 'realtrader',
      xVerified: true,
    }),
  });
  await page.goto('/l/verified-pack');
  const creator = page.getByTestId('listing-creator');
  await expect(creator).toContainText('@rugradar');
  await expect(creator.getByTestId('creator-x-verified')).toContainText('X @realtrader');
  await expect(creator.getByText('X verified')).toBeAttached();
  if (process.env.X_OPTIONAL_SHOTS)
    await page.locator('main').screenshot({
      path: `${process.env.X_OPTIONAL_SHOTS}/listing-verified.png`,
      clip: { x: 0, y: 0, width: 1280, height: 420 },
    });
});

test('listing: an unverified creator (no X, or a typed handle) shows a pseudonym or short wallet and no badge', async ({
  page,
}) => {
  await stub(page, {
    '/listings/pseudonym-pack': listing('pseudonym-pack', {
      handle: 'quietbuilder',
      xHandle: null,
      xVerified: false,
    }),
    '/listings/wallet-pack': listing('wallet-pack', {
      handle: null,
      xHandle: 'typed_name',
      xVerified: false,
    }),
  });
  await page.goto('/l/pseudonym-pack');
  const creator = page.getByTestId('listing-creator');
  await expect(creator).toContainText('@quietbuilder');
  await expect(creator.getByTestId('creator-x-verified')).toHaveCount(0);
  await expect(creator.getByText('X verified')).toHaveCount(0);

  await page.goto('/l/wallet-pack');
  await expect(creator).toContainText('H4kHTS…cdbZ');
  await expect(creator.getByRole('link')).toHaveAttribute('href', `/u/${WALLET}`);
  await expect(creator.getByTestId('creator-x-verified')).toHaveCount(0);
  await expect(creator).not.toContainText('typed_name');
  if (process.env.X_OPTIONAL_SHOTS)
    await page.locator('main').screenshot({
      path: `${process.env.X_OPTIONAL_SHOTS}/listing-unverified.png`,
      clip: { x: 0, y: 0, width: 1280, height: 420 },
    });
});

test('profile: no X badge for an unverified creator; a typed handle is labelled unverified', async ({
  page,
}) => {
  const base = { wallet: WALLET, bond: '1000000000', listings: [] };
  await stub(page, {
    '/creators/quietbuilder': { ...base, handle: 'quietbuilder', xHandle: null, xVerified: false },
    '/creators/typed': { ...base, handle: 'typed', xHandle: 'typed_name', xVerified: false },
  });
  await page.goto('/u/quietbuilder');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('X verified')).toHaveCount(0);
  await page.goto('/u/typed');
  await expect(page.getByTestId('x-unverified')).toHaveText('(unverified)');
  await expect(page.getByText('X verified')).toHaveCount(0);
});
