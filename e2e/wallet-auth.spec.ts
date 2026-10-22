import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { installMockWallet, MockAuth } from './wallet-mock';

/**
 * Wallet connect vs. session sign-in, end to end, with a Wallet Standard mock wallet and a
 * stateful mock of the auth API (challenge → verify → session cookie → refresh → logout).
 */

const A = 'AaoUxqv5mKkqNfuN2rRdx3xF4nJcTq2wJqzGqVjsRfiX';
const B = 'BbsW8MCvHE7S9mbGqDhVQ5GzQoV1gHWVu1J4c9bsWxyz';
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * A stricter mock that behaves like the real server: verify sets a tm_session cookie bound
 * to a server-side session id, /me answers only for unrevoked ids, logout revokes the id and
 * logout-all revokes every id of the wallet. One instance is shared by several browsers.
 */
class RevocableAuth {
  sessions = new Map<string, { wallet: string; revoked: boolean }>();
  n = 0;
  verifyCookies: string[] = [];
  logoutAll = 0;

  private sid(cookie: string | undefined) {
    return /tm_session=([^;]+)/.exec(cookie ?? '')?.[1] ?? null;
  }

  async install(context: BrowserContext) {
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
      status,
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    const live = (cookie: string | undefined) => {
      const sid = this.sid(cookie);
      const row = sid ? this.sessions.get(sid) : undefined;
      return row && !row.revoked ? { sid: sid!, ...row } : null;
    };
    const user = (wallet: string) => ({ id: `user-${wallet}`, wallet, handle: null, roles: [] });
    const session = {
      expiresAt: '2999-02-01T00:00:00.000Z',
      refreshAfter: '2999-01-01T00:00:00.000Z',
    };
    const unauthorized = json(
      { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
      401,
    );
    await context.route('**/api/v1/me', async (route) => {
      const s = live((await route.request().headerValue('cookie')) ?? undefined);
      return route.fulfill(
        s ? json({ user: user(s.wallet), tier: 'none', session }) : unauthorized,
      );
    });
    await context.route('**/api/v1/auth/nonce', (route) => {
      const { wallet } = JSON.parse(route.request().postData() ?? '{}') as { wallet: string };
      return route.fulfill(
        json({ nonce: 'n', message: `trenchmart.fun wants you to sign in:\n${wallet}` }),
      );
    });
    await context.route('**/api/v1/auth/verify', async (route) => {
      const cookie = (await route.request().headerValue('cookie')) ?? '';
      this.verifyCookies.push(cookie);
      // Like the API: the session this browser held is revoked when it signs in again.
      const old = this.sid(cookie);
      if (old && this.sessions.has(old)) this.sessions.get(old)!.revoked = true;
      const { wallet } = JSON.parse(route.request().postData() ?? '{}') as { wallet: string };
      const sid = `sid-${(this.n += 1)}`;
      this.sessions.set(sid, { wallet, revoked: false });
      return route.fulfill(
        json({ user: user(wallet), session }, 200, {
          'set-cookie': `tm_session=${sid}; Path=/; HttpOnly; SameSite=Lax`,
        }),
      );
    });
    await context.route('**/api/v1/auth/refresh', async (route) => {
      const s = live((await route.request().headerValue('cookie')) ?? undefined);
      return route.fulfill(s ? json({ user: user(s.wallet), session }) : unauthorized);
    });
    await context.route('**/api/v1/auth/logout-all', async (route) => {
      const s = live((await route.request().headerValue('cookie')) ?? undefined);
      if (!s) return route.fulfill(unauthorized);
      this.logoutAll += 1;
      let revoked = 0;
      for (const row of this.sessions.values())
        if (row.wallet === s.wallet && !row.revoked) {
          row.revoked = true;
          revoked += 1;
        }
      return route.fulfill(
        json({ ok: true, revoked }, 200, { 'set-cookie': 'tm_session=; Path=/; Max-Age=0' }),
      );
    });
    await context.route('**/api/v1/auth/logout', async (route) => {
      const sid = this.sid((await route.request().headerValue('cookie')) ?? undefined);
      if (sid && this.sessions.has(sid)) this.sessions.get(sid)!.revoked = true;
      return route.fulfill({
        status: 204,
        headers: { 'set-cookie': 'tm_session=; Path=/; Max-Age=0' },
        body: '',
      });
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
    'Log out everywhere',
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
  // Steps name the phase if CI ever times out here again (it timed out twice in the dev
  // server with no step named; see the e2e-results artifact for the trace).
  const auth = await setup(context, page);
  await test.step('reject the first signature; Escape closes the picker at once', async () => {
    // Hydrated, with the mock wallet registered, before the first click.
    await expect(button(page)).toHaveAttribute('data-auth', 'signed-out');
    await page.evaluate(() => (window.__mockWallet.reject = true));
    await button(page).click();
    // Press Escape in the same task the decline message is rendered, before React runs its
    // effects: an Escape handler that still saw the old busy state used to ignore it, leaving
    // the picker over the page (CI flake: the retry click below then never landed).
    await page.evaluate(() => {
      (window as unknown as { __escaped: Promise<void> }).__escaped = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const modal = document.querySelector('[data-testid=connect-modal]');
          if (!modal?.textContent?.includes('You declined the sign-in request')) return;
          observer.disconnect();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          resolve();
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      });
    });
    await page.getByTestId('wallet-option-phantom').click();
    await page.evaluate(() => (window as unknown as { __escaped: Promise<void> }).__escaped);
    await expect(page.getByTestId('connect-modal')).toHaveCount(0);
  });
  await test.step('still connected, one click away from signing in', async () => {
    await expect(button(page)).toHaveText('Sign in');
    await expect(button(page)).toHaveAttribute('data-auth', 'wallet-connected');
    await expect(page.getByTestId('toast')).toContainText('declined');
    await page.screenshot({ path: 'test-results/wallet-auth/04-rejected.png' });
    expect(auth.calls.verify).toBe(0);
  });
  await test.step('a double click signs once', async () => {
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

test('log out everywhere from the menu ends the session on every device', async ({ browser }) => {
  const server = new RevocableAuth();
  const devices = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = [];
  for (const context of devices) {
    await server.install(context);
    await context.addInitScript(installMockWallet, A);
    const page = await context.newPage();
    await page.goto('/');
    await connectAndSign(page);
    await expect(button(page)).toHaveAttribute('data-auth', 'signed-in');
    pages.push(page);
  }
  const [laptop, phone] = pages as [Page, Page];
  await button(phone).click();
  await expect(phone.getByTestId('menu-logout-all')).toHaveText('Log out everywhere');
  await phone.screenshot({ path: 'test-results/wallet-auth/menu-logout-all.png' });
  if (process.env.SESSION_SHOTS)
    await phone.getByTestId('wallet-menu').screenshot({
      path: `${process.env.SESSION_SHOTS}/menu-logout-all.png`,
    });
  await phone.getByTestId('menu-logout-all').click();
  await expect(button(phone)).toHaveAttribute('data-auth', 'signed-out');
  expect(server.logoutAll).toBe(1);
  expect([...server.sessions.values()].every((row) => row.revoked)).toBe(true);
  // The other device's cookie is still in its jar, but the server no longer accepts it.
  // (The wallet itself may stay connected; only the session is gone.)
  const me = laptop.waitForResponse('**/api/v1/me');
  await laptop.reload();
  expect((await me).status()).toBe(401);
  await expect(button(laptop)).not.toHaveAttribute('data-auth', 'signed-in');
  await expect(button(laptop)).toHaveAttribute('data-auth', /^(signed-out|wallet-connected)$/);
  await phone.reload();
  await expect(button(phone)).not.toHaveAttribute('data-auth', 'signed-in');
  await Promise.all(devices.map((context) => context.close()));
});

test('switching accounts sends the old session to sign-in, which revokes it', async ({
  context,
  page,
}) => {
  const server = new RevocableAuth();
  await server.install(context);
  await context.addInitScript(installMockWallet, A);
  await page.goto('/');
  await connectAndSign(page);
  await expect(button(page)).toHaveText(short(A));
  await page.evaluate((b) => window.__mockWallet.switchTo(b), B);
  await button(page).click();
  await page.getByTestId('menu-switch').click();
  await expect(button(page)).toHaveText(short(B));
  expect(server.verifyCookies.at(-1)).toContain('tm_session=sid-1');
  expect(server.sessions.get('sid-1')?.revoked).toBe(true);
  expect(server.sessions.get('sid-2')).toEqual({ wallet: B, revoked: false });
});
