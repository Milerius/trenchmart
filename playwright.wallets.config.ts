import { defineConfig } from '@playwright/test';

// Live suite: real Trust, Backpack and Solflare extensions against a deployed site.
// See e2e/live-wallets.ts. Skipped unless WALLET_LIVE=1.
export default defineConfig({
  testDir: './e2e',
  testMatch: /(trust|backpack|solflare)-live\.spec\.ts/,
  workers: 1,
  retries: 0,
  use: { actionTimeout: 30_000, navigationTimeout: 60_000 },
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/wallets-live' }]],
});
