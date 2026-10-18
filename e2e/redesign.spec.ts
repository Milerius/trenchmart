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
    // The prototype receipt sits in a 26px BorderGlow panel (a plain 26px panel until it loads).
    const receipt = page
      .locator('figure')
      .filter({ hasText: 'Example review receipt' })
      .locator(':scope > :first-child');
    expect(await receipt.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('26px');
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

  test('listing card: category tag and terminal chip on the cover, price on the right', async ({
    page,
  }) => {
    await page.goto('/');
    const card = page.getByTestId('listing-card').first();
    await expect(card).toBeVisible();
    const cover = card.getByTestId('card-cover');
    await expect(cover).toContainText('USERSCRIPT');
    await expect(cover.getByTestId('card-terminal-chip')).toBeVisible();
    expect(await card.locator('xpath=..').evaluate((el) => getComputedStyle(el).borderRadius)).toBe(
      '22px',
    );
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
    expect(await spot.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('22px');
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
    ).toBe('22px');
    await expect(
      page.getByRole('heading', { name: 'Escrow on every order', exact: true }),
    ).toBeAttached();
    await userscripts.click();
    await expect(page).toHaveURL(/\/c\/userscript$/);
  });
});

test.describe('phase 5: header, nav and footer', () => {
  test('desktop header is sticky glass; nav links are pills; "/" focuses search', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const header = page.getByTestId('nav');
    const style = await header.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, filter: cs.backdropFilter };
    });
    expect(style.position).toBe('sticky');
    expect(style.filter).toContain('blur(18px)');
    const current = header.getByRole('link', { name: 'Explore', exact: true });
    await expect(current).toHaveAttribute('aria-current', 'page');
    expect(
      parseFloat(await current.evaluate((el) => getComputedStyle(el).borderRadius)),
    ).toBeGreaterThanOrEqual(999);
    await page.mouse.wheel(0, 1600);
    await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
    await page.locator('body').click({ position: { x: 5, y: 600 } });
    await page.keyboard.press('/');
    await expect(page.getByTestId('search')).toBeFocused();
    await page.keyboard.type('bundle');
    await expect(page.getByTestId('search')).toHaveValue('bundle');
  });

  test('phone header stays in the flow with no backdrop blur', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const header = page.getByTestId('nav');
    const style = await header.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, filter: cs.backdropFilter };
    });
    expect(style.position).toBe('static');
    expect(style.filter).toBe('none');
  });

  test('footer lists the real devnet addresses and every site link', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    const explorer = (address: string) =>
      `https://explorer.solana.com/address/${address}?cluster=devnet`;
    await expect(footer.getByTestId('footer-program')).toHaveAttribute(
      'href',
      explorer('Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw'),
    );
    await expect(footer.getByRole('link', { name: /Squads multisig/ })).toHaveAttribute(
      'href',
      explorer('CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B'),
    );
    await expect(footer.getByRole('link', { name: /\$TRENCH mint/ })).toHaveAttribute(
      'href',
      explorer('8Gu4hXYypyRrxY6763AdhQnyHma82L3ww9wq3vy2cbq6'),
    );
    for (const [name, href] of [
      ['Explore', '/search'],
      ['Creators', '/creators'],
      ['Sell', '/sell'],
      ['Creator Studio', '/studio'],
      ['Verify & proof', '/verify'],
      ['How automated review works', '/sell'],
      ['Fees & $TRENCH', '/token'],
      ['Status', '/status'],
      ['Docs', '/docs'],
      ['Terms', '/terms'],
      ['Privacy', '/privacy'],
    ]) {
      await expect(footer.getByRole('link', { name, exact: true })).toHaveAttribute('href', href!);
    }
  });
});

test.describe('perf: StarBorder on phones', () => {
  const countFrames = async (page: import('@playwright/test').Page) => {
    await page.waitForTimeout(3500); // past the idle start
    return page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const w = window as unknown as { __raf: number };
          const before = w.__raf;
          setTimeout(() => resolve(w.__raf - before), 1000);
        }),
    );
  };
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        w.__raf += 1;
        return raf(cb);
      };
    });
  });

  test('the CTA stars rest on a phone (no per-frame loop) but still cruise on desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Browse the market/ })).toBeVisible();
    expect(await countFrames(page)).toBeLessThan(10);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Browse the market/ })).toBeVisible();
    expect(await countFrames(page)).toBeGreaterThan(20);
  });
});

