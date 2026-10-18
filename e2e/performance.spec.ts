import { expect, test, type Page } from '@playwright/test';

// Performance pass guards: key pages still render, the shared bundle stays free of heavy
// libraries, reads are preloaded with the same credentials mode the app uses, and the
// entrance animations are unchanged. A second block runs against the live deploy
// (TM_LIVE_URL) to prove public caching never serves private data.

const KEY_PAGES = ['/', '/search', '/studio', '/me/purchases', '/verify', '/creators'] as const;

async function scriptUrls(page: Page, path: string): Promise<string[]> {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') urls.push(request.url());
  });
  await page.goto(path);
  await expect(page.getByTestId('nav')).toBeVisible();
  return urls;
}

for (const path of KEY_PAGES) {
  test(`${path} renders with the shell and its main content`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(path);
    await expect(page.getByTestId('nav')).toBeVisible();
    await expect(page.getByTestId('network-banner')).toBeVisible();
    await expect(page.locator('main#content')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });
}

test('the home bundle does not load zod, tweetnacl or the chain package', async ({ page }) => {
  const urls = await scriptUrls(page, '/');
  const heavy = urls.filter((url) => /zod|tweetnacl|packages_chain|@noble/i.test(url));
  expect(heavy).toEqual([]);
});

test('shared reads are preloaded with credentials so the app reuses them', async ({ page }) => {
  await page.goto('/');
  for (const href of ['/api/v1/me', '/api/v1/listings', '/api/v1/config/public']) {
    const link = page.locator(`link[rel="preload"][as="fetch"][href="${href}"]`);
    await expect(link).toHaveAttribute('crossorigin', 'use-credentials');
  }
});

test('entrance animations are unchanged (rise and route fade still run)', async ({ page }) => {
  await page.goto('/');
  const rise = page.locator('.rise').first();
  await expect(rise).toBeVisible();
  expect(await rise.evaluate((el) => getComputedStyle(el).animationName)).toBe('rise');
  const fade = page.locator('.route-fade').first();
  expect(await fade.evaluate((el) => getComputedStyle(el).animationName)).toBe('route-fade');
  // The page settles fully opaque, exactly as before.
  await expect
    .poll(() => rise.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3_000 })
    .toBe('1');
});

test('/listings (a guessed URL that used to 404) lands on the browse page', async ({ page }) => {
  const res = await page.goto('/listings');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByTestId('nav')).toBeVisible();
});

const IMG = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
const PERF_LISTING = {
  id: IMG(9),
  slug: 'perf-pack',
  title: 'Perf Pack',
  summary: 'Flags bundled launches.',
  category: 'userscript',
  terminals: ['Axiom'],
  price: '1000000000',
  handle: 'rugradar',
  sales7d: 3,
  ratingAvg: '4.90',
  ratingCount: 1,
  cover: { url: `/api/v1/media/${IMG(1)}`, alt: 'Perf Pack cover' },
  imageCount: 3,
  description: 'Overlay.',
  license: 'single',
  holderOnly: false,
  creator: {
    handle: 'rugradar',
    wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
    bondLamports: '1000000000',
  },
  preview: '// ==UserScript==',
  security: null,
  content: {
    readme: '# Perf Pack',
    howto: '1. Install',
    requirements: 'Chrome 120+',
    gallery: [1, 2, 3].map((n) => ({
      id: IMG(n),
      url: `/api/v1/media/${IMG(n)}`,
      alt: `Screenshot ${n}`,
      width: 32,
      height: 32,
    })),
  },
};

test('listing page renders; the hero image is high priority and thumbnails are lazy', async ({
  page,
}) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path.startsWith('/media/'))
      return route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.alloc(0) });
    if (path === '/me')
      return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } });
    if (path === '/listings') return route.fulfill({ json: [PERF_LISTING] });
    if (path === '/listings/perf-pack') return route.fulfill({ json: PERF_LISTING });
    if (path === '/listings/perf-pack/versions' || path === '/listings/perf-pack/reviews')
      return route.fulfill({ json: [] });
    return route.fallback();
  });
  await page.goto('/l/perf-pack');
  await expect(page.getByRole('heading', { name: 'Perf Pack', level: 1 })).toBeVisible();
  const hero = page.getByTestId('gallery-hero').locator('img');
  await expect(hero).toHaveAttribute('fetchpriority', 'high');
  const thumbs = page.getByTestId('gallery-thumbs').locator('img');
  await expect(thumbs).toHaveCount(3);
  for (const thumb of await thumbs.all()) await expect(thumb).toHaveAttribute('loading', 'lazy');
});

test.describe('live caching privacy', () => {
  const live = process.env.TM_LIVE_URL;
  const api = process.env.TM_LIVE_API_URL ?? 'https://api.trenchmart.fun';
  test.skip(!live, 'set TM_LIVE_URL to run against the deployed site');

  test('a session cookie never gets a shared-cache response', async ({ request }) => {
    for (const path of ['/api/v1/listings', '/api/v1/stats', '/api/v1/me', '/api/v1/me/orders']) {
      const res = await request.get(`${api}${path}`, {
        headers: { cookie: 'tm_session=perf-guard-not-a-real-session' },
      });
      expect(res.headers()['cache-control'] ?? '', path).toMatch(/private|no-store/);
      expect(res.headers()['x-edge-cache'], path).toBeUndefined();
    }
  });

  test('anonymous public reads are edge cached; private reads are not', async ({ request }) => {
    const pub = await request.get(`${api}/api/v1/listings`);
    expect(pub.headers()['cache-control']).toContain('s-maxage=');
    const me = await request.get(`${api}/api/v1/me`);
    expect(me.headers()['cache-control'] ?? '').toMatch(/private|no-store/);
  });

  test('cached listing HTML carries no session or viewer data', async ({ request }) => {
    const listings = (await (await request.get(`${api}/api/v1/listings`)).json()) as {
      slug: string;
    }[];
    test.skip(!listings.length, 'no live listings');
    const url = `${live}/l/${listings[0]!.slug}`;
    const first = await request.get(url, {
      headers: { cookie: 'tm_session=perf-guard-not-a-real-session' },
    });
    expect(first.status()).toBe(200);
    const again = await request.get(url);
    const html = await again.text();
    expect(html).not.toContain('perf-guard-not-a-real-session');
    expect(again.headers()['set-cookie']).toBeUndefined();
  });

  test('cached creator HTML has the public profile but no owner-only controls', async ({
    request,
  }) => {
    const top = (await (await request.get(`${api}/api/v1/creators/top`)).json()) as {
      handle: string | null;
      wallet: string;
    }[];
    test.skip(!top.length, 'no live creators');
    const res = await request.get(`${live}/u/${top[0]!.handle ?? top[0]!.wallet}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="creator-profile"');
    expect(html).not.toContain('Edit profile');
    expect(html).not.toContain('"isOwner":true');
  });

  test('live /listings redirects to /search', async ({ request }) => {
    const res = await request.get(`${live}/listings`, { maxRedirects: 0 });
    expect([301, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/search$/);
  });

  for (const path of ['/', '/search', '/studio', '/me/purchases', '/verify', '/creators']) {
    test(`live ${path} renders`, async ({ page }) => {
      await page.goto(`${live}${path}`);
      await expect(page.getByTestId('nav')).toBeVisible();
    });
  }
});
