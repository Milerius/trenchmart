import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = ['/', '/sell', '/token', '/search', '/creators', '/studio', '/me/purchases'] as const;

for (const path of pages) {
  test(`${path} renders and has no serious axe violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId('nav')).toBeVisible();
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
  await expect(page.getByTestId('search')).toBeVisible();

  await page.goto('/l/not-a-listing');
  await expect(page.getByText('Loading listing…')).toBeVisible();

  await page.goto('/me/purchases');
  await expect(page.getByText('Connect a wallet to see purchases.')).toBeVisible();
  await expect(page.getByTestId('connect')).toBeVisible();
});
