import { expect, test } from '@playwright/test';

// Home perf (mobile Lighthouse): below-the-fold sections use content-visibility for real visitors,
// skeletons shimmer with a compositor-only transform, and automated browsers render every section.
test('home: below-the-fold sections are content-visibility islands', async ({ page }) => {
  await page.goto('/');
  const islands = page.locator('.cv-section');
  await expect(islands.first()).toBeAttached();
  expect(await islands.count()).toBeGreaterThanOrEqual(6);
  // The hero and the stats band are never skipped (first viewport, LCP).
  await expect(page.locator('[data-testid=hero] .cv-section')).toHaveCount(0);
  await expect(page.locator('.cv-section [data-testid=landing-stats]')).toHaveCount(0);
  // Automation opts out so full-page screenshots and assertions see every section.
  await expect(page.locator('html')).toHaveAttribute('data-cv', 'off');
  expect(await islands.first().evaluate((el) => getComputedStyle(el).contentVisibility)).toBe(
    'visible',
  );
  await expect(page.getByTestId('sell-cta')).toBeVisible();
});

test('home: islands use content-visibility auto for real visitors, no sideways scroll', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'webdriver', { get: () => false }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveAttribute('data-cv', 'off');
  expect(
    await page
      .locator('.cv-section')
      .first()
      .evaluate((el) => getComputedStyle(el).contentVisibility),
  ).toBe('auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Scrolling to the end paints the last section.
  await page.getByTestId('sell-cta').scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: /Have an edge/ })).toBeVisible();
});

test('skeleton shimmer animates transform, not background-position', async ({ page }) => {
  await page.route('**/api/v1/stats', () => new Promise(() => {}));
  await page.goto('/');
  const sk = page.getByTestId('skeleton').first();
  await expect(sk).toBeAttached();
  const anim = await sk.evaluate((el) => {
    const after = getComputedStyle(el, '::after');
    return { name: after.animationName, bg: getComputedStyle(el).animationName };
  });
  expect(anim.name).toBe('shimmer');
  expect(anim.bg).toBe('none');
});
