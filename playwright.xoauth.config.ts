import { defineConfig, devices } from '@playwright/test';

// Real-API browser flows (X OAuth, studio overview, status page) through the real web /api/v1 proxy, with X's
// API mocked (e2e/x-oauth/mock-x.mjs) and X's authorize page stubbed in the browser.
// Needs Postgres (DATABASE_URL). Run: pnpm exec playwright test -c playwright.xoauth.config.ts

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
// Ports avoid the main e2e (3000) and local API (8787); override with XO_*_PORT.
const WEB_PORT = process.env.XO_WEB_PORT ?? '3317';
const API_PORT = process.env.XO_API_PORT ?? '8817';
const X_PORT = process.env.XO_X_PORT ?? '8818';
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const X_ENV = { X_CLIENT_ID: 'e2e-client-1lO0', X_CLIENT_SECRET: 'e2e-secret-1lO0' };

export default defineConfig({
  testDir: './e2e/x-oauth',
  testMatch: '*.flow.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: WEB, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/x-oauth/mock-x.mjs',
      url: `http://127.0.0.1:${X_PORT}/health`,
      reuseExistingServer: false,
      env: { ...process.env, ...X_ENV, MOCK_X_PORT: X_PORT },
    },
    {
      command: 'pnpm --filter @trenchmart/db migrate && pnpm --filter @trenchmart/api start',
      url: `${API}/api/v1/config/public`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        ...X_ENV,
        DATABASE_URL,
        PORT: API_PORT,
        SOLANA_CLUSTER: 'devnet',
        APP_URL: WEB,
        API_URL: API,
        SIWS_DOMAIN: `127.0.0.1:${WEB_PORT}`,
        SESSION_SECRET: 'e2e-session-secret-e2e-session-secret',
        RATE_LIMIT_PER_MIN: '1000',
        SOL_USD_OVERRIDE: '100',
        // status-probes.flow.ts calls POST /internal/status/run with it.
        INTERNAL_TOKEN:
          process.env.XO_INTERNAL_TOKEN ?? 'e2e-internal-token-e2e-internal-token-0001',
        X_API_URL: `http://127.0.0.1:${X_PORT}`,
      },
    },
    {
      command: `pnpm --filter @trenchmart/web exec next dev -H 127.0.0.1 -p ${WEB_PORT} ${process.env.XO_NEXT_DEV_FLAGS ?? ''}`,
      url: `${WEB}/`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { ...process.env, API_URL: API, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
