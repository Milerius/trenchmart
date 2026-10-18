import { expect, test } from '@playwright/test';

// Crawlers and agents: robots.txt, sitemap.xml and the devnet deployment manifest. They must work
// without the API (CI has none), falling back to the static pages and the built-in addresses.

test('robots.txt allows the site, keeps private areas out, and points at the sitemap', async ({
  request,
}) => {
  const response = await request.get('/robots.txt');
  expect(response.ok()).toBe(true);
  const text = await response.text();
  expect(text).toMatch(/User-Agent: \*/i);
  expect(text).toContain('Allow: /');
  for (const path of ['/me/', '/studio/', '/admin/']) expect(text).toContain(`Disallow: ${path}`);
  expect(text).toContain('Sitemap: https://trenchmart.fun/sitemap.xml');
});

test('sitemap.xml lists the public pages and every category', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('xml');
  const xml = await response.text();
  for (const path of [
    '/',
    '/search',
    '/verify',
    '/docs/escrow',
    '/docs/faq',
    '/terms',
    '/privacy',
    '/c/userscript',
  ]) {
    expect(xml).toContain(`<loc>https://trenchmart.fun${path === '/' ? '/' : path}</loc>`);
  }
  expect(xml).not.toContain('/studio');
  expect(xml).not.toContain('/me/');
});

test('/.well-known/trenchmart.json says devnet, never mainnet, and links Explorer with ?cluster=devnet', async ({
  request,
}) => {
  const response = await request.get('/.well-known/trenchmart.json');
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.cluster).toBe('devnet');
  expect(body.mainnet).toBe(false);
  expect(body.notice).toMatch(/DEVNET/);
  expect(body.rpc).toBe('https://api.devnet.solana.com');
  expect(body.escrowProgram.programId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  for (const link of [body.escrowProgram.explorer, body.treasury.explorer, body.token.explorer]) {
    expect(link).toMatch(
      /^https:\/\/explorer\.solana\.com\/address\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet$/,
    );
  }
  expect(body.token.symbol).toBe('TRENCH');
  expect(body.token.decimals).toBe(6);
});

test('pages carry devnet metadata', async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } }),
  );
  await page.goto('/verify');
  await expect(page).toHaveTitle(/TrenchMart/);
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description).toBeTruthy();
});
