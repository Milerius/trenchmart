import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

// Internal status dashboard (/admin/status) over GET /admin/ops. /api/v1 is stubbed.
const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (b: Uint8Array) => string };

const STATUS = {
  checkedAt: '2026-10-18T02:40:00.000Z',
  ok: false,
  alerts: [
    {
      level: 'critical',
      code: 'LOW_BALANCE',
      message: 'fee payer (crank) HSGh holds 0.01 SOL; top it up',
    },
  ],
  history: [
    {
      code: 'LOW_BALANCE',
      level: 'critical',
      message: 'x',
      first_at: '2026-10-18T02:35:00.000Z',
      last_at: '2026-10-18T02:40:00.000Z',
      notified_at: '2026-10-18T02:35:00.000Z',
      resolved_at: null,
    },
    {
      code: 'RPC_DOWN',
      level: 'critical',
      message: 'x',
      first_at: '2026-10-17T02:35:00.000Z',
      last_at: '2026-10-17T02:40:00.000Z',
      notified_at: '2026-10-17T02:35:00.000Z',
      resolved_at: '2026-10-17T02:45:00.000Z',
    },
  ],
  events24h: [{ kind: '5xx', n: 3 }],
  channels: { ntfy: true, email: true, telegram: false, webhook: false },
  codes: ['DB_ERROR', 'LOW_BALANCE', 'RPC_DOWN'],
};

async function stub(page: Page, roles: string[]) {
  const pair = nacl.sign.keyPair();
  await page.addInitScript((value) => {
    (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ = value;
  }, bs58.encode(pair.secretKey));
  const calls: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    calls.push(path);
    if (path === '/me')
      return route.fulfill({
        json: {
          user: { id: 'u1', wallet: bs58.encode(pair.publicKey), handle: 'ops', roles },
          tier: 'none',
        },
      });
    if (path === '/admin/ops') return route.fulfill({ json: STATUS });
    if (path === '/admin/disputes') return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return calls;
}

test('admin status dashboard shows firing alerts, every check, channels, errors and history', async ({
  page,
}) => {
  await stub(page, ['admin']);
  await page.goto('/admin');
  await page.getByTestId('admin-status-link').click();
  await expect(page).toHaveURL('/admin/status');
  await expect(page.getByTestId('ops-overall')).toContainText('Critical alerts firing');
  await expect(page.getByTestId('ops-alerts')).toContainText('CRITICAL LOW_BALANCE');
  await expect(page.getByTestId('ops-checks')).toContainText('✗ LOW_BALANCE');
  await expect(page.getByTestId('ops-checks')).toContainText('✓ DB_ERROR');
  await expect(page.getByTestId('ops-channels')).toContainText('email: on');
  await expect(page.getByTestId('ops-channels')).toContainText('telegram: off');
  await expect(page.getByTestId('ops-events')).toContainText('5xx: 3');
  await expect(page.getByTestId('ops-history')).toContainText('RPC_DOWN');
  await expect(page.getByTestId('ops-history')).toContainText('resolved');
});

test('the status dashboard is admin-only and never calls /admin/ops for other wallets', async ({
  page,
}) => {
  const calls = await stub(page, ['creator']);
  await page.goto('/admin/status');
  await expect(page.getByText('This wallet is not an admin.')).toBeVisible();
  expect(calls).not.toContain('/admin/ops');
});
