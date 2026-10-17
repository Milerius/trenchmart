/**
 * Backpack extension: import a throwaway key, point Solana at devnet, connect and sign in.
 *
 *   WALLET_LIVE=1 BACKPACK_EXT_DIR=/path/to/backpack/unpacked \
 *   E2E_BACKPACK_KEYPAIR=~/.config/trenchmart/e2e/wallet-backpack.json \
 *   xvfb-run -a pnpm exec playwright test -c playwright.wallets.config.ts backpack
 */
import { expect } from '@playwright/test';
import {
  liveWalletTest,
  password,
  publicKeyOf,
  secretKey,
  visible,
  waitForPage,
  type WalletDriver,
} from './live-wallets';

const KEYPAIR = ['E2E_BACKPACK_KEYPAIR', '~/.config/trenchmart/e2e/wallet-backpack.json'] as const;
const DEVNET_RPC = process.env.E2E_RPC_URL ?? 'https://api.devnet.solana.com';

const backpack: WalletDriver = {
  name: 'backpack',
  standardName: 'Backpack',
  async onboard(ctx, extId, shot) {
    const page =
      (await waitForPage(ctx, (url) => url.includes('/onboarding.html'))) ?? (await ctx.newPage());
    if (!page.url().includes('/onboarding.html'))
      await page.goto(`chrome-extension://${extId}/onboarding.html`);
    await page.getByTestId('terms-of-service-checkbox').waitFor({ timeout: 30_000 });
    await shot(page, 'backpack-onboarding');
    await page.getByTestId('terms-of-service-checkbox').click();
    await page.getByText('I already have a wallet').click();
    await visible(page, 'text="Solana"').click();
    await visible(page, 'text="Private key"').click();
    const keyInput = page.getByTestId('private-key-input');
    await keyInput.waitFor();
    await page.waitForTimeout(1000); // let the slide-in finish before the screenshot
    await shot(page, 'backpack-private-key-form-empty');
    // Backpack shows the key in clear text: no screenshot until the next screen.
    await keyInput.fill(secretKey(...KEYPAIR));
    await page.waitForTimeout(1000);
    await visible(page, 'text="Import"').click();
    await page.getByTestId('password-input').waitFor();
    await page.waitForTimeout(1000);
    await page.getByTestId('password-input').fill(password());
    await page.getByTestId('password-confirm-input').fill(password());
    await shot(page, 'backpack-password');
    await visible(page, 'text="Next"').click();
    await expect(page.getByText("You're all good!")).toBeVisible({ timeout: 45_000 });
    await shot(page, 'backpack-imported');
  },
  async useDevnet(ctx, extId, shot) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 400, height: 640 });
    await page.goto(`chrome-extension://${extId}/popup.html`);
    await visible(page, 'text="🎒"').click({ timeout: 30_000 });
    await visible(page, 'text="Settings"').click();
    await visible(page, 'text="My Account"').waitFor();
    // The home screen stays in the DOM under the settings stack; its token row also says Solana.
    await page.locator('text="Solana"').filter({ visible: true }).last().click();
    await visible(page, 'text="RPC Connection"').click();
    await visible(page, 'text="Custom"').click();
    await page.getByPlaceholder('RPC URL').fill(DEVNET_RPC);
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(visible(page, 'text="Custom"')).toBeVisible();
    await shot(page, 'backpack-devnet-rpc');
    await page.close();
    return `Solana RPC set to ${DEVNET_RPC} (Backpack has no network toggle, only a custom RPC)`;
  },
  async approve(popup) {
    const request = popup
      .getByText(/would like to connect|Sign In with Solana|Sign Message/i)
      .first();
    await request.waitFor({ timeout: 30_000 });
    const kind = /would like to connect/i.test((await request.textContent()) ?? '')
      ? 'connect'
      : 'sign-in';
    await visible(popup, 'text="Approve"').click();
    return kind;
  },
};

liveWalletTest(backpack, { extDirEnv: 'BACKPACK_EXT_DIR', address: () => publicKeyOf(...KEYPAIR) });
