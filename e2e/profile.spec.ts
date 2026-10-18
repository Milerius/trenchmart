import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

// Creator profiles: the public /u page (real stats only, verified X, buyers-only contact) and
// the /studio/profile editor (save, field errors, X sign-in with the devnet fallback, avatar).
// /api/v1 is stubbed; the wallet is the test signer.

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

const WALLET = 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ';
const CONFIG = { feeBps: 500, escrowHours: 1, terminals: ['Axiom'], tierRebateBps: {} };
const row = (slug: string, title: string, category = 'userscript') => ({
  slug,
  title,
  summary: `${title} summary.`,
  category,
  terminals: ['Axiom'],
  price: '100000000',
  handle: 'rugradar',
  cover: null,
});

const PUBLIC = {
  handle: 'rugradar',
  wallet: WALLET,
  displayName: 'RugRadar',
  bio: 'Bundle and sniper detection for Solana traders.',
  avatar: null,
  banner: null,
  xHandle: 'rugradar',
  xVerified: true,
  socials: { telegram: 'rugradar', github: 'rugradar', website: 'https://rugradar.xyz' },
  contact: [{ kind: 'telegram', value: 'rugradar_support', audience: 'everyone' }],
  contactHiddenForBuyers: true,
  memberSince: '2026-03-02T00:00:00.000Z',
  bond: '2000000000',
  escrowHours: 1,
  stats: {
    sales: 12,
    sales30d: 4,
    ratingCount: 0,
    ratingAvg: null,
    liveListings: 2,
    versionsShipped: 3,
    disputesUpheld: 0,
    disputesResolved: 0,
  },
  reviews: [],
  isOwner: false,
  listings: [
    row('bundle-overlay', 'Bundle Overlay'),
    row('smart-wallets', 'Smart Wallets', 'wallet_list'),
  ],
};

type Call = { method: string; path: string; body: unknown };
type Reply = { status?: number; json: unknown } | undefined;

