import { defineConfig } from '@playwright/test';

// Live suite: real Phantom extension against a deployed site. See e2e/phantom-live.spec.ts.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'phantom-live.spec.ts',
  workers: 1,
  retries: 0,
  use: { actionTimeout: 30_000, navigationTimeout: 60_000 },
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/phantom-live' }]],
});
