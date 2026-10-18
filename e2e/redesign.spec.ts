import { expect, test } from '@playwright/test';

// Redesign (React Bits port). Each phase adds its checks here; existing specs keep covering behaviour.

test.describe('phase 1: fonts', () => {
  test('headings keep their accessible names with the serif accent', async ({ page }) => {
    await page.goto('/');
    const hero = page.getByRole('heading', { level: 1, name: 'The verified edge, for sale.' });
    await expect(hero).toBeVisible();
    for (const name of [
      'Top creators this month',
      'Trending this week',
      'Four steps, no surprises.',
      'Find your edge',
      'Hold $TRENCH, pay less.',
      "Built so you don't have to trust anyone.",
      'Have an edge? Sell it.',
    ]) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeAttached();
    }
    await page.goto('/creators');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Creator leaderboard' }),
    ).toBeVisible();
    await page.goto('/sell');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sell your tooling. Keep 100% of the price.' }),
    ).toBeVisible();
    await page.goto('/token');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Fees fund the token. The token cuts your fees.',
      }),
    ).toBeVisible();
    await page.goto('/search');
    await expect(page.getByRole('heading', { level: 1, name: 'All live listings' })).toBeVisible();
  });

  test('the accent uses the self-hosted Instrument Serif; body text stays Geist', async ({
    page,
  }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) external.push(request.url());
    });
    await page.goto('/');
    const accent = page.getByRole('heading', { level: 1 }).locator('em');
    await expect(accent).toHaveText('for sale.');
    const family = await accent.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/Instrument Serif/i);
    expect(await accent.evaluate((el) => getComputedStyle(el).fontStyle)).toBe('italic');
    const body = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(body).toMatch(/Geist/i);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (f) => /Instrument Serif/i.test(f.family) && f.status === 'loaded',
        ),
      ),
    ).toBe(true);
    expect(external).toEqual([]);
  });
});

test.describe('phase 2: tokens and corners', () => {
  test('darker canvas and surface, rounder cards and panels', async ({ page }) => {
    await page.goto('/');
    const css = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const read = (name: string) => root.getPropertyValue(name).trim();
      return {
        body: getComputedStyle(document.body).backgroundColor,
        surface: read('--color-surface'),
        line: read('--color-line'),
        card: read('--radius-card'),
        panel: read('--radius-panel'),
        // Contrast tokens stay (>= 4.5:1 text, >= 3:1 control boundaries).
        lineControl: read('--color-line-control'),
        accentLabel: read('--color-accent-label'),
        decor: read('--color-decor'),
      };
    });
    expect(css.body).toBe('rgb(7, 8, 7)');
    expect(css.surface).toBe('#101210');
    expect(css.line).toBe('#232823');
    expect([css.card, css.panel]).toEqual(['16px', '22px']);
    expect([css.lineControl, css.accentLabel, css.decor]).toEqual([
      '#646c63',
      '#9faf86',
      '#6e756d',
    ]);
    const receipt = page.locator('figure').filter({ hasText: 'Example review receipt' });
    expect(await receipt.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('22px');
  });
});

test.describe('phase 3: buttons and pills', () => {
  test('primary CTA is a StarBorder pill that still navigates', async ({ page }) => {
    await page.goto('/');
    const cta = page.getByRole('link', { name: 'Browse the market' });
    await expect(cta).toBeVisible();
    expect(parseFloat(await cta.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBe(
      999,
    );
    await expect(cta.locator('canvas[aria-hidden="true"]')).toHaveCount(1);
    expect(await cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(198, 244, 50)',
    );
    // Secondary buttons are pills too.
    const secondary = page.getByRole('link', { name: 'Sell your tooling', exact: true });
    expect(
      parseFloat(await secondary.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)),
    ).toBeGreaterThan(100);
    await cta.click();
    await expect(page).toHaveURL(/#market$/);
  });

  test('terminal filter is a pill track; the pressed pill is solid ink', async ({ page }) => {
    await page.goto('/');
    const group = page.getByTestId('terminal-filter');
    expect(
      parseFloat(await group.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)),
    ).toBeGreaterThan(100);
    const all = group.getByRole('button', { name: 'All' });
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(await all.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(238, 240, 234)',
    );
    const axiom = group.getByRole('button', { name: /Axiom/ });
    await axiom.click();
    await expect(axiom).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  test('pill track scrolls sideways on a phone instead of wrapping', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const group = page.getByTestId('terminal-filter');
    const box = await group.boundingBox();
    expect(box!.height).toBeLessThan(50);
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

test.describe('phase 4: cards', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const CARD_LISTING = {
    id: 'listing-1',
    slug: 'bundle-detector-overlay',
    title: 'Bundle Detector Overlay',
    summary: 'Overlay that flags bundled launches on Axiom.',
    category: 'userscript',
    terminals: ['Axiom'],
    price: '1200000000',
    handle: 'rugradar',
    sales7d: 3,
    ratingAvg: '4.90',
    cover: { url: 'https://media.trenchmart.test/cover.png', alt: 'Overlay on an Axiom chart' },
    imageCount: 2,
  };

  test.beforeEach(async ({ page }) => {
    await page.route('https://media.trenchmart.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
    );
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      if (path === '/listings') return route.fulfill({ status: 200, json: [CARD_LISTING] });
      return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'x' } } });
    });
  });

  test('listing cards are SpotlightCards that keep the real cover and light up on hover', async ({
    page,
  }) => {
    await page.goto('/');
    const card = page.getByTestId('listing-card').first();
    await expect(card).toBeVisible();
    await expect(card.getByRole('img', { name: 'Overlay on an Axiom chart' })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Bundle Detector Overlay' })).toBeVisible();
    const spot = card.locator('xpath=..');
    expect(await spot.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('16px');
    // The light layer is the first aria-hidden span; it fades in while the pointer is over the card.
    const light = spot.locator(':scope > span').first();
    expect(Number(await light.evaluate((el) => getComputedStyle(el).opacity))).toBe(0);
    await card.hover();
    await expect
      .poll(async () => Number(await light.evaluate((el) => getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.05);
    await card.click();
    await expect(page).toHaveURL(/\/l\/bundle-detector-overlay$/);
  });

  test('a card far from the pointer stays dark; reduced motion still lights the hovered card', async ({
    page,
  }) => {
    await page.goto('/');
    const card = page.getByTestId('listing-card').first();
    await expect(card).toBeVisible();
    const light = card.locator('xpath=..').locator(':scope > span').first();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    expect(Number(await light.evaluate((el) => getComputedStyle(el).opacity))).toBe(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await card.hover();
    await expect
      .poll(async () => Number(await light.evaluate((el) => getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.05);
  });

  test('category and trust cards keep their names and links', async ({ page }) => {
    await page.goto('/');
    const categories = page.getByRole('region', { name: 'Find your edge' });
    const userscripts = categories.getByRole('link', { name: /Userscripts/i }).first();
    await userscripts.scrollIntoViewIfNeeded();
    expect(
      await userscripts.evaluate((el) => getComputedStyle(el.parentElement!).borderRadius),
    ).toBe('16px');
    await expect(
      page.getByRole('heading', { name: 'Escrow on every order', exact: true }),
    ).toBeAttached();
    await userscripts.click();
    await expect(page).toHaveURL(/\/c\/userscript$/);
  });
});
