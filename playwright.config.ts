import { defineConfig, devices } from '@playwright/test';
import { WALLETCONNECT_PROJECT_ID } from './apps/web/src/lib/walletconnect';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @trenchmart/web dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
        process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || WALLETCONNECT_PROJECT_ID,
    },
  },
});
