import { expect, test, type Page } from '@playwright/test';

// Public "Recent payouts" feed over a stubbed GET /api/v1/payouts/recent (the endpoint itself is
// covered by apps/api/src/payouts-recent.test.ts): /status card, treasury docs card, home band.

const SIGS = [
  '5vGqZ3h1wNnS9xk2Lq7p8Vt4rB6cD1eF2gH3jK4mN5pQ6rS7tU8vW9xY1zA2bC3dE4fG5hJ6kL7mN8pQ9rS8Lr2',
  '3Hk9aB2cD3eF4gH5jK6mN7pQ8rS9tU1vW2xY3zA4bC5dE6fG7hJ8kL9mN1pQ2rS3tU4vW5xY6zA7bC8dEtW1e',
  '2PzxQ1w2E3r4T5y6U7i8O9pA1sD2fG3hJ4kL5zX6cV7bN8mQ9wE1rT2yU3iO4pA5sD6fG7hJ8kL9zX1cQa7M',
];
const NOW = Date.now();
const iso = (min: number) => new Date(NOW - min * 60_000).toISOString();

const FEED = {
  solUsd: { centsPerSol: '18000', source: 'test' },
  delayMinutes: 10,
  roundMinutes: 15,
  payouts: [
    {
      id: 'p1',
      at: iso(15),
      amount: { lamports: '27000000', sol: '0.027', usdCents: '486' },
      txSig: SIGS[0],
      creator: {
        kind: 'x',
        name: 'Kael Voss',
        handle: 'kaelvoss',
        avatarUrl: null,
        wallet: '7xKqA1b2C3d4E5f6G7h8J9k1L2m3N4p5Q6r7S8Fh3d',
      },
    },
    {
      id: 'p2',
      at: iso(45),
      amount: { lamports: '36000000', sol: '0.036', usdCents: '648' },
      txSig: SIGS[1],
      creator: {
        kind: 'pseudonym',
        name: 'nightowl',
        handle: 'nightowl',
        avatarUrl: null,
        wallet: '9aBcD1e2F3g4H5j6K7m8N9p1Q2r3S4t5U6v7W8x9Yz',
      },
    },
    {
      id: 'p3',
      at: iso(120),
      amount: { lamports: '22500000', sol: '0.0225', usdCents: '405' },
      txSig: SIGS[2],
      creator: {
        kind: 'wallet',
        name: 'Bq4z…Ux7e',
        handle: null,
        avatarUrl: null,
        wallet: 'Bq4zA1b2C3d4E5f6G7h8J9k1L2m3N4p5Q6r7S8Ux7e',
      },
    },
  ],
};

async function stub(page: Page, body: unknown = FEED, status = 200) {
  await page.route('**/api/v1/payouts/recent**', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

for (const [path, title] of [
  ['/status', 'Recent payouts'],
  ['/docs/treasury', 'Latest creator payouts'],
] as const) {
  test(`${path}: payouts card lists creators, SOL + USD, rounded time and Solscan links`, async ({
    page,
  }) => {
    await stub(page);
    await page.goto(path);
    const card = page.getByTestId('payouts-card');
    await expect(card.getByRole('heading', { name: title })).toBeVisible();
    await expect(card.getByTestId('payout-row')).toHaveCount(3);
    const first = card.getByTestId('payout-row').first();
    await expect(first).toContainText('Kael Voss');
    await expect(first).toContainText('@kaelvoss');
    await expect(first).toContainText('◎ 0.027');
    await expect(first).toContainText('≈ $4.86');
    await expect(first).toContainText('~15m ago');
    await expect(first.getByTestId('payout-tx')).toHaveAttribute(
      'href',
      `https://solscan.io/tx/${SIGS[0]}?cluster=devnet`,
    );
    await expect(card.getByTestId('payout-row').nth(2)).toContainText('Bq4z…Ux7e');
    await expect(card).toContainText('Fee-wallet transfers are not shown');
    await expect(card).not.toContainText(/example|sample/i);
  });
}

test('/status payouts card: empty and error states never invent rows', async ({ page }) => {
  await stub(page, { ...FEED, payouts: [] });
  await page.goto('/status');
  await expect(page.getByTestId('payouts-empty')).toBeVisible();
  await page.unroute('**/api/v1/payouts/recent**');
  await stub(page, { error: { code: 'X', message: 'x' } }, 500);
  await page.reload();
  await expect(page.getByTestId('payouts-card')).toContainText('could not be loaded');
});

test('mobile: the card stacks rows and keeps the Solscan link', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await stub(page);
  await page.goto('/status');
  const rows = page.getByTestId('payout-row-m');
  await expect(rows).toHaveCount(3);
  await expect(rows.first().getByTestId('payout-tx')).toHaveAttribute('href', /cluster=devnet$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.close();
});

test('home: the "Paid to creators" band loads lazily and links each chip to Solscan', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/v1/payouts/recent**', (route) => {
    calls += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(FEED) });
  });
  await page.goto('/');
  // Nothing is fetched before the slot nears the viewport.
  await page.waitForTimeout(500);
  const before = calls;
  await page.getByTestId('payouts-band-slot').scrollIntoViewIfNeeded();
  const band = page.getByTestId('payouts-band');
  await expect(band).toBeVisible();
  await expect(band.getByTestId('payout-chip')).toHaveCount(3);
  await expect(band.getByTestId('payout-chip').first()).toHaveAttribute(
    'href',
    `https://solscan.io/tx/${SIGS[0]}?cluster=devnet`,
  );
  await expect(band).toContainText('Paid to creators');
  expect(calls).toBeGreaterThan(before);
});

test('home: no band when there are no payouts', async ({ page }) => {
  await stub(page, { ...FEED, payouts: [] });
  await page.goto('/');
  await page.getByTestId('payouts-band-slot').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('payouts-band')).toHaveCount(0);
});
