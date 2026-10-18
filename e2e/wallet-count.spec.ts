import { expect, test, type Page } from '@playwright/test';

// A wallet list's count is verified: the security scan counts the unique Solana addresses in the
// uploaded file, and the listing shows that number (never a seller-typed one). The CI e2e job
// runs without the API, so /api/v1 is stubbed with the shape the API returns.

const listing = {
  id: '00000000-0000-4000-8000-000000000077',
  slug: 'tracker-whales',
  title: 'Tracker Whales',
  summary: 'Wallet tracker export of whales.',
  description: 'Import into your wallet tracker.',
  category: 'wallet_list',
  terminals: ['Axiom'],
  price: '500000000',
  license: 'single',
  holderOnly: false,
  ratingCount: 0,
  kind: 'wallet',
  // An older listing may still carry a typed count in specs: it must not be shown.
  specs: { chain: 'solana', formats: ['json'], cadence: 'weekly', columns: [], walletCount: 9999 },
  creator: {
    handle: 'lists',
    wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
    bondLamports: '0',
  },
  preview: null,
  security: {
    semver: '1.1.0',
    sha256: 'a'.repeat(64),
    summary: 'pass',
    passed: 4,
    total: 4,
    checks: [
      {
        ruleId: 'wl-schema',
        result: 'pass',
        title: 'Wallet list schema',
        detail: '767 unique Solana wallets counted from the file (767 rows, 0 duplicates removed).',
      },
    ],
    declared: {},
    review: { agentId: 'rules@1.0.0', decision: 'approve', signedAt: '2026-10-18T04:00:00Z' },
  },
  walletCount: {
    count: 767,
    versionId: 'v2',
    semver: '1.1.0',
    source: 'file',
    facts: { format: 'standard', rows: 767, duplicates: 0, invalid: 0, named: 767 },
  },
  content: null,
};

async function stub(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/me') return json({ error: { code: 'UNAUTHORIZED', message: 'sign in' } }, 401);
    if (path === '/prices/sol')
      return json({ centsPerSol: '10000', source: 'live', fetchedAt: new Date().toISOString() });
    if (path === `/listings/${listing.slug}`) return json(listing);
    if (path === `/listings/${listing.slug}/versions`)
      return json([
        {
          semver: '1.1.0',
          changelog: 'Weekly refresh',
          created_at: '2026-10-18T04:00:00Z',
          status: 'live',
          walletCount: 767,
        },
        {
          semver: '1.0.0',
          changelog: 'First list',
          created_at: '2026-10-11T04:00:00Z',
          status: 'superseded',
          walletCount: 412,
        },
      ]);
    if (path.endsWith('/reviews')) return json([]);
    return route.fallback();
  });
}

test('a wallet list shows the count counted from its file', async ({ page }) => {
  await stub(page);
  await page.goto(`/l/${listing.slug}`);
  await expect(page.getByTestId('wallet-count')).toHaveText('767 wallets, counted from the file');
  await expect(page.getByText('9,999')).toHaveCount(0);

  await page.getByRole('tab', { name: /How to/ }).click();
  const specs = page.getByTestId('listing-specs');
  await expect(specs).toContainText('Wallets');
  await expect(specs).toContainText('767 wallets, counted from the file');
  await expect(specs).not.toContainText('9,999');

  // Each version carries its own count.
  await page.getByRole('tab', { name: /Changelog/ }).click();
  await expect(page.getByText('· 767 wallets, counted from the file')).toBeVisible();
  await expect(page.getByText('· 412 wallets, counted from the file')).toBeVisible();
});
