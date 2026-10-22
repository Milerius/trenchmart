import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = ['/', '/sell', '/token', '/search', '/creators', '/studio', '/me/purchases'] as const;

for (const path of pages) {
  test(`${path} renders and has no serious axe violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId('nav')).toBeVisible();
    // Scroll through once so every scroll reveal ([data-reveal]) has fired: a block still waiting
    // at opacity 0 would read as a 1:1 contrast failure (flaky on the home stats tiles).
    // Repeat the pass if a block was skipped (a cold dev compile can stall a frame mid-scroll).
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            for (
              let y = 0;
              y < document.documentElement.scrollHeight;
              y += window.innerHeight / 2
            ) {
              window.scrollTo(0, y);
              await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));
            }
            window.scrollTo(0, 0);
            await new Promise((resolve) => setTimeout(resolve, 100));
            return document.querySelectorAll('[data-reveal="wait"]').length;
          }),
        { timeout: 15_000 },
      )
      .toBe(0);
    // Let the one-shot entrance animations (rise, route fade) settle so axe measures the
    // final colours rather than a half-faded frame. Infinite loops (ticker, glow) are skipped.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}

test('home, listing shell, and dashboard expose the market test ids', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The verified edge, for sale.' })).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('terminal-filter')).toBeVisible();
  await expect(page.getByTestId('header-search')).toBeVisible();

  await page.goto('/l/not-a-listing');
  await expect(
    page.getByText(/Loading listing…|Listing not found|Couldn't load this listing/),
  ).toBeVisible();

  await page.goto('/me/purchases');
  await expect(page.getByText('Connect a wallet to see purchases.')).toBeVisible();
  await expect(page.getByTestId('connect')).toBeVisible();
});
