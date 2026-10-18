import { expect, test } from '@playwright/test';

// Redesign (React Bits port). Each phase adds its checks here; existing specs keep covering behaviour.

test.describe('phase 1: fonts', () => {
  test('headings keep their accessible names with the serif accent', async ({ page }) => {
    await page.goto('/');
    const hero = page.getByRole('heading', { level: 1, name: 'The verified edge, for sale.' });
    await expect(hero).toBeVisible();
    for (const name of [
      'Top creators this month',
      'Trending this week',
      'Four steps, no surprises.',
      'Find your edge',
      'Hold $TRENCH, pay less.',
      "Built so you don't have to trust anyone.",
      'Have an edge? Sell it.',
    ]) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeAttached();
    }
    await page.goto('/creators');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Creator leaderboard' }),
    ).toBeVisible();
    await page.goto('/sell');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sell your tooling. Keep 100% of the price.' }),
    ).toBeVisible();
    await page.goto('/token');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Fees fund the token. The token cuts your fees.',
      }),
    ).toBeVisible();
    await page.goto('/search');
    await expect(page.getByRole('heading', { level: 1, name: 'All live listings' })).toBeVisible();
  });

  test('the accent uses the self-hosted Instrument Serif; body text stays Geist', async ({
    page,
  }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) external.push(request.url());
    });
    await page.goto('/');
    const accent = page.getByRole('heading', { level: 1 }).locator('em');
    await expect(accent).toHaveText('for sale.');
    const family = await accent.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/Instrument Serif/i);
    expect(await accent.evaluate((el) => getComputedStyle(el).fontStyle)).toBe('italic');
    const body = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(body).toMatch(/Geist/i);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (f) => /Instrument Serif/i.test(f.family) && f.status === 'loaded',
        ),
      ),
    ).toBe(true);
    expect(external).toEqual([]);
  });
});
