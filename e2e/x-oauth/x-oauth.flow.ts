import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { createSql } from '@trenchmart/db';

// The whole "Verify with X" flow in a real browser: web /api/v1 proxy -> real API -> mock X
// API (e2e/x-oauth/mock-x.mjs). X's authorize page is stubbed here: it shows an "Authorize
// app" button that returns to the redirect_uri with the state X was given, like X does.
// Starts as Roman did: @mileriseme linked on devnet, NOT VERIFIED.

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

const sql = createSql(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
);
const SHOTS = 'test-results/x-oauth-flow';
const WEB = `http://127.0.0.1:${process.env.XO_WEB_PORT ?? '3317'}`;

test.afterAll(async () => {
  await sql.end();
});

async function signIn(page: Page) {
  const pair = nacl.sign.keyPair();
  const wallet = bs58.encode(pair.publicKey);
  await page.goto('/');
  const { message } = await page.evaluate(async (wallet) => {
    const r = await fetch('/api/v1/auth/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    return (await r.json()) as { message: string };
  }, wallet);
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey),
  );
  const status = await page.evaluate(
    async ([wallet, signature]) =>
      (
        await fetch('/api/v1/auth/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet, signature }),
        })
      ).status,
    [wallet, signature],
  );
  expect(status).toBe(200);
  // Free the handle from earlier runs, then link it unverified like a devnet dev link.
  await sql`update users set x_handle = null, x_user_id = null where lower(x_handle) = 'mileriseme' or x_user_id = '1601092300893499392'`;
  await sql`update users set x_handle = 'mileriseme', x_user_id = 'dev:mileriseme' where wallet = ${wallet}`;
  return wallet;
}

/** Stub X's authorize page: checks the PKCE request, then "Authorize app" sends `code` back. */
async function mockXAuthorize(page: Page, code: string) {
  const seen: URL[] = [];
  await page.route('https://x.com/i/oauth2/authorize**', async (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Authorize TrenchMart - X</title>
        <body style="font-family:sans-serif;background:#000;color:#fff;display:grid;place-items:center;height:100vh">
        <div style="text-align:center"><h1>Mock X</h1><p>TrenchMart wants to access your X account</p>
        <p>Scopes: ${url.searchParams.get('scope')}</p>
        <a id="authorize" href="${back.toString()}" style="background:#fff;color:#000;padding:12px 24px;border-radius:999px;text-decoration:none">Authorize app</a></div>`,
    });
  });
  return seen;
}

async function verifyWithX(page: Page, code: string, shot: string) {
  const seen = await mockXAuthorize(page, code);
  await page.goto('/studio/profile');
  const card = page.getByTestId('x-card');
  await expect(card).toContainText('@mileriseme');
  await expect(card).toContainText('NOT VERIFIED');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${shot}-1-before.png` });
  await card.getByRole('button', { name: 'Verify with X' }).click();
  await page.waitForURL(/^https:\/\/x\.com\/i\/oauth2\/authorize/);
  const authorize = seen[0]!;
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('scope')).toBe('users.read tweet.read');
  expect(authorize.searchParams.get('redirect_uri')).toBe(`${WEB}/api/v1/auth/x/callback`);
  await page.screenshot({ path: `${SHOTS}/${shot}-2-x-authorize.png` });
  await page.locator('#authorize').click();
  // Callback through the web proxy, then back on the profile with the query cleaned up.
  await page.waitForURL(`${WEB}/studio/profile`);
  return card;
}

test('Verify with X: authorize on X -> callback via the web proxy -> profile shows VERIFIED', async ({
  page,
}) => {
  const wallet = await signIn(page);
  const card = await verifyWithX(page, 'code-ok', 'linked');
  await expect(card).toContainText('VERIFIED VIA X');
  await expect(card).not.toContainText('NOT VERIFIED');
  await expect(card.getByTestId('x-result')).toContainText('X account verified and linked.');
  await expect(card.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/linked-3-verified.png` });
  const [row] = await sql<{ x_handle: string; x_user_id: string }[]>`
    select x_handle, x_user_id from users where wallet = ${wallet}
  `;
  expect(row).toEqual({ x_handle: 'mileriseme', x_user_id: '1601092300893499392' });
  // A reload does not replay the result banner.
  await page.reload();
  await expect(card).toContainText('VERIFIED VIA X');
  await expect(card.getByTestId('x-result')).toHaveCount(0);
});

test('Verify with X: token exchange 401 shows why on the card, handle stays unverified', async ({
  page,
}) => {
  await signIn(page);
  const card = await verifyWithX(page, 'code-401', 'token-401');
  const result = card.getByTestId('x-result');
  await expect(result).toHaveAttribute('data-ok', 'false');
  await expect(result).toContainText('X sign-in failed.');
  await expect(result).toContainText("X rejected TrenchMart's app credentials (HTTP 401)");
  await expect(card).toContainText('NOT VERIFIED');
  await page.screenshot({ path: `${SHOTS}/token-401-3-error.png` });
});

test('Verify with X: users/me 403 shows why on the card', async ({ page }) => {
  await signIn(page);
  const card = await verifyWithX(page, 'code-me403', 'me-403');
  await expect(card.getByTestId('x-result')).toContainText('HTTP 403 on /2/users/me');
  await expect(card).toContainText('NOT VERIFIED');
  await page.screenshot({ path: `${SHOTS}/me-403-3-error.png` });
});
