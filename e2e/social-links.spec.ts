import { expect, test, type Locator } from '@playwright/test';

const GITHUB = 'https://github.com/Milerius/trenchmart';
const X_URL = 'https://x.com/TrenchmartSI';

async function expectLinks(scope: Locator) {
  const github = scope.getByRole('link', { name: 'TrenchMart on GitHub' });
  const x = scope.getByRole('link', { name: 'TrenchMart on X' });
  for (const [link, href] of [
    [github, GITHUB],
    [x, X_URL],
  ] as const) {
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link.locator('svg')).toHaveCount(1);
  }
}

test('desktop: GitHub and X icon links in the header and footer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expectLinks(page.getByTestId('nav'));
  await expectLinks(page.locator('footer'));
});

test('mobile: links in the open menu and the footer, not in the header bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('social-header')).toBeHidden();
  await page.getByTestId('menu-toggle').click();
  const menu = page.getByTestId('mobile-menu');
  await expectLinks(menu);
  await expect(menu.getByTestId('social-menu')).toContainText('GitHub');
  await expect(menu.getByTestId('social-menu')).toContainText('@TrenchmartSI');
  await page.getByTestId('menu-toggle').click();
  await expectLinks(page.locator('footer'));
});

test('the links are server-rendered (in the first HTML)', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain(`href="${GITHUB}"`);
  expect(html).toContain(`href="${X_URL}"`);
});
