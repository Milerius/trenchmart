import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectLegible,
  expectNoHorizontalOverflow,
  expectNoOverlap,
  expectSingleLine,
} from './layout-helpers';
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
  { width: 1152, height: 800 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

/** Minimum on-screen width per control: anything narrower is not a usable target. */
function minWidth(label: string) {
  if (label === 'search') return 40; // icon button below 2xl-ish; the input itself needs 160
  if (label === 'sell') return 64;
  if (label === 'wallet') return 96;
  if (label.startsWith('icon:') || label === 'menu') return 36;
  if (label === 'logo') return 32;
  return 48;
}

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
  // Whichever form the search takes at this width: the full input or the icon button.
  items.push({
    label: 'search',
    locator: nav.locator('[data-testid=header-search]:visible, form[role=search]:visible').first(),
  });
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
    // Every visible control is fully legible: wide enough, text unclipped, no text painted
    // onto a neighbour (the "/" search hint merging into "Sell"), search input ≥160 px.
    for (const { label, locator } of items) {
      if (!(await locator.isVisible())) continue;
      await expectLegible(locator, label, {
        minWidth: minWidth(label),
        others: items.filter((o) => o.label !== label).map((o) => o.locator),
      });
    }

    // Priority plan: the extras join only once there is room for them.
    const pill = page.getByTestId('tier-pill');
    if (size.width >= 1536) {
      await expect(pill).toBeVisible();
      await expect(pill).toHaveText('5% fee');
    } else await expect(pill).toBeHidden();
    const wide = size.width >= 1440;
    await expect(page.getByTestId('social-header')).toBeVisible({ visible: wide });
    await expect(page.getByTestId('network-pill-mainnet')).toBeVisible({ visible: wide });
    await expect(page.getByTestId('search')).toBeVisible({ visible: wide });
    await expect(page.getByTestId('header-search')).toBeVisible({
      visible: !wide && size.width >= 640,
    });

    // Below 1440 the icon (or "/") opens the search as a panel: a full, legible input.
    if (!wide && size.width >= 640) {
      await page.locator('body').click({ position: { x: 5, y: 600 } });
      await page.keyboard.press('/');
      const input = page.getByTestId('search');
      await expect(input).toBeFocused();
      await expectLegible(
        page.getByTestId('nav').locator('form[role=search]').first(),
        'search panel',
      );
      await expectNoHorizontalOverflow(page.getByTestId('nav'), 'header with search open');
      await page.keyboard.press('Escape');
      await expect(input).toBeHidden();
      await page.getByTestId('header-search').click();
      await expect(input).toBeFocused();
    }
  });
}
