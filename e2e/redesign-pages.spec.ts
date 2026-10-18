import { expect, test } from '@playwright/test';

// Redesign phase 10+: pages that use the prototype's full-width PageHero. The hero spans the
// viewport on desktop, the title uses the large display size, and phones never scroll sideways.

const PAGES: [path: string, title: string][] = [['/creators', 'Creator leaderboard']];

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
