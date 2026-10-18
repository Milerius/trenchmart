import { expect, test } from '@playwright/test';

// Redesign phase 10+: pages that use the prototype's full-width PageHero. The hero spans the
// viewport on desktop, the title uses the large display size, and phones never scroll sideways.

const PAGES: [path: string, title: string][] = [
  ['/creators', 'Creator leaderboard'],
  ['/token', 'Fees fund the token. The token cuts your fees.'],
  ['/verify', "Don't trust. Verify."],
  ['/sell', 'Sell your tooling. Keep 100% of the price.'],
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } }),
  );
});

for (const [path, title] of PAGES) {
  test(`${path}: full-width prototype hero on desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    const h1 = page.getByRole('heading', { level: 1, name: title });
    await expect(h1).toBeVisible();
    const size = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(64);
    const hero = h1.locator('xpath=ancestor::section[1]');
    expect((await hero.boundingBox())!.width).toBeGreaterThan(1400);
  });

  test(`${path}: phone layout has no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
}

test('/token: tier cards, calculator tier radios and the fee split', async ({ page }) => {
  await page.goto('/token');
  await expect(page.getByTestId('tier-card')).toHaveCount(4);
  const calc = page.getByTestId('savings-calculator');
  const og = calc.getByRole('radio', { name: 'OG' });
  await og.click();
  await expect(og).toHaveAttribute('aria-checked', 'true');
  await calc.getByRole('textbox').fill('abc');
  await expect(calc.getByText('Enter a SOL amount with up to 9 decimals.')).toBeVisible();
  await expect(page.getByTestId('fee-split')).toHaveCount(4);
  await expect(page.locator('[data-fx="gradient-text"]')).toHaveCount(0);
});

test('/verify: file check and report check side by side on desktop, proof below', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/verify');
  const file = page.getByRole('region', { name: 'Verify a file' });
  const report = page.getByTestId('report-verifier');
  await expect(file).toBeVisible();
  const [a, b, proof] = await Promise.all([
    file.boundingBox(),
    report.boundingBox(),
    page.getByTestId('proof').boundingBox(),
  ]);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(4);
  expect(b!.x).toBeGreaterThan(a!.x + a!.width);
  expect(proof!.y).toBeGreaterThan(Math.max(a!.y + a!.height, b!.y + b!.height));
});

test('/sell: steps list, live creator costs from config, and both studio links', async ({
  page,
}) => {
  await page.route('**/api/v1/config/public', (route) =>
    route.fulfill({
      json: {
        feeBps: 500,
        tierRebateBps: {},
        tierThresholds: {},
        feeSplitBps: {},
        escrowHours: 1,
        verificationFeeLamports: '250000000',
        bondLamportsByCategory: { filter: '1000000000', setup: '5000000000' },
        uploadLimitPerCreatorDay: 5,
        uploadSupplementLamports: '50000000',
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/sell');
  await expect(page.getByTestId('sell-steps').getByRole('listitem')).toHaveCount(4);
  const fees = page.getByTestId('sell-fees');
  await expect(fees).toContainText('0.25 SOL');
  await expect(fees).toContainText('1–5 SOL');
  await expect(fees).toContainText('5 free / day');
  await expect(fees).toContainText('then 0.05 SOL each');
  await expect(fees).toContainText('1 hour');
  await expect(page.getByRole('link', { name: 'Create a listing' })).toHaveAttribute(
    'href',
    '/studio/listings/new',
  );
  await expect(page.getByRole('link', { name: 'Open creator studio' })).toHaveAttribute(
    'href',
    '/studio',
  );
  // Side by side on desktop.
  const [how, pay] = await Promise.all([
    page.getByRole('region', { name: 'How it works' }).boundingBox(),
    page.getByRole('region', { name: 'What you pay' }).boundingBox(),
  ]);
  expect(Math.abs(how!.y - pay!.y)).toBeLessThan(4);
});

test('/sell: the React Bits Stepper loads on desktop when effects are on', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __TM_FX__?: boolean }).__TM_FX__ = true;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/sell');
  const stepper = page.locator('[data-fx="stepper"]');
  await expect(stepper).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sell-steps')).toHaveCount(0);
  // The column is wide enough for the step titles in the indicator row.
  await expect(stepper.getByText('Get paid in SOL', { exact: true })).toBeVisible();
  await stepper.getByRole('button', { name: 'Next step' }).click();
  await expect(stepper).toContainText('Post your creator bond');
});
