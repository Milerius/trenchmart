import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

// Agent API surfaces: the studio API-keys page (create with scopes, key shown once, revoke),
// the agent docs pages and the raw llms.txt / llms-full.txt. /api/v1 is stubbed; the wallet
// is the test signer.

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

type Call = { method: string; path: string; body: unknown };

const KEY = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'sniper-bot',
  prefix: 'tmk_AbCdEfGh',
  scopes: ['read', 'trade'],
  rateLimitPerMin: 60,
  createdVia: 'studio',
  createdAt: '2026-10-18T08:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...over,
});

async function signedIn(
  page: Page,
  handler: (call: Call) => { status?: number; json: unknown } | undefined,
) {
  const pair = nacl.sign.keyPair();
  const address = bs58.encode(pair.publicKey);
  await page.addInitScript((value) => {
    (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ = value;
  }, bs58.encode(pair.secretKey));
  const calls: Call[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const raw = request.postData();
    const call = { method: request.method(), path, body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    const custom = handler(call);
    if (custom) return route.fulfill({ status: custom.status ?? 200, json: custom.json });
    if (path === '/me')
      return route.fulfill({
        json: { user: { id: 'u1', wallet: address, handle: 'agentdev', roles: [] }, tier: 'none' },
      });
    if (path === '/config/public')
      return route.fulfill({
        json: { feeBps: 500, escrowHours: 1, terminals: ['Axiom'], tierRebateBps: {} },
      });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return calls;
}

test('studio API keys: create with scopes, secret shown once, list and revoke', async ({
  page,
}) => {
  let keys = [
    KEY(),
    KEY({
      id: 'k2',
      name: 'old-agent',
      prefix: 'tmk_ZyXwVuTs',
      createdVia: 'challenge',
      revokedAt: '2026-10-17T10:00:00.000Z',
    }),
  ];
  const calls = await signedIn(page, ({ method, path, body }) => {
    if (path === '/agent/keys' && method === 'GET') return { json: { keys, maxActive: 10 } };
    if (path === '/agent/keys' && method === 'POST') {
      const input = body as { name: string; scopes: string[]; rateLimitPerMin: number };
      const row = KEY({
        id: 'k3',
        name: input.name,
        prefix: 'tmk_NewKey12',
        scopes: input.scopes,
        rateLimitPerMin: input.rateLimitPerMin,
      });
      keys = [row, ...keys];
      return { json: { key: 'tmk_NewKey12-secret-shown-once-0123456789abcdefgh', ...row } };
    }
    if (path === '/agent/keys/k1' && method === 'DELETE') {
      keys = keys.map((k) => (k.id === 'k1' ? { ...k, revokedAt: '2026-10-18T09:00:00.000Z' } : k));
      return { json: { ok: true } };
    }
    return undefined;
  });

  await page.goto('/studio/api-keys');
  await expect(page.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible();
  const list = page.getByTestId('key-list');
  await expect(list).toContainText('sniper-bot');
  await expect(list).toContainText('tmk_AbCdEfGh…');
  await expect(list).toContainText('ACTIVE');
  await expect(list).toContainText('REVOKED');
  await expect(list).toContainText('AGENT-MINTED');
  // The list never shows a secret, only prefixes.
  await expect(page.getByTestId('new-key')).toHaveCount(0);

  const create = page.getByRole('button', { name: 'Create key' });
  await expect(create).toBeDisabled();
  await page.getByLabel('Name').fill('bad/name');
  await expect(
    page.getByText('Letters, digits, spaces, dot, dash and underscore only.'),
  ).toBeVisible();
  await expect(create).toBeDisabled();
  await page.getByLabel('Name').fill('seller agent');
  await page.getByRole('checkbox', { name: /^trade/ }).uncheck();
  await page.getByRole('checkbox', { name: /^sell/ }).check();
  await page.getByLabel('Rate limit (requests per minute)').fill('120');
  await create.click();

  const shown = page.getByTestId('new-key');
  await expect(shown).toContainText('tmk_NewKey12-secret-shown-once-0123456789abcdefgh');
  await expect(shown).toContainText('shown once');
  const post = calls.find((c) => c.method === 'POST' && c.path === '/agent/keys')!;
  expect(post.body).toEqual({
    name: 'seller agent',
    scopes: ['read', 'sell'],
    rateLimitPerMin: 120,
  });
  await expect(list).toContainText('seller agent');
  await shown.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('new-key')).toHaveCount(0);

  const row = list.locator('li', { hasText: 'sniper-bot' });
  await row.getByRole('button', { name: 'Revoke' }).click();
  await row.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(row).toContainText('REVOKED');
  expect(calls.some((c) => c.method === 'DELETE' && c.path === '/agent/keys/k1')).toBe(true);
});

test('studio dashboard links to API keys', async ({ page }) => {
  await signedIn(page, () => undefined);
  await page.goto('/studio');
  await expect(page.getByRole('link', { name: 'API keys' })).toHaveAttribute(
    'href',
    '/studio/api-keys',
  );
});

test('agent docs: auth, scopes, flows, errors, links to OpenAPI and llms.txt', async ({ page }) => {
  await page.goto('/docs/agents');
  await expect(page.getByRole('heading', { level: 1, name: 'Agent API' })).toBeVisible();
  await expect(page.getByTestId('agent-cluster')).toHaveText('Solana devnet only');
  await expect(page.getByTestId('agent-base')).toHaveText('https://api.trenchmart.fun/api/v1');
  for (const id of [
    'quickstart',
    'auth',
    'scopes',
    'limits',
    'transactions',
    'buying',
    'selling',
    'fees',
    'errors',
    'not-available',
  ])
    await expect(page.locator(`section#${id}`)).toBeVisible();
  await expect(page.getByTestId('llms-link')).toHaveAttribute('href', '/llms.txt');
  await expect(page.getByRole('link', { name: 'openapi.json' }).first()).toHaveAttribute(
    'href',
    'https://api.trenchmart.fun/api/v1/openapi.json',
  );
  await expect(page.locator('section#buying')).toContainText('POST /listings/{slug}/upvote');
  await expect(page.locator('section#buying')).toContainText('PUT /studio/profile');
  await expect(page.locator('section#quickstart')).toContainText(
    "tm.upvote('trojan-trenches-intel')",
  );
  await expect(page.locator('section#errors')).toContainText('NOT_ISSUED');
  await expect(page.locator('section#errors')).toContainText('DAILY_QUOTA');
  await expect(page.getByTestId('limit-daily')).toContainText('10,000 requests');
  await expect(page.getByTestId('limit-key')).toContainText('a 50/min key gets 30/min');
  await expect(page.locator('section#limits')).toContainText('across all its keys');
  await expect(page.locator('section#not-available')).toContainText('Webhooks are not available');
  const nav = page.getByTestId('docs-nav');
  await expect(nav.getByRole('link', { name: 'Agent API' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await nav.getByRole('link', { name: 'API reference' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Endpoint reference' })).toBeVisible();
  await expect(page.locator('#postAgentTxBroadcast')).toContainText('/agent/tx/broadcast');
  await expect(page.locator('#getStudioSales')).toContainText('sell');
  await expect(page.locator('#postListingsBy_slugUpvote')).toContainText('up');

  await nav.getByRole('link', { name: 'Agent SDK' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'TypeScript SDK' })).toBeVisible();
  await expect(page.getByTestId('sdk-docs')).toContainText('npm i @trenchmart/sdk');
});

test('llms.txt and llms-full.txt are raw text, say devnet and cover the agent API', async ({
  request,
}) => {
  const index = await request.get('/llms.txt');
  expect(index.status()).toBe(200);
  expect(index.headers()['content-type']).toContain('text/plain');
  const text = await index.text();
  expect(text.startsWith('# TrenchMart\n')).toBe(true);
  expect(text).toContain('Solana devnet only');
  expect(text).toContain('https://trenchmart.fun/docs/agents');
  expect(text).toContain('https://api.trenchmart.fun/api/v1/openapi.json');
  expect(text).not.toContain('<html');

  const full = await request.get('/llms-full.txt');
  expect(full.headers()['content-type']).toContain('text/plain');
  const body = await full.text();
  for (const needle of [
    'devnet',
    'POST /agent/auth/challenge',
    'POST /agent/tx/broadcast',
    'GET /studio/sales',
    'POST /listings/{slug}/upvote {"up": true}',
    'GET/PUT /studio/profile',
    'NOT_ISSUED',
    'read:',
    'trade:',
    'sell:',
    'profile:',
    'review:',
  ])
    expect(body).toContain(needle);
  expect(body).not.toMatch(/mainnet-beta/);
});
