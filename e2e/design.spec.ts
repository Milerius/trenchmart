import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The CI e2e job runs the web app without the API, so these specs stub /api/v1 in the browser.

const CONFIG = {
  feeBps: 500,
  tierRebateBps: { none: 0, scout: 2500, trencher: 6000, og: 10000 },
  tierThresholds: { scout: '[X]', trencher: '[Y]', og: '[Z]' },
  tierWindowHours: 72,
  feeSplitBps: { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 },
  escrowHours: 48,
  verificationFeeLamports: '0',
  bondLamportsByCategory: { userscript: '5000000000' },
  terminals: ['Axiom', 'GMGN'],
};

const LISTING = {
  id: 'listing-1',
  slug: 'bundle-detector-overlay',
  title: 'Bundle Detector Overlay',
  summary: 'Overlay that flags bundled launches on Axiom.',
  description: 'Overlay that flags bundled launches on Axiom.',
  category: 'userscript',
  terminals: ['Axiom'],
  price: '1200000000',
  license: 'single',
  holderOnly: false,
  sales7d: 533,
  ratingAvg: '4.90',
  ratingCount: 12,
  creator: {
    handle: 'rugradar',
    wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
    bondLamports: '5000000000',
  },
  preview: '// ==UserScript==\n// @name Bundle Detector Overlay\n// ==/UserScript==',
  security: {
    semver: '1.0.0',
    sha256: '2e59f5ba07bda6fd4faaadc50fd36f105223695c357df3c318b79d11b49ce957',
    summary: 'pass',
    passed: 2,
    total: 2,
    checks: [
      {
        ruleId: 'no-eval',
        result: 'pass',
        title: 'No eval',
        detail: 'No eval or dynamic import().',
      },
      {
        ruleId: 'no-key-access',
        result: 'pass',
        title: 'No key access',
        detail: 'No wallet-storage reads.',
      },
    ],
    declared: { match: ['https://axiom.trade/*'], connect: [] },
    review: {
      agentId: 'trenchmart-ai-v1',
      decision: 'approve',
      signedAt: '2026-10-17T06:40:46.260Z',
    },
  },
};

const SESSION = (tier: string) => ({
  user: { id: 'u1', wallet: '7xKpQ2nV8mJr3sTa9Fq', handle: 'buyer', roles: [] },
  tier,
});

const HOUR = 3_600_000;

async function stubApi(page: Page, routes: Record<string, unknown>) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const key = Object.keys(routes).find((pattern) => pattern === path);
    if (key === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'not found' } },
      });
      return;
    }
    await route.fulfill({ status: 200, json: routes[key] });
  });
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test('listing shows the exact fee breakdown before connecting', async ({ page }) => {
  await stubApi(page, {
    '/listings/bundle-detector-overlay': LISTING,
    '/listings/bundle-detector-overlay/reviews': [],
    '/config/public': CONFIG,
    '/prices/sol': { centsPerSol: '18000' },
  });
  await page.goto('/l/bundle-detector-overlay');
  const checkout = page.getByTestId('checkout');
  await expect(checkout).toBeVisible();
  await expect(checkout.getByTestId('preview-notice')).toBeVisible();
  const fees = checkout.getByTestId('fee-breakdown');
  await expect(fees).toContainText('Buyer fee (5%)');
  await expect(fees).toContainText('0.06 SOL');
  await expect(fees).toContainText('Creator commission');
  await expect(fees).toContainText('0%');
  await expect(fees).toContainText('1.26 SOL');
  await expect(fees).toContainText('≈ $226.80');
  await expect(page.getByTestId('buy')).toHaveText('Connect wallet to buy');
  await expectNoSeriousAxe(page);
});

test('connected Trencher sees 60% off the fee and the AI verification split', async ({ page }) => {
  await stubApi(page, {
    '/me': SESSION('trencher'),
    '/listings/bundle-detector-overlay': LISTING,
    '/listings/bundle-detector-overlay/reviews': [],
    '/config/public': CONFIG,
    '/prices/sol': { centsPerSol: '18000' },
  });
  await page.goto('/l/bundle-detector-overlay');
  const fees = page.getByTestId('fee-breakdown');
  await expect(fees).toContainText('Trencher discount (60% off the fee)');
  await expect(fees).toContainText('−0.036 SOL');
  await expect(fees).toContainText('1.224 SOL');
  await expect(page.getByTestId('preview-notice')).toHaveCount(0);
  await fees.getByText('Where the fee goes').click();
  await expect(fees).toContainText('AI verification · 25%');
  await expect(fees).not.toContainText(/verifiers/i);
  await expect(page.getByTestId('buy')).toHaveText('Pay into escrow');
});

