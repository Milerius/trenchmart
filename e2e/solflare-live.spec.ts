/**
 * Solflare extension: restore a throwaway recovery phrase, switch to Devnet, connect and sign in.
 * Solflare's onboarding only imports a recovery phrase, so the throwaway key is a fresh 12-word
 * phrase and its m/44'/501'/0'/0' keypair (for the expected address).
 *
 *   WALLET_LIVE=1 SOLFLARE_EXT_DIR=/path/to/solflare/unpacked \
 *   E2E_SOLFLARE_MNEMONIC=~/.config/trenchmart/e2e/wallet-solflare.mnemonic \
 *   E2E_SOLFLARE_KEYPAIR=~/.config/trenchmart/e2e/wallet-solflare.json \
 *   xvfb-run -a pnpm exec playwright test -c playwright.wallets.config.ts solflare
 */
import { expect } from '@playwright/test';
import {
  liveWalletTest,
  password,
  publicKeyOf,
  readText,
  waitForPage,
  type WalletDriver,
} from './live-wallets';

const MNEMONIC = [
  'E2E_SOLFLARE_MNEMONIC',
  '~/.config/trenchmart/e2e/wallet-solflare.mnemonic',
] as const;
const KEYPAIR = ['E2E_SOLFLARE_KEYPAIR', '~/.config/trenchmart/e2e/wallet-solflare.json'] as const;

const solflare: WalletDriver = {
  name: 'solflare',
  standardName: 'Solflare',
  async onboard(ctx, extId, shot) {
    const page =
      (await waitForPage(ctx, (url) => url.includes('#/onboard'))) ?? (await ctx.newPage());
    if (!page.url().includes('#/onboard'))
      await page.goto(`chrome-extension://${extId}/wallet.html#/onboard`);
    await page.getByTestId('btn-import-existing-wallet').click({ timeout: 30_000 });
    await shot(page, 'solflare-import-options');
    await page.getByText('Recovery phrase', { exact: true }).click();
    const words = readText(...MNEMONIC).split(/\s+/);
    if (words.length === 24) await page.getByText('24', { exact: true }).click();
    // The phrase is shown in clear text: no screenshot until the next screen.
    for (const [i, word] of words.entries())
      await page.getByTestId(`input-recovery-phrase-${i + 1}`).fill(word);
    await page.getByText('Continue', { exact: true }).click();
    await page.getByTestId('input-new-password').fill(password());
    await page.getByTestId('input-repeat-password').fill(password());
    await shot(page, 'solflare-password');
    await page.getByTestId('btn-continue').click();
    const quick = page.getByTestId('btn-quick-setup');
    const done = page.getByTestId('btn-explore');
    await expect(quick.or(done)).toBeVisible({ timeout: 45_000 });
    if (await quick.isVisible()) await quick.click();
    await shot(page, 'solflare-imported');
    await done.click();
    await page.getByTestId('nav-item-settings').waitFor({ timeout: 30_000 });
  },
  async useDevnet(ctx, extId, shot) {
    const page =
      ctx.pages().find((p) => p.url().includes(`${extId}/wallet.html`)) ?? (await ctx.newPage());
    if (!page.url().includes('/wallet.html'))
      await page.goto(`chrome-extension://${extId}/wallet.html#/portfolio`);
    await page.getByTestId('nav-item-settings').click();
    await page.getByText('Mainnet', { exact: true }).click();
    await page.getByText('Devnet', { exact: true }).click();
    await page.getByText('Continue', { exact: true }).click();
    await expect(page.getByText('Connected to Devnet')).toBeVisible();
    await shot(page, 'solflare-devnet');
    return null;
  },
  async approve(popup) {
    const connect = popup.getByTestId('btn-connect');
    const approve = popup.getByTestId('btn-approve');
    await expect(connect.or(approve)).toBeVisible({ timeout: 30_000 });
    if (await connect.isVisible()) {
      await connect.click();
      return 'connect';
    }
    await approve.click();
    return 'sign-in';
  },
};

liveWalletTest(solflare, { extDirEnv: 'SOLFLARE_EXT_DIR', address: () => publicKeyOf(...KEYPAIR) });
