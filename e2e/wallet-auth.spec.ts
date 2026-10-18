import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Wallet connect vs. session sign-in, end to end, with a Wallet Standard mock wallet and a
 * stateful mock of the auth API (challenge → verify → session cookie → refresh → logout).
 */

const A = 'AaoUxqv5mKkqNfuN2rRdx3xF4nJcTq2wJqzGqVjsRfiX';
const B = 'BbsW8MCvHE7S9mbGqDhVQ5GzQoV1gHWVu1J4c9bsWxyz';
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

type MockWalletControl = {
  switchTo(address: string | null): void;
  reject: boolean;
  signDelayMs: number;
  signCount: number;
};

declare global {
  interface Window {
    __mockWallet: MockWalletControl;
  }
}

/** A Wallet Standard wallet: connect (silent once trusted), events, signMessage, disconnect. */
function installMockWallet(initial: string) {
  const trusted = () => sessionStorage.getItem('mock-wallet-trusted') === '1';
  const accountFor = (address: string) => ({
    address,
    publicKey: new Uint8Array(32),
    chains: ['solana:devnet'],
    features: ['solana:signMessage', 'solana:signTransaction'],
  });
  let active = accountFor(sessionStorage.getItem('mock-wallet-address') ?? initial);
  const listeners = new Set<(props: { accounts: unknown[] }) => void>();
  const control = {
    reject: false,
    signDelayMs: 0,
    signCount: 0,
    switchTo(address: string | null) {
      if (address) {
        active = accountFor(address);
        sessionStorage.setItem('mock-wallet-address', address);
      }
      wallet.accounts = address ? [active] : [];
      for (const listener of listeners) listener({ accounts: wallet.accounts });
    },
  };
  const wallet = {
    version: '1.0.0',
    name: 'Phantom',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    chains: ['solana:devnet'],
    accounts: [] as ReturnType<typeof accountFor>[],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async (input?: { silent?: boolean }) => {
          if (input?.silent && !trusted()) return { accounts: [] };
          sessionStorage.setItem('mock-wallet-trusted', '1');
          wallet.accounts = [active];
          return { accounts: wallet.accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          sessionStorage.removeItem('mock-wallet-trusted');
          wallet.accounts = [];
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (_event: string, listener: (props: { accounts: unknown[] }) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs: { message: Uint8Array }[]) => {
          control.signCount += 1;
          await new Promise((r) => setTimeout(r, control.signDelayMs));
          if (control.reject)
            throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          return inputs.map((input) => ({
            signedMessage: input.message,
            signature: new Uint8Array(64).fill(7),
          }));
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy'],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          inputs.map((input) => ({ signedTransaction: input.transaction })),
      },
    },
  };
  (window as unknown as { __mockWallet: typeof control }).__mockWallet = control;
  window.addEventListener('wallet-standard:app-ready', (event) => {
    (event as CustomEvent<{ register: (w: unknown) => void }>).detail.register(wallet);
  });
}

/** The API's auth surface, shared by every tab in the context (like one cookie jar). */
class MockAuth {
  wallet: string | null = null;
  expired = false;
  meDelayMs = 0;
  calls = { nonce: 0, verify: 0, logout: 0, refresh: 0, me: 0 };
  refreshAfter = '2999-01-01T00:00:00.000Z';

  async install(context: BrowserContext) {
    const json = (body: unknown, status = 200) => ({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    const user = () => ({
      id: `user-${this.wallet}`,
      wallet: this.wallet,
      handle: null,
      roles: ['buyer'],
    });
    const session = () => ({
      expiresAt: '2999-02-01T00:00:00.000Z',
      refreshAfter: this.refreshAfter,
    });
    await context.route('**/api/v1/me', async (route) => {
      this.calls.me += 1;
      if (this.meDelayMs) await new Promise((r) => setTimeout(r, this.meDelayMs));
      if (!this.wallet || this.expired)
        return route.fulfill(
          json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401),
        );
      return route.fulfill(json({ user: user(), tier: 'none', session: session() }));
    });
    await context.route('**/api/v1/auth/nonce', (route) => {
      this.calls.nonce += 1;
      const { wallet } = JSON.parse(route.request().postData() ?? '{}') as { wallet: string };
      return route.fulfill(
        json({ nonce: 'n', message: `trenchmart.fun wants you to sign in:\n${wallet}` }),
      );
    });
    await context.route('**/api/v1/auth/verify', (route) => {
      this.calls.verify += 1;
      const { wallet } = JSON.parse(route.request().postData() ?? '{}') as { wallet: string };
      this.wallet = wallet;
      this.expired = false;
      return route.fulfill(json({ user: user(), session: session() }));
    });
    await context.route('**/api/v1/auth/refresh', (route) => {
      this.calls.refresh += 1;
      return route.fulfill(json({ user: user(), session: session() }));
    });
    await context.route('**/api/v1/auth/logout', (route) => {
      this.calls.logout += 1;
      this.wallet = null;
      return route.fulfill({ status: 204, body: '' });
    });
  }
}

async function setup(context: BrowserContext, page: Page, address = A) {
  const auth = new MockAuth();
  await auth.install(context);
  await context.addInitScript(installMockWallet, address);
  await page.goto('/');
  return auth;
}

const button = (page: Page) => page.getByTestId('connect');

async function connectAndSign(page: Page) {
  await button(page).click();
  await page.getByTestId('wallet-option-phantom').click();
  await expect(page.getByTestId('connect-modal')).toHaveCount(0);
}

async function signCount(page: Page) {
  return page.evaluate(() => window.__mockWallet.signCount);
}

test('connect then sign once: wallet connected and signed in are distinct states', async ({
  context,
  page,
}) => {
  const auth = await setup(context, page);
  await expect(button(page)).toHaveText('Connect wallet');
  await expect(button(page)).toHaveAttribute('data-auth', 'signed-out');
  await page.evaluate(() => (window.__mockWallet.signDelayMs = 400));
  await button(page).click();
  await page.getByTestId('wallet-option-phantom').click();
  await expect(button(page)).toHaveText('Sign in your wallet…');
  await expect(button(page)).toHaveText(short(A));
  await expect(button(page)).toHaveAttribute('data-auth', 'signed-in');
  expect(auth.calls.verify).toBe(1);
  expect(await signCount(page)).toBe(1);
  await page.screenshot({ path: 'test-results/wallet-auth/01-signed-in.png' });
});

test('reload restores the session instantly without a new signature', async ({ context, page }) => {
  const auth = await setup(context, page);
  await connectAndSign(page);
  await expect(button(page)).toHaveText(short(A));
  auth.meDelayMs = 1500;
  await page.reload();
  // Optimistic: the address is there while /me is still in flight.
  await expect(button(page)).toHaveText(short(A), { timeout: 1000 });
  await expect(button(page)).toHaveAttribute('data-auth', 'restoring');
  await expect(button(page)).toHaveAttribute('data-auth', 'signed-in');
  expect(auth.calls.nonce).toBe(1);
  expect(await signCount(page)).toBe(0);
  // Reconnecting with the same wallet reuses the session: no prompt.
  await page.goto('/studio');
  await expect(button(page)).toHaveText(short(A));
  expect(auth.calls.verify).toBe(1);
});

test('the header button opens a menu and never disconnects on click', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const auth = await setup(context, page);
  await connectAndSign(page);
  await button(page).click();
  const menu = page.getByTestId('wallet-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('menu-address')).toHaveText(A);
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Copy address',
    'Profile',
    'Studio',
    'Purchases',
    'Disconnect',
  ]);
  await page.screenshot({ path: 'test-results/wallet-auth/02-menu.png' });
  await menu.getByTestId('menu-copy').click();
  await expect(menu.getByTestId('menu-copy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(A);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  for (let i = 0; i < 4; i += 1) await button(page).click();
  await expect(button(page)).toHaveText(short(A));
  await page.mouse.click(10, 400);
  await expect(menu).toHaveCount(0);
  expect(auth.calls.logout).toBe(0);
  await button(page).click();
  await page.getByTestId('menu-studio').click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(button(page)).toHaveText(short(A));
});

test('an account switch in the wallet is shown, never silently signed', async ({
  context,
  page,
}) => {
  const auth = await setup(context, page);
  await connectAndSign(page);
  await page.evaluate((b) => window.__mockWallet.switchTo(b), B);
  await expect(page.getByTestId('auth-dot')).toHaveClass(/bg-warn/);
  await button(page).click();
  await expect(page.getByTestId('wallet-mismatch')).toContainText(short(B));
  await page.screenshot({ path: 'test-results/wallet-auth/03-account-switch.png' });
  expect(await signCount(page)).toBe(1);
  await page.getByTestId('menu-switch').click();
  await expect(button(page)).toHaveText(short(B));
  expect(auth.calls.verify).toBe(2);
  expect(auth.wallet).toBe(B);
  await expect(page.getByTestId('auth-dot')).not.toHaveClass(/bg-warn/);
});

test('a stale session for another wallet is flagged after reload', async ({ context, page }) => {
  const auth = await setup(context, page);
  await connectAndSign(page);
  await page.evaluate((b) => sessionStorage.setItem('mock-wallet-address', b), B);
  await page.reload();
  await expect(button(page)).toHaveText(short(A));
  await expect(page.getByTestId('auth-dot')).toHaveClass(/bg-warn/);
  expect(await signCount(page)).toBe(0);
  expect(auth.calls.verify).toBe(1);
});

test('a rejected signature leaves the wallet connected and retries in one click', async ({
  context,
  page,
}) => {
  const auth = await setup(context, page);
  await page.evaluate(() => (window.__mockWallet.reject = true));
  await button(page).click();
  await page.getByTestId('wallet-option-phantom').click();
  await expect(page.getByTestId('connect-modal')).toContainText('You declined the sign-in request');
  await page.keyboard.press('Escape');
  await expect(button(page)).toHaveText('Sign in');
  await expect(button(page)).toHaveAttribute('data-auth', 'wallet-connected');
  await expect(page.getByTestId('toast')).toContainText('declined');
  await page.screenshot({ path: 'test-results/wallet-auth/04-rejected.png' });
  expect(auth.calls.verify).toBe(0);
  await page.evaluate(() => {
    window.__mockWallet.reject = false;
    window.__mockWallet.signDelayMs = 300;
  });
  await button(page).dblclick();
  await expect(button(page)).toHaveText(short(A));
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await signCount(page)).toBe(2);
  expect(auth.calls.verify).toBe(1);
});

test('an expired session signs out with a clear message', async ({ context, page }) => {
  const auth = await setup(context, page);
  await connectAndSign(page);
  auth.expired = true;
  await page.reload();
  await expect(button(page)).not.toHaveText(short(A));
  await expect(page.getByTestId('toast')).toContainText('session expired');
  await page.screenshot({ path: 'test-results/wallet-auth/05-expired.png' });
  // The wallet is still trusted, so one click signs again without the picker.
  await expect(button(page)).toHaveText(/Sign in|Connect wallet/);
  await button(page).click();
  if (await page.getByTestId('connect-modal').isVisible())
    await page.getByTestId('wallet-option-phantom').click();
  await expect(button(page)).toHaveText(short(A));
  expect(auth.calls.verify).toBe(2);
});

test('a session older than a day is refreshed without a signature', async ({ context, page }) => {
  const auth = await setup(context, page);
  auth.refreshAfter = '2000-01-01T00:00:00.000Z';
  await connectAndSign(page);
  await page.reload();
  await expect(button(page)).toHaveAttribute('data-auth', 'signed-in');
  await expect.poll(() => auth.calls.refresh).toBeGreaterThan(0);
  expect(await signCount(page)).toBe(0);
});

test('disconnect logs out, survives reload, and follows across tabs', async ({ context, page }) => {
  const auth = await setup(context, page);
  await connectAndSign(page);
  const other = await context.newPage();
  await other.goto('/');
  await expect(button(other)).toHaveText(short(A));
  await button(page).click();
  await page.getByTestId('menu-disconnect').click();
  await expect(button(page)).toHaveText('Connect wallet');
  expect(auth.calls.logout).toBe(1);
  await expect(button(other)).toHaveText('Connect wallet');
  await page.reload();
  await expect(button(page)).toHaveText('Connect wallet');
  expect(await page.evaluate(() => localStorage.getItem('tm.session'))).toBeNull();
  // Signing in again in one tab signs in the other too.
  await connectAndSign(page);
  await expect(button(other)).toHaveText(short(A));
});
