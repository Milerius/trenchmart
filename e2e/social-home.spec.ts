import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Home "Paid to creators" tile, live activity band and ticker, the top-creators strip, and the
// /creators leaderboard. /api/v1 is stubbed (the CI e2e job runs without the API).

const CONFIG = {
  feeBps: 500,
  tierRebateBps: { none: 0, scout: 2500, trencher: 6000, og: 10000 },
  tierThresholds: { scout: '100000', trencher: '1000000', og: '10000000' },
  feeSplitBps: { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 },
  escrowHours: 1,
  verificationFeeLamports: '0',
  bondLamportsByCategory: { userscript: '5000000000' },
};
const RULES = {
  bayesM: 20,
  topRatedMinReviews: 5,
  risingMinSales: 5,
  minWalletAgeDays: 7,
  funderWindowDays: 30,
  weights: { buyer: 1, holder: 0.5 },
  holderMinTier: 'scout',
  recomputeMinutes: 10,
};
const ZERO = {
  paidLamports: '0',
  paid30dLamports: '0',
  paidPrior30dLamports: '0',
  rankedCreators: 0,
  xVerifiedCreators: 0,
};
const WALLETS = [
  'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
  '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  'Ez2U27TS3zXqHyrDqZo8ijtdHZNcnfzL4jPZpzrZdsWy',
];

function row(index: number, overrides: Record<string, unknown> = {}) {
  const names = ['rugradar', 'Pulse Labs', '', 'wallet'];
  const kind = index === 0 ? 'x' : index === 1 ? 'pseudonym' : 'wallet';
  const wallet = WALLETS[index]!;
  return {
    position: index + 1,
    creator: {
      kind,
      name: kind === 'wallet' ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : names[index],
      handle: kind === 'x' ? names[index] : null,
      avatarUrl: null,
      wallet,
    },
    sales: 20 - index * 5,
    paidLamports: String((20 - index * 5) * 1_200_000_000),
    rating: { avg: 4.8 - index * 0.2, count: 12 - index * 2 },
    bayes: 4.6 - index * 0.1,
    upvotes: { counted: 30 - index * 6, raw: 40 - index * 7 },
    rising: null,
    listings: 3 - Math.min(index, 2),
    topListing: { title: `Tool ${index + 1}`, slug: `tool-${index + 1}` },
    isNew: index === 3,
    movement: index === 1 ? 2 : index === 2 ? -1 : null,
    spark: Array.from({ length: 14 }, (_, d) => (d % 3 === index % 3 ? 1.2 : 0)),
    ...overrides,
  };
}

function board(tab: string, rows: unknown[], summary = ZERO) {
  return { tab, range: '30d', total: rows.length, offset: 0, rows, summary, rules: RULES };
}

const ACTIVITY = [
  {
    kind: 'sale',
    at: new Date(Date.now() - 120_000).toISOString(),
    listing: { title: 'Bundle Detector Overlay', slug: 'tool-1', category: 'userscript' },
    amountLamports: '1200000000',
    rating: null,
    semver: null,
  },
  {
    kind: 'review',
    at: new Date(Date.now() - 3_600_000).toISOString(),
    listing: { title: 'KOL Wallet List', slug: 'tool-2', category: 'wallet_list' },
    amountLamports: null,
    rating: 5,
    semver: null,
  },
  {
    kind: 'update',
    at: new Date(Date.now() - 7_200_000).toISOString(),
    listing: { title: 'Pulse Filter', slug: 'tool-3', category: 'userscript' },
    amountLamports: null,
    rating: null,
    semver: '1.4.0',
  },
];

type Data = { activity: unknown[]; boards: Record<string, unknown>; paid: string; last24h: string };

