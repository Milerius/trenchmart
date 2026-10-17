/**
 * Trust Wallet extension: import a throwaway key, connect and sign in on the live site.
 *
 *   WALLET_LIVE=1 TRUST_EXT_DIR=/path/to/trust/unpacked \
 *   E2E_TRUST_KEYPAIR=~/.config/trenchmart/e2e/wallet-trust.json \
 *   xvfb-run -a pnpm exec playwright test -c playwright.wallets.config.ts trust
 *
 * Trust has no Solana devnet mode; signing in does not touch the chain, so it runs on its
 * default network.
 */
import { expect, type Page } from '@playwright/test';
import {
  liveWalletTest,
  password,
  publicKeyOf,
  secretKey,
  waitForPage,
  type WalletDriver,
} from './live-wallets';

const KEYPAIR = ['E2E_TRUST_KEYPAIR', '~/.config/trenchmart/e2e/wallet-trust.json'] as const;

async function dismissEmptyWalletNotice(page: Page) {
  if (
    !(await page
      .getByText('You imported an empty wallet')
      .isVisible()
      .catch(() => false))
  )
    return;
  for (const box of await page.locator('input[type=checkbox]').all())
    await box.check({ force: true });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
}

const trust: WalletDriver = {
  name: 'trust',
  standardName: 'Trust',
  async onboard(ctx, extId, shot) {
    const page =
      (await waitForPage(ctx, (url) => url.includes('#/onboarding'))) ?? (await ctx.newPage());
    if (!page.url().includes('#/onboarding'))
      await page.goto(`chrome-extension://${extId}/home.html#/onboarding`);
    await page.getByText('I already have a wallet').waitFor();
    await shot(page, 'trust-onboarding');
    await page.locator('input[type=checkbox]').first().check({ force: true });
    await page.getByText('I already have a wallet').click();
    await page.getByRole('button', { name: 'Password', exact: true }).click();
    await page.getByTestId('password-field').nth(0).fill(password());
    await page.getByTestId('password-field').nth(1).fill(password());
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Other mobile wallet or extension').click();
    await page.getByTestId('wallet-name-input').fill('e2e-trust');
    // Trust masks the key field.
    await page.locator('textarea').fill(secretKey(...KEYPAIR));
    await page.getByRole('button', { name: 'Select Network' }).click();
    await page.getByText('Solana', { exact: true }).click();
    await shot(page, 'trust-key-entered-masked');
    await page.getByTestId('import-wallet-submit').click();
    await expect(page.getByText('your wallet is ready')).toBeVisible({ timeout: 45_000 });
    await shot(page, 'trust-imported');
  },
  async useDevnet(ctx, extId, shot) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 400, height: 640 });
    await page.goto(`chrome-extension://${extId}/popup.html`);
    await page.getByTestId('wallet-header-settings-button').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await dismissEmptyWalletNotice(page);
    await shot(page, 'trust-home-solana-mainnet-only');
    await page.close();
    return 'Trust Wallet has no Solana devnet/testnet mode (Developer settings only list faucets); sign-in is off-chain';
  },
  async approve(popup) {
    const request = popup
      .getByText(/Connect to Trust Wallet|Sign-in request|Sign message/i)
      .first();
    await request.waitFor({ timeout: 30_000 });
    await dismissEmptyWalletNotice(popup);
    const connect = popup.getByRole('button', { name: 'Connect', exact: true });
    if (await connect.isVisible()) {
      await connect.click();
      await connect.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
      return 'connect';
    }
    const confirm = popup.getByRole('button', { name: 'Confirm', exact: true });
    await confirm.click();
    await confirm.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
    return 'sign-in';
  },
};

liveWalletTest(trust, { extDirEnv: 'TRUST_EXT_DIR', address: () => publicKeyOf(...KEYPAIR) });
