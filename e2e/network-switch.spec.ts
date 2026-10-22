import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, expectNoOverlap, expectSingleLine } from './layout-helpers';
import { installMockWallet, MockAuth } from './wallet-mock';

/**
 * Devnet | Mainnet network switch (docs/ops/networks.md): segmented pill left of the wallet
 * button, lazy menu, mainnet "Coming soon" until launch, and the amber wallet-cluster banner.
 */

const WALLET = 'AaoUxqv5mKkqNfuN2rRdx3xF4nJcTq2wJqzGqVjsRfiX';
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1024, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

async function signIn(page: Page, chains?: string[]) {
  const auth = new MockAuth();
  await auth.install(page.context());
  if (chains)
    await page
      .context()
      .addInitScript(
        (c) => sessionStorage.setItem('mock-wallet-chains', c),
        JSON.stringify(chains),
      );
  await page.context().addInitScript(installMockWallet, WALLET);
  await page.goto('/');
  await page.getByTestId('connect').click();
  await page.getByTestId('wallet-option-phantom').click();
  await expect(page.getByTestId('connect-modal')).toHaveCount(0);
  await expect(page.getByTestId('tier-pill')).toHaveCount(1);
}

test('pill sits left of the wallet button; menu is lazy; mainnet is coming soon', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const pill = page.getByTestId('network-pill');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('data-cluster', 'devnet');
  await expect(pill).toContainText('Devnet');
  await expect(pill).toContainText('Mainnet');
  await expect(page.getByTestId('network-pill-mainnet')).toHaveAttribute('data-launched', '0');
  const pillBox = (await pill.boundingBox())!;
  const walletBox = (await page.getByTestId('connect').boundingBox())!;
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(walletBox.x);
  expect(
    Math.abs(pillBox.y + pillBox.height / 2 - (walletBox.y + walletBox.height / 2)),
  ).toBeLessThan(4);

  // Server-rendered <details>: the menu ships as HTML (no client JS) and stays closed until clicked.
  const menu = page.getByTestId('network-menu').first();
  await expect(menu).toBeHidden();
  await pill.click();
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('network-switch')).toHaveAttribute('open', '');
  const mainnet = menu.getByTestId('network-option-mainnet');
  await expect(mainnet).toHaveAttribute('aria-disabled', 'true');
  await expect(mainnet).not.toHaveAttribute('href');
  await expect(mainnet.getByTestId('network-coming-soon')).toHaveText('Coming soon');
  await expect(menu.getByTestId('network-option-devnet')).toContainText('devnet.trenchmart.fun');
  await expect(menu.getByTestId('network-option-devnet')).toHaveAttribute('aria-current', 'true');
  await mainnet.click({ force: true });
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await pill.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(10, 600);
  await expect(menu).toBeHidden();
});

for (const size of WIDTHS) {
  test(`network pill stays single-line, no overflow or overlap at ${size.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page);
    const nav = page.getByTestId('nav');
    await expectNoHorizontalOverflow(nav, 'header');
    await expectNoHorizontalOverflow(nav.locator('> div').first(), 'header row');
    let pill = nav.getByTestId('network-pill');
    if (size.width < 640) {
      // No room next to logo + wallet + menu: the pill is the first row of the mobile menu.
      await expect(pill).toBeHidden();
      await nav.getByTestId('menu-toggle').click();
      pill = nav.getByTestId('network-pill-menu');
    }
    await expect(pill).toBeVisible();
    await expectSingleLine(pill, 'network-pill');
    await expectNoOverlap([
      { label: 'logo', locator: nav.getByRole('link', { name: 'TrenchMart home' }) },
      { label: 'sell', locator: nav.getByRole('link', { name: 'Sell', exact: true }) },
      { label: 'tier-pill', locator: nav.getByTestId('tier-pill') },
      { label: 'network-pill', locator: nav.getByTestId('network-pill') },
      { label: 'wallet', locator: nav.getByTestId('connect') },
      { label: 'menu', locator: nav.getByTestId('menu-toggle') },
    ]);
    // Both segments from xl; between sm and xl only the active one.
    const mainnetSegment = nav.getByTestId('network-pill-mainnet');
    if (size.width >= 1280) await expect(mainnetSegment).toBeVisible();
    else await expect(mainnetSegment).toBeHidden();
    await pill.click();
    const menu = pill.locator('xpath=..').getByTestId('network-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('network-option-mainnet')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    await expectNoHorizontalOverflow(nav, 'header with menu open');
  });
}

test('wallet on another cluster: amber banner, payments blocked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ['solana:mainnet']);
  const banner = page.getByTestId('cluster-mismatch');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('not on Solana Devnet');
  await expect(banner).toContainText('Payments are blocked');
});

test('wallet on devnet: no mismatch banner', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await expect(page.getByTestId('cluster-mismatch')).toBeHidden();
});
