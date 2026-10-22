import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoOverlap, expectSingleLine } from './layout-helpers';
import { installMockWallet, MockAuth } from './wallet-mock';

/**
 * The desktop header with a signed-in wallet: nav links, GitHub/X icon links, the tier/fee pill
 * and the wallet button each stay on one line, never overlap and never push the header wider
 * than the viewport, from phone to wide desktop.
 */

const WALLET = 'AaoUxqv5mKkqNfuN2rRdx3xF4nJcTq2wJqzGqVjsRfiX';
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1024, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

async function signIn(page: Page) {
  const auth = new MockAuth();
  await auth.install(page.context());
  await page.context().addInitScript(installMockWallet, WALLET);
  await page.goto('/');
  await page.getByTestId('connect').click();
  await page.getByTestId('wallet-option-phantom').click();
  await expect(page.getByTestId('connect-modal')).toHaveCount(0);
  await expect(page.getByTestId('tier-pill')).toHaveCount(1);
}

async function headerItems(page: Page) {
  const nav = page.getByTestId('nav');
  const items: { label: string; locator: Locator }[] = [
    { label: 'logo', locator: nav.getByRole('link', { name: 'TrenchMart home' }) },
  ];
  const primary = nav.getByRole('navigation', { name: 'Primary' }).getByRole('link');
  for (let i = 0; i < (await primary.count()); i++)
    items.push({ label: `nav:${await primary.nth(i).innerText()}`, locator: primary.nth(i) });
  items.push({ label: 'search', locator: nav.locator('form[role=search]').first() });
  items.push({ label: 'sell', locator: nav.getByRole('link', { name: 'Sell', exact: true }) });
  const social = nav.getByTestId('social-header').locator('a');
  for (let i = 0; i < (await social.count()); i++)
    items.push({
      label: `icon:${await social.nth(i).getAttribute('aria-label')}`,
      locator: social.nth(i),
    });
  items.push({ label: 'tier-pill', locator: nav.getByTestId('tier-pill') });
  items.push({ label: 'network-pill', locator: nav.getByTestId('network-pill') });
  items.push({ label: 'wallet', locator: nav.getByTestId('connect') });
  items.push({ label: 'menu', locator: nav.getByTestId('menu-toggle') });
  return items;
}

for (const size of WIDTHS) {
  test(`header items stay single-line without overflow or overlap at ${size.width}px (signed in)`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page);
    const items = await headerItems(page);
    const textual = ['nav:', 'sell', 'tier-pill', 'network-pill', 'wallet'];
    for (const { label, locator } of items)
      if (textual.some((t) => label.startsWith(t)) && (await locator.isVisible()))
        await expectSingleLine(locator, label);
    await expectNoHorizontalOverflow(page.getByTestId('nav'), 'header');
    await expectNoHorizontalOverflow(
      page.getByTestId('nav').locator('> div').first(),
      'header row',
    );
    await expectNoOverlap(items);

    const pill = page.getByTestId('tier-pill');
    if (size.width >= 1280) {
      // The pill is on screen from xl; full or short, it always names the fee.
      await expect(pill).toBeVisible();
      await expect(pill).toContainText('5% fee');
      await expect(page.getByTestId('social-header')).toBeVisible();
    } else {
      await expect(pill).toBeHidden();
    }
  });
}