test.describe('phase 6: home', () => {
  // Script chunks for the lazy React Bits effects (dev and prod chunk names both carry the file).
  const fxChunks = (page: import('@playwright/test').Page) =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /Aurora|LightRays|BorderGlow|SplitText|LogoLoop/.test(name)),
    );

  test('desktop loads the hero aurora, CTA rays and glow receipt after idle; names hold', async ({
    page,
  }) => {
    // Automated browsers get the static fallbacks unless they opt in (lib/fx.ts).
    await page.addInitScript(() => {
      (window as Window & { __TM_FX__?: boolean }).__TM_FX__ = true;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-fx="aurora"] canvas')).toBeAttached({ timeout: 15_000 });
    await expect(page.locator('[data-fx="rays"] canvas')).toBeAttached();
    expect((await fxChunks(page)).length).toBeGreaterThan(0);
    // The split-letter H1 and the shine keep the accessible name.
    await expect(
      page.getByRole('heading', { level: 1, name: 'The verified edge, for sale.' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Have an edge? Sell it.' })).toBeVisible();
    // Terminals band: every supported terminal is listed.
    const band = page.getByTestId('terminal-band');
    for (const name of ['Axiom', 'GMGN', 'Photon', 'Terminal', 'Trojan'])
      await expect(band.getByText(name, { exact: true }).first()).toBeAttached();
  });

  for (const mode of ['phone', 'reduced motion'] as const) {
    test(`${mode}: no effect chunks or canvases, static fallbacks render`, async ({ page }) => {
      // Opt in like a real browser, so only the phone / reduced-motion gate keeps effects off.
      await page.addInitScript(() => {
        (window as Window & { __TM_FX__?: boolean }).__TM_FX__ = true;
      });
      if (mode === 'phone') await page.setViewportSize({ width: 390, height: 844 });
      else {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      await page.goto('/');
      await expect(
        page.getByRole('heading', { level: 1, name: 'The verified edge, for sale.' }),
      ).toBeVisible();
      await page.waitForLoadState('load');
      await page.waitForTimeout(2500);
      await expect(page.locator('[data-fx]')).toHaveCount(0);
      expect(await fxChunks(page)).toEqual([]);
      // Static fallbacks: the CSS aurora, the terminal row and the plain receipt panel.
      await expect(page.locator('.hero-aurora')).toBeAttached();
      await expect(page.getByTestId('terminal-band').getByRole('listitem')).toHaveCount(5);
      await expect(page.getByText('REVIEW RECEIPT', { exact: true })).toBeVisible();
    });
  }

  test('home follows the prototype section order', async ({ page }) => {
    // Static fallbacks only: the desktop SplitText adds an sr-only copy that changes textContent.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('main h1, main h2, [data-testid="terminal-band"]')].map((el) =>
        el.matches('[data-testid]') ? 'terminals' : el.textContent?.trim(),
      ),
    );
    const want = [
      'The verified edge, for sale.',
      'terminals',
      'Trending this week',
      'Find your edge',
      'Four steps, no surprises.',
      'Top creators this month',
      'Hold $TRENCH, pay less.',
      "Built so you don't have to trust anyone.",
      'Have an edge? Sell it.',
    ];
    const seen = order.filter((entry): entry is string => !!entry && want.includes(entry));
    expect([...new Set(seen)]).toEqual(want);
  });
});

test.describe('phase 6b: home cards', () => {
  test('tier cards show each buyer fee with OG at 0%', async ({ page }) => {
    await page.goto('/');
    const cards = page.getByTestId('tier-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toContainText('No tier');
    await expect(cards.first()).toContainText('5%');
    await expect(cards.last()).toContainText('OG');
    await expect(cards.last()).toContainText('0%');
    await expect(cards.last()).toContainText('0% creator commission');
  });
});