async function stub(page: Page, handler: (call: Call) => Reply, signedIn = false) {
  const pair = nacl.sign.keyPair();
  const address = bs58.encode(pair.publicKey);
  if (signedIn)
    await page.addInitScript((value) => {
      (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ =
        value;
    }, bs58.encode(pair.secretKey));
  const calls: Call[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const raw = request.postData();
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      /* binary */
    }
    const call = { method: request.method(), path, body };
    calls.push(call);
    const custom = handler(call);
    if (custom) return route.fulfill({ status: custom.status ?? 200, json: custom.json });
    if (path === '/me' && signedIn)
      return route.fulfill({
        json: { user: { id: 'u1', wallet: address, handle: 'rugradar', roles: [] }, tier: 'none' },
      });
    if (path === '/config/public') return route.fulfill({ json: CONFIG });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return { calls, address };
}

test('public profile: name, verified X, socials, real stats, contact and category tabs', async ({
  page,
}) => {
  await stub(page, ({ path }) => (path === '/creators/rugradar' ? { json: PUBLIC } : undefined));
  await page.goto('/u/rugradar');
  await expect(page.getByRole('heading', { level: 1, name: 'RugRadar' })).toBeVisible();
  await expect(page.getByText('X verified')).toBeAttached();
  const socials = page.getByTestId('socials');
  await expect(socials.getByRole('link', { name: /X @rugradar/ })).toContainText('VERIFIED');
  await expect(socials.getByRole('link', { name: 't.me/rugradar' })).toHaveAttribute(
    'href',
    'https://t.me/rugradar',
  );
  await expect(socials.getByRole('link', { name: 'rugradar.xyz' })).toHaveAttribute(
    'rel',
    /noopener/,
  );
  const stats = page.getByTestId('creator-stats');
  await expect(stats).toContainText('Sales12');
  await expect(stats).toContainText('4 in the last 30 days');
  // No reviews yet: the rating is left out instead of showing a made-up number.
  await expect(stats).not.toContainText('Rating');
  // The grid fits the tiles that are shown: no empty cell where the rating would be.
  await expect(stats).toHaveAttribute('data-tiles', '4');
  await expect(stats).toHaveClass(/md:grid-cols-4/);
  await expect(stats).toContainText('2.00 SOL');
  await expect(stats).toContainText('Mar 2026');
  await expect(page.getByTestId('reviews')).toHaveCount(0);
  await expect(page.getByTestId('contact')).toContainText('@rugradar_support');
  await expect(page.getByTestId('contact')).toContainText(
    'More contact options show after you buy',
  );
  await expect(page.getByTestId('trust')).toContainText('1 h window');
  await expect(page.getByRole('button', { name: /Follow/ })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Smart Wallets' })).toBeVisible();
  await page.getByRole('tab', { name: /Wallet lists/ }).click();
  await expect(page.getByRole('heading', { name: 'Bundle Overlay' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Smart Wallets' })).toBeVisible();
});

test('public profile: ratings and reviews show only when buyers left them', async ({ page }) => {
  await stub(page, ({ path }) =>
    path === '/creators/rugradar'
      ? {
          json: {
            ...PUBLIC,
            stats: { ...PUBLIC.stats, ratingCount: 2, ratingAvg: 4.5 },
            reviews: [
              {
                rating: 5,
                body: 'Caught two bundles on day one.',
                createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
                listing: { title: 'Bundle Overlay', slug: 'bundle-overlay' },
                buyer: '9pQe…a1Lm',
              },
            ],
          },
        }
      : undefined,
  );
  await page.goto('/u/rugradar');
  await expect(page.getByTestId('creator-stats')).toContainText('★ 4.5');
  await expect(page.getByTestId('creator-stats')).toContainText('2 reviews');
  const reviews = page.getByTestId('reviews');
  await expect(reviews).toContainText('Caught two bundles on day one.');
  await expect(reviews).toContainText('9pQe…a1Lm');
  await expect(reviews.getByRole('link', { name: 'Bundle Overlay' })).toHaveAttribute(
    'href',
    '/l/bundle-overlay',
  );
});

const OWN = {
  handle: 'rugradar',
  wallet: WALLET,
  displayName: 'RugRadar',
  bio: null,
  avatar: null,
  banner: null,
  socials: {},
  contact: { enabled: false, channels: [] },
  xHandle: null,
  xVerified: false,
};

test('edit profile: saves fields and contact, shows per-field errors, updates the preview', async ({
  page,
}) => {
  let saved: Record<string, unknown> = { ...OWN };
  const { calls } = await stub(
    page,
    ({ method, path, body }) => {
      if (path === '/studio/profile' && method === 'GET') return { json: saved };
      if (path === '/studio/profile' && method === 'PUT') {
        const input = body as { socials: Record<string, string>; bio: string };
        if (input.socials.website === 'http://bad')
          return {
            status: 400,
            json: {
              error: {
                code: 'PROFILE_INVALID',
                message: 'Some fields need fixing',
                fields: { 'socials.website': 'Use an https:// address' },
              },
            },
          };
        saved = { ...saved, bio: input.bio, socials: { telegram: 'rugradar' } };
        return { json: saved };
      }
      return undefined;
    },
    true,
  );
  await page.goto('/studio/profile');
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible();
  await expect(page.getByTestId('dirty')).toHaveText('All changes saved');
  await page.getByLabel('Bio').fill('Strict rug filters. Weekly updates.');
  await expect(page.getByTestId('profile-preview')).toContainText('Strict rug filters.');
  await page.getByPlaceholder('https://example.com').fill('http://bad');
  await expect(page.getByTestId('dirty')).toContainText('2 unsaved changes');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('#err-website')).toHaveText('Use an https:// address');

  await page.getByPlaceholder('https://example.com').fill('');
  await page.getByPlaceholder('t.me/yourchannel').fill('t.me/rugradar');
  await page.getByRole('switch', { name: 'Let buyers contact me' }).click();
  await page.getByLabel('Email value').fill('me@rugradar.xyz');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved.');
  const put = calls.filter((c) => c.method === 'PUT').at(-1)!.body as Record<string, any>;
  expect(put.handle).toBeUndefined();
  expect(put.bio).toBe('Strict rug filters. Weekly updates.');
  expect(put.socials.telegram).toBe('t.me/rugradar');
  expect(put.contact).toEqual({
    enabled: true,
    channels: [{ kind: 'email', value: 'me@rugradar.xyz', audience: 'buyers' }],
  });
});

test('edit profile: X without an X app falls back to the unverified devnet link', async ({
  page,
}) => {
  let profile: Record<string, unknown> = { ...OWN };
  const { calls } = await stub(
    page,
    ({ method, path, body }) => {
      if (path === '/studio/profile') return { json: profile };
      if (path === '/auth/x/start')
        return {
          status: 501,
          json: { error: { code: 'X_UNCONFIGURED', message: 'X OAuth is not configured.' } },
        };
      if (method === 'POST' && path === '/studio/x') {
        profile = { ...profile, xHandle: (body as { handle: string }).handle, xVerified: false };
        return { json: { handle: profile.xHandle } };
      }
      return undefined;
    },
    true,
  );
  await page.goto('/studio/profile');
  const card = page.getByTestId('x-card');
  await expect(card).toContainText('X not linked');
  await card.getByRole('button', { name: 'Connect X' }).click();
  await page.getByPlaceholder('yourhandle').fill('rugradar');
  await page.getByRole('button', { name: 'Link X' }).click();
  await expect(card).toContainText('@rugradar');
  await expect(card).toContainText('NOT VERIFIED');
  await expect(card.getByRole('button', { name: 'Verify with X' })).toBeVisible();
  expect(calls.some((c) => c.method === 'POST' && c.path === '/studio/x')).toBe(true);
});

test('edit profile: with an X app, Connect X goes to X sign-in and the result is shown', async ({
  page,
}) => {
  const authorize =
    'https://x.com/i/oauth2/authorize?response_type=code&code_challenge_method=S256';
  const { calls } = await stub(
    page,
    ({ path }) => {
      if (path === '/studio/profile') return { json: OWN };
      if (path === '/auth/x/start') return { json: { url: authorize } };
      return undefined;
    },
    true,
  );
  await page.route('https://x.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>X sign-in</title>' }),
  );
  await page.goto('/studio/profile');
  await page.getByTestId('x-card').getByRole('button', { name: 'Connect X' }).click();
  await page.waitForURL(/x\.com\/i\/oauth2\/authorize/);
  expect(calls.some((c) => c.path === '/studio/x')).toBe(false);

  await page.goto('/studio/profile?x=taken');
  await expect(page.getByRole('status')).toHaveText(
    'That X account is already linked to another wallet.',
  );
});

test('edit profile: avatar upload sends the file and shows it', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAQ0lEQVR42u3PMQ0AAAgDoC251a3gHHwhSJ4tqRYEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEPg8mGgFBxbsCQwAAAABJRU5ErkJggg==',
    'base64',
  );
  const { calls } = await stub(
    page,
    ({ method, path }) => {
      if (path === '/studio/profile') return { json: OWN };
      if (method === 'POST' && path === '/studio/profile/avatar')
        return { json: { id: 'img-1', url: '/api/v1/profile-media/img-1', width: 64, height: 64 } };
      if (path === '/profile-media/img-1') return undefined;
      return undefined;
    },
    true,
  );
  await page.goto('/studio/profile');
  await page.getByTestId('avatar-input').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByRole('status')).toHaveText('Avatar updated.');
  await expect(page.getByTestId('profile-preview').locator('img')).toHaveAttribute(
    'src',
    '/api/v1/profile-media/img-1',
  );
  expect(calls.some((c) => c.method === 'POST' && c.path === '/studio/profile/avatar')).toBe(true);
});