test('downloads stay locked until escrow releases', async ({ page }) => {
  const now = Date.now();
  const order = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Order ${status}`,
    slug: 'bundle-detector-overlay',
    status,
    paid_at: new Date(now - 6 * HOUR).toISOString(),
    escrow_until: new Date(now + 42 * HOUR).toISOString(),
    released_at: null,
    tier_at_purchase: 'trencher',
    amount: { lamports: '1224000000', usdCents: '22032' },
    ...extra,
  });
  await stubApi(page, {
    '/me': SESSION('trencher'),
    '/config/public': CONFIG,
    '/prices/sol': { centsPerSol: '18000' },
    '/me/orders': {
      orders: [
        order('11111111-a', 'paid'),
        order('22222222-b', 'released', {
          escrow_until: new Date(now - 2 * HOUR).toISOString(),
          released_at: new Date(now - 2 * HOUR).toISOString(),
        }),
        order('33333333-c', 'disputed'),
      ],
    },
  });
  await page.goto('/me/purchases');
  const buttons = page.getByTestId('download-button');
  await expect(buttons).toHaveCount(3);
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'locked');
  await expect(buttons.nth(0)).toBeDisabled();
  await expect(buttons.nth(0)).toContainText('Unlocks in 41h');
  await expect(buttons.nth(1)).toHaveAttribute('data-state', 'ready');
  await expect(buttons.nth(1)).toBeEnabled();
  await expect(buttons.nth(2)).toContainText('Locked during dispute');
  await expect(page.getByTestId('escrow-timeline')).toHaveCount(3);
  await expect(page.locator('[data-testid="status-tag"][data-status="paid"]')).toContainText(
    'PAID · IN ESCROW',
  );
  await expectNoSeriousAxe(page);
});

test('landing marks sample stats and switches to live data', async ({ page }) => {
  const stats = (source: 'mock' | 'live') => ({
    source,
    note: source === 'mock' ? 'Sample figures until the first listing goes live.' : null,
    listings: 8,
    creators: 4,
    orders: 128,
    volume: { lamports: '11500000000', sol: '11.500', usdCents: '207000' },
    solUsd: { centsPerSol: '18000' },
  });
  await stubApi(page, {
    '/stats': stats('mock'),
    '/listings': [LISTING],
    '/config/public': CONFIG,
  });
  await page.goto('/');
  await expect(page.getByTestId('landing-stats')).toHaveAttribute('data-source', 'mock');
  await expect(page.getByTestId('dashboard')).toContainText('SAMPLE DATA');
  await expect(page.getByTestId('preview-notice')).toBeVisible();
  await expect(page.getByTestId('listing-card')).toContainText('+ 5% buyer fee');
  await expectNoSeriousAxe(page);

  await page.unrouteAll();
  await stubApi(page, {
    '/stats': stats('live'),
    '/listings': [LISTING],
    '/config/public': CONFIG,
  });
  await page.reload();
  await expect(page.getByTestId('landing-stats')).toHaveAttribute('data-source', 'live');
  await expect(page.getByTestId('dashboard')).not.toContainText('SAMPLE DATA');
});

test('live AI review streams each step to an outcome', async ({ page }) => {
  const events = [
    { step: 'static', status: 'running' },
    { step: 'sandbox', status: 'running' },
    { step: 'static', status: 'pass', durationMs: 420, summary: '15 of 15 checks passed' },
    {
      step: 'sandbox',
      status: 'pass',
      durationMs: 1900,
      log: {
        requests: [],
        walletCalls: [],
        errors: [],
        log: ['loaded https://axiom.trade/pulse'],
        egress: 'blocked',
      },
    },
    { step: 'ai', status: 'running' },
    { step: 'ai', status: 'done', durationMs: 2600, verdict: 'approve', decision: 'approve' },
    { step: 'done', status: 'done', versionStatus: 'live' },
  ];
  const body = events
    .map((event) => `event: ${event.step}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  const version = (status: string) => ({
    version: {
      status,
      semver: '1.0.0',
      file_name: 'overlay.user.js',
      sha256: 'ab'.repeat(32),
      creator_note: null,
    },
    checks: [],
    review: null,
  });
  let streamed = false;
  await stubApi(page, { '/me': SESSION('none') });
  await page.route('**/api/v1/studio/versions/v1/complete*', (route) => {
    streamed = true;
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route('**/api/v1/studio/versions/v1', (route) =>
    route.fulfill({ json: version(streamed ? 'live' : 'uploading') }),
  );
  await page.goto('/studio/listings/l1/versions/v1');
  await expect(page.getByTestId('review-step')).toHaveCount(3);
  await expect(page.getByTestId('review-timing').first()).toHaveText('0.4s');
  await expect(page.getByTestId('sandbox-log')).toContainText('egress blocked');
  await expect(page.getByTestId('review-outcome')).toContainText('Approved and live');
  await expect(page.getByTestId('studio')).not.toContainText(/human|appeal/i);
  await expectNoSeriousAxe(page);
});
