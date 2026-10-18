import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { studioListing, studioOverview } from './studio-fixtures';

// Creator dashboard at /studio: every number comes from /studio/overview; stats with no data
// (rating without reviews) are left out. /api/v1 is stubbed; the wallet is the test signer.

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

const CONFIG = { feeBps: 500, escrowHours: 1, terminals: ['Axiom'], tierRebateBps: {} };
const REQ = {
  xLinked: true,
  bondRequired: '1000000000',
  bondActive: '2000000000',
  bondOk: true,
  verificationFee: '250000000',
  feeWaived: false,
};
const AT = '2026-10-15T10:00:00Z';
const LISTINGS = [
  studioListing({
    id: 'L1',
    slug: 'bundle-detector',
    title: 'Bundle Detector Overlay',
    price: '1200000000',
    sales: 87,
    sales7d: 9,
    subscribers: 14,
    rating: { avg: 4.9, count: 21 },
    live: { semver: '1.4.2', status: 'live' },
    latest: { id: 'V1', semver: '1.4.2', status: 'live', at: AT },
  }),
  studioListing({
    id: 'L2',
    slug: 'migration-watcher',
    title: 'Migration Watcher',
    price: '900000000',
    sales: 33,
    sales7d: 2,
    live: { semver: '2.0.3', status: 'live' },
    latest: { id: 'V2', semver: '2.1.0', status: 'needs_creator', at: AT },
  }),
  studioListing({
    id: 'L3',
    slug: 'holder-heatmap',
    title: 'Holder Heatmap',
    category: 'strategy',
    latest: { id: 'V3', semver: '0.9.1', status: 'scanning', at: AT },
  }),
  studioListing({
    id: 'L4',
    slug: 'kol-list',
    title: 'KOL Tracker List',
    category: 'wallet_list',
    latest: { id: 'V4', semver: '1.0.0', status: 'uploading', at: AT },
  }),
];
const daily = (peak: number) => Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? peak : i));

