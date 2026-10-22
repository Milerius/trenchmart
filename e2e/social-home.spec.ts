import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './legibility';
import { expectNoHorizontalOverflow, expectNoOverlap } from './layout-helpers';

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
  await lb.getByText('verified only', { exact: true }).click();
  await expect(page).toHaveURL(/verified=1/);
  await expect(lb.getByLabel('X verified only')).toBeChecked();
  await lb.getByLabel('Category').selectOption('wallet_list');
  await expect(page).toHaveURL(/category=wallet_list/);
  await expect
    .poll(() =>
      seen.some(
        (entry) =>
          entry.includes('tab=upvoted') &&
          entry.includes('range=7d') &&
          entry.includes('verified=1') &&
          entry.includes('category=wallet_list'),
      ),
    )
    .toBe(true);
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

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`/creators podium: crown on the #1 card only (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stub(page, {
      activity: [],
      boards: { earners: board('earners', [row(0), row(1), row(2), row(3)]) },
      paid: '0',
      last24h: '0',
    });
    await page.goto('/creators');
    const cards = page.getByTestId('podium-card');
    await expect(cards).toHaveCount(3);
    // Exactly one crown on the page, inside the winner's card, above the avatar.
    await expect(page.getByTestId('podium-crown')).toHaveCount(1);
    const winner = cards.filter({ has: page.getByTestId('podium-crown') });
    await expect(winner).toHaveCount(1);
    await expect(winner).toContainText('rugradar');
    const crown = winner.getByTestId('podium-crown');
    await expect(crown).toBeVisible();
    const c = (await crown.boundingBox())!;
    const a = (await winner.getByTestId('podium-avatar').boundingBox())!;
    expect(c.width).toBeCloseTo(22, 0);
    expect(c.y + c.height).toBeLessThanOrEqual(a.y + 2);
    expect(Math.abs(c.x + c.width / 2 - (a.x + a.width / 2))).toBeLessThan(2);
    // Crown stays inside the card (the card clips overflow).
    const w = (await winner.boundingBox())!;
    expect(c.y).toBeGreaterThan(w.y);
    // Rank badges 1/2/3 sit on every avatar; only #1 is lime.
    const badges = page.getByTestId('podium-rank-badge');
    await expect(badges).toHaveText(['2', '1', '3']); // DOM order 2 · 1 · 3; CSS reorders on phones
    for (const name of ['Pulse Labs']) {
      await expect(cards.filter({ hasText: name }).getByTestId('podium-crown')).toHaveCount(0);
    }
    // DOM order is 2 · 1 · 3. Desktop: winner in the middle, lifted (prototype md:-translate-y-4).
    // Phone: winner stacked first.
    const boxes = await Promise.all(
      [0, 1, 2].map(async (i) => (await cards.nth(i).boundingBox())!),
    );
    if (vp.name === 'desktop') {
      expect(boxes[1]!.y).toBeLessThan(boxes[0]!.y - 8);
    } else {
      expect(boxes[1]!.y).toBeLessThan(boxes[0]!.y);
    }
    // Visual check: the crown is drawn in the lime accent (a stroked SVG, not a blank box).
    const stroke = await crown.evaluate((el) => getComputedStyle(el).color);
    expect(stroke).toBe('rgb(198, 244, 50)');
    await test.info().attach(`podium-${vp.name}.png`, {
      body: await page.getByTestId('leaderboard-podium').screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(vp.width);
  });
}

for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
  test(`/creators layout: podium, table and ranking panel never overlap (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await stub(page, {
      activity: [],
      boards: { earners: board('earners', [row(0), row(1), row(2), row(3)]) },
      paid: '0',
      last24h: '0',
    });
    await page.goto('/creators');
    const cards = page.getByTestId('podium-card');
    await expect(cards).toHaveCount(3);
    // The table scrolls sideways inside its card on narrow screens; measure the card.
    const table = page.getByTestId('leaderboard-table').locator('xpath=..');
    const rules = page.getByTestId('ranking-rules');
    await expect(table).toBeVisible();
    await expectNoOverlap([
      { label: 'podium #2', locator: cards.nth(0) },
      { label: 'podium #1', locator: cards.nth(1) },
      { label: 'podium #3', locator: cards.nth(2) },
      { label: 'table', locator: table },
      { label: 'ranking panel', locator: rules },
    ]);
    // Not just "not overlapping": a real gap between the podium and what follows.
    const podiumBottom = Math.max(
      ...(await Promise.all(
        [0, 1, 2].map(async (i) => {
          const b = (await cards.nth(i).boundingBox())!;
          return b.y + b.height;
        }),
      )),
    );
    const below = Math.min((await table.boundingBox())!.y, (await rules.boundingBox())!.y);
    expect(
      below - podiumBottom,
      `gap below the podium ${below - podiumBottom}px`,
    ).toBeGreaterThanOrEqual(16);
    // Every card's stats boxes sit inside the card.
    for (let i = 0; i < 3; i++) {
      const card = (await cards.nth(i).boundingBox())!;
      const last = (await cards.nth(i).locator('> span').last().boundingBox())!;
      expect(last.y + last.height, `podium card ${i} content clipped`).toBeLessThanOrEqual(
        card.y + card.height,
      );
    }
    await expectNoHorizontalOverflow(page.locator('body'), 'body');
    await expectLegible(page.getByRole('heading', { level: 1, name: 'Creator leaderboard' }));
    await expectLegible(cards.nth(1).getByText('paid out', { exact: false }), 'podium caption');
    await expectLegible(table.locator('thead th').first(), 'table header');
    await test.info().attach(`creators-${width}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}