async function stub(page: Page, data: Data) {
  const seen: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    seen.push(`${path}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/stats')
      return json({
        source: 'live',
        listings: 4,
        creators: 3,
        orders: 9,
        volume: { lamports: '9000000000', sol: '9.000', usdCents: null },
        paidToCreators: {
          lamports: data.paid,
          sol: '0',
          usdCents: null,
          last24hLamports: data.last24h,
          orders: 3,
        },
        solUsd: { centsPerSol: null },
      });
    if (path === '/activity') return json({ events: data.activity });
    if (path === '/creators/leaderboard') {
      const tab = url.searchParams.get('tab') ?? 'earners';
      return json(data.boards[tab] ?? board(tab, []));
    }
    if (path === '/listings') return json([]);
    if (path === '/config/public') return json(CONFIG);
    if (path === '/prices/sol') return json({ centsPerSol: null });
    return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
  });
  return seen;
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test('home with no activity shows honest zeros and empty states', async ({ page }) => {
  await stub(page, { activity: [], boards: {}, paid: '0', last24h: '0' });
  await page.goto('/');
  await expect(page.getByTestId('paid-to-creators')).toContainText('0');
  await expect(page.getByTestId('paid-to-creators')).not.toContainText('in 24h');
  await expect(page.getByTestId('activity-band')).toHaveCount(0);
  await expect(page.getByTestId('top-creators-empty')).toContainText('No creator payouts');
  await expect(page.getByTestId('creator-card')).toHaveCount(0);
});

test('home shows paid-to-creators, live activity and top creators', async ({ page }) => {
  const seen = await stub(page, {
    activity: ACTIVITY,
    boards: {
      earners: board('earners', [row(0), row(1), row(2)]),
      rated: board('rated', [row(1, { position: 1 })]),
    },
    paid: '36000000000',
    last24h: '1200000000',
  });
  await page.goto('/');
  const paid = page.getByTestId('paid-to-creators');
  await expect(paid).toContainText('36');
  await expect(paid).toContainText('in 24h');
  const band = page.getByTestId('activity-band');
  await expect(band).toContainText('Live on TrenchMart');
  await expect(band).toContainText('SALE');
  await expect(band).toContainText('Bundle Detector Overlay');
  await expect(band).toContainText('v1.4.0');
  await expect(page.getByTestId('ticker')).toContainText('SALE · Bundle Detector Overlay');

  const strip = page.getByTestId('top-creators');
  await expect(strip.getByTestId('creator-card')).toHaveCount(3);
  await expect(strip.getByTestId('creator-card').first()).toContainText('rugradar');
  await strip.getByRole('tab', { name: 'Top rated' }).click();
  await expect(strip.getByTestId('creator-card')).toHaveCount(1);
  await expect(strip.getByTestId('creator-card').first()).toContainText('Pulse Labs');
  expect(seen.some((entry) => entry.startsWith('/creators/leaderboard?tab=rated'))).toBe(true);
  await strip.getByRole('tab', { name: 'Rising' }).click();
  await expect(strip.getByTestId('top-creators-empty')).toContainText('5+ sales');
  await expectNoSeriousAxe(page);
});

test('/creators leaderboard: podium, table, filters and rules', async ({ page }) => {
  const seen = await stub(page, {
    activity: [],
    boards: {
      earners: board('earners', [row(0), row(1), row(2), row(3)], {
        paidLamports: '60000000000',
        paid30dLamports: '36000000000',
        paidPrior30dLamports: '24000000000',
        rankedCreators: 4,
        xVerifiedCreators: 1,
      }),
    },
    paid: '0',
    last24h: '0',
  });
  await page.goto('/creators');
  const lb = page.getByTestId('creator-leaderboard');
  await expect(lb.getByRole('heading', { name: 'Creator leaderboard' })).toBeVisible();
  await expect(page.getByTestId('leaderboard-summary')).toContainText('+50% vs prior 30 days');
  await expect(page.getByTestId('leaderboard-podium').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('leaderboard-row')).toHaveCount(4);
  await expect(page.getByTestId('leaderboard-row').nth(1)).toContainText('▲2');
  await expect(page.getByTestId('leaderboard-row').nth(2)).toContainText('▼1');
  await expect(page.getByTestId('leaderboard-row').nth(3)).toContainText('NEW');
  await expect(page.getByTestId('ranking-rules')).toContainText('20 reviews');
  await expect(page.getByTestId('ranking-never')).toContainText('younger than 7 days');
  await expect(page.getByTestId('ranking-never')).toContainText('Paid featuring');
  await expectNoSeriousAxe(page);

  await lb.getByRole('tab', { name: 'Most upvoted' }).click();
  await expect(page).toHaveURL(/tab=upvoted/);
  await expect(lb).toContainText('No counted upvotes yet.');
  await lb.getByRole('button', { name: '7 days' }).click();
  await expect(page).toHaveURL(/range=7d/);
  // Controlled by the URL, so the box flips once the route updates.
  await lb.getByLabel('𝕏 verified only').click();
  await expect(page).toHaveURL(/verified=1/);
  await expect(lb.getByLabel('𝕏 verified only')).toBeChecked();
  await lb.getByLabel('Category').selectOption('wallet_list');
  await expect(page).toHaveURL(/category=wallet_list/);
  expect(
    seen.some(
      (entry) =>
        entry.includes('tab=upvoted') &&
        entry.includes('range=7d') &&
        entry.includes('verified=1') &&
        entry.includes('category=wallet_list'),
    ),
  ).toBe(true);
});

test('/creators fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, {
    activity: ACTIVITY,
    boards: { earners: board('earners', [row(0), row(1), row(2)]) },
    paid: '0',
    last24h: '0',
  });
  await page.goto('/creators');
  await expect(page.getByTestId('leaderboard-row')).toHaveCount(3);
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(fits).toBe(true);
});