async function stub(page: Page, overview: (wallet: string) => unknown, req = REQ) {
  const pair = nacl.sign.keyPair();
  const address = bs58.encode(pair.publicKey);
  await page.addInitScript((value) => {
    (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ = value;
  }, bs58.encode(pair.secretKey));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/me')
      return json({
        user: { id: 'u1', wallet: address, handle: 'rugradar', roles: [] },
        tier: 'trencher',
      });
    if (path === '/config/public') return json(CONFIG);
    if (path === '/studio/requirements') return json(req);
    if (path === '/studio/overview') return json(overview(address));
    if (
      path === '/studio/payouts' &&
      (overview(address) as { payouts: { sent: string } }).payouts.sent === '0'
    )
      return json({ total: { lamports: '0', usdCents: null }, payouts: [] });
    if (path === '/studio/payouts')
      return json({
        total: { lamports: '1180000000', usdCents: null },
        payouts: [
          {
            id: 'p1',
            amount: { lamports: '1200000000', usdCents: null },
            bucket: 'creator',
            status: 'sent',
            created_at: '2026-10-17T22:14:00Z',
          },
        ],
      });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return address;
}

const FULL = (wallet: string) =>
  studioOverview(
    wallet,
    {
      creator: {
        wallet,
        handle: 'rugradar',
        memberSince: '2026-03-02T00:00:00.000Z',
        displayName: 'RugRadar',
        avatarUrl: null,
        xHandle: 'rugradar',
        xVerified: true,
        profileFilled: { done: 4, of: 5 },
      },
      revenue: { total: '41200000000', daily: daily(3_000_000_000).map(String) },
      sales: { total30d: 120, last7d: 11, daily: daily(9) },
      updates: { paying: 14, monthly: '1400000000', inFreeMonth: 6 },
      rating: { avg: 4.8, count: 21, distribution: [17, 3, 1, 0, 0] },
      disputes: { open: 0, upheld: 0 },
      payouts: {
        sent: '1180000000',
        inMultisig: '300000000',
        queued: '0',
        inEscrow: '900000000',
        nextRelease: '2026-10-18T09:12:00Z',
      },
    },
    LISTINGS,
  );

test('dashboard: real stats, needs-note banner, one action per listing and filter tabs', async ({
  page,
}) => {
  await stub(page, FULL);
  await page.goto('/studio');
  await expect(page.getByRole('heading', { level: 1, name: 'RugRadar' })).toBeVisible();
  await expect(page.getByTestId('studio-x')).toHaveText('X @rugradar · verified');
  await expect(page.getByRole('link', { name: 'View public profile' })).toHaveAttribute(
    'href',
    '/u/rugradar',
  );

  await expect(page.getByTestId('stat-revenue')).toContainText('41.2');
  await expect(page.getByTestId('stat-sales')).toContainText('11 in the last 7 days');
  await expect(page.getByTestId('stat-subs')).toContainText('14');
  await expect(page.getByTestId('stat-rating')).toContainText('★ 4.8');
  await expect(page.getByTestId('stat-rating')).toContainText('21 reviews');
  await expect(page.getByTestId('stat-paid')).toContainText('in 1 hour escrow');

  const banner = page.getByTestId('needs-note');
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText('Migration Watcher v2.1.0 needs your note');
  await expect(banner).toContainText('v2.0.3 stays live');

  const rows = page.getByTestId('studio-listing-row');
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('upload-new-version')).toHaveCount(1);
  await expect(page.getByTestId('upload-new-version')).toHaveAttribute(
    'href',
    '/studio/listings/L1/versions/new',
  );
  await expect(page.getByTestId('add-note')).toHaveAttribute(
    'href',
    '/studio/listings/L2/versions/V2',
  );
  await expect(page.getByTestId('watch-review')).toHaveAttribute(
    'href',
    '/studio/listings/L3/versions/V3',
  );
  await expect(page.getByTestId('finish-upload')).toBeVisible();

  if (process.env.STUDIO_SHOTS) {
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.screenshot({ path: `${process.env.STUDIO_SHOTS}/dashboard.png`, fullPage: true });
  }
  await page.getByRole('tab', { name: /In review/ }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('tab', { name: /Drafts/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('KOL Tracker List');

  const ready = page.getByRole('region', { name: 'Ready to sell' });
  await expect(ready).toContainText('3 of 3 required');
  await expect(ready).toContainText('0.25 SOL per version');
  await expect(ready).toContainText('4/5');
  await expect(page.getByTestId('updates-card')).toContainText(
    '14 paying · 6 in their free first month',
  );
  await expect(page.getByTestId('dashboard')).toContainText('next release');
});

test('dashboard: a new creator sees zeros and no rating, never sample numbers', async ({
  page,
}) => {
  await stub(page, (wallet) => studioOverview(wallet), {
    ...REQ,
    xLinked: false,
    bondActive: '0',
    bondOk: false,
  });
  await page.goto('/studio');
  await expect(page.getByTestId('studio-stats')).toBeVisible();
  await expect(page.getByTestId('stat-rating')).toHaveCount(0);
  await expect(page.getByTestId('stat-sales')).toContainText('0 in the last 7 days');
  await expect(page.getByTestId('stat-revenue')).toContainText('No activity yet');
  await expect(page.getByTestId('studio-x')).toHaveText('X not linked');
  await expect(page.getByTestId('needs-note')).toHaveCount(0);
  await expect(page.getByText('No listings yet')).toBeVisible();
  const ready = page.getByRole('region', { name: 'Ready to sell' });
  await expect(ready).toContainText('2 of 3 required');
  await expect(ready).toContainText('X badge (optional)');
  await expect(page.getByTestId('link-x-profile')).toHaveText('Verify with X for a trust badge →');
  if (process.env.STUDIO_SHOTS) {
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.screenshot({
      path: `${process.env.STUDIO_SHOTS}/dashboard-new-creator.png`,
      fullPage: true,
    });
  }
});

test('dashboard on mobile: no horizontal overflow outside the listings table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, FULL);
  await page.goto('/studio');
  await expect(page.getByTestId('stat-revenue')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Phones get cards instead of the wide table.
  await expect(page.getByTestId('studio-listings')).toBeHidden();
  await expect(page.getByTestId('studio-listing-cards').locator('li')).toHaveCount(4);
  await expect(page.getByTestId('upload-new-version-mobile')).toBeVisible();
  if (process.env.STUDIO_SHOTS) {
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({
      path: `${process.env.STUDIO_SHOTS}/dashboard-mobile.png`,
      fullPage: true,
    });
  }
});
