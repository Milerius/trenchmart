import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const PNG = readFileSync(new URL('../packages/scanner/src/__fixtures__/meta.png', import.meta.url));
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

// Payloads a seller could paste into a README. None may run, inject markup, or hotlink.
const XSS = [
  '<script>window.__xss = 1</script>',
  '<img src=x onerror="window.__xss = 2">',
  '<svg/onload=window.__xss=3>',
  '[click](javascript:window.__xss=4)',
  '[click2](JaVaScRiPt:window.__xss=5)',
  '[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '![remote](https://evil.example/track.png)',
  '<iframe src="https://evil.example"></iframe>',
  '<a href="https://evil.example" onclick="window.__xss=6">raw anchor</a>',
].join('\n\n');

const README = `# Rich Pack\n\nFlags bundles. See [the docs](https://example.com/docs).\n\n${XSS}`;
const gallery = [1, 2, 3].map((n) => ({
  id: ID(n),
  url: `/api/v1/media/${ID(n)}`,
  alt: `Screenshot ${n}`,
  width: 32,
  height: 32,
}));
const card = {
  id: ID(9),
  slug: 'rich-pack',
  title: 'Rich Pack',
  summary: 'Flags bundled launches.',
  category: 'userscript',
  terminals: ['Axiom'],
  price: '1000000000',
  handle: 'rugradar',
  sales7d: 3,
  ratingAvg: '4.90',
  cover: { url: gallery[0]!.url, alt: 'Rich Pack cover' },
  imageCount: 3,
};
const listing = {
  ...card,
  description: 'Overlay.',
  license: 'single',
  holderOnly: false,
  ratingCount: 1,
  creator: {
    handle: 'rugradar',
    wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
    bondLamports: '1000000000',
  },
  preview: '// ==UserScript==',
  security: null,
  content: {
    readme: README,
    howto: '1. Install Tampermonkey\n2. Open the file',
    requirements: 'Chrome 120+',
    gallery,
  },
};

async function stub(page: Page, opts: { studio?: unknown } = {}) {
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('evil.example')) external.push(request.url());
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.startsWith('/media/'))
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (path === '/me') {
      return opts.studio
        ? json({
            user: {
              id: 'u1',
              wallet: listing.creator.wallet,
              handle: 'rugradar',
              roles: ['creator'],
            },
            tier: 'none',
          })
        : json({ error: { code: 'UNAUTHORIZED', message: 'sign in' } }, 401);
    }
    if (path === '/prices/sol')
      return json({ centsPerSol: '10000', source: 'live', fetchedAt: new Date().toISOString() });
    if (path === '/listings')
      return json([
        card,
        { ...card, id: ID(8), slug: 'no-cover', title: 'No Cover', cover: null, imageCount: 0 },
      ]);
    if (path === '/listings/rich-pack') return json(listing);
    if (path === '/listings/rich-pack/versions')
      return json([
        {
          semver: '1.0.0',
          changelog: 'First [release](javascript:window.__xss=7)',
          created_at: '2026-10-17T08:00:00Z',
          status: 'live',
        },
      ]);
    if (path === '/listings/rich-pack/reviews') return json([]);
    if (path === `/studio/listings/${ID(9)}/content`) return json(opts.studio);
    return route.fallback();
  });
  return external;
}

async function expectNoInjection(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
  const md = page.getByTestId('markdown').first();
  await expect(md.locator('script, iframe, svg, [onerror], [onclick], [onload]')).toHaveCount(0);
  const hrefs = await md
    .locator('a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  for (const href of hrefs) expect(href).toMatch(/^(https?:|mailto:|#|\/)/);
}

test('listing page: overview default, safe README, gallery lightbox, tabs', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const external = await stub(page);
  await page.goto('/l/rich-pack');
  await expect(page.getByRole('heading', { name: 'Rich Pack', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('markdown').first()).toContainText(
    '<script>window.__xss = 1</script>',
  );
  await expect(page.getByText(/External image removed/)).toBeVisible();
  const docs = page.getByRole('link', { name: 'the docs' });
  await expect(docs).toHaveAttribute('rel', /noopener/);
  await expect(docs).toHaveAttribute('rel', /nofollow/);
  await expectNoInjection(page);

  await page.getByTestId('gallery-hero').click();
  const box = page.getByTestId('lightbox');
  await expect(box).toBeVisible();
  await expect(box).toContainText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(box).toContainText('2 / 3');
  await page.getByRole('button', { name: 'Next image' }).click();
  await expect(box).toContainText('3 / 3');
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();

  await page.getByRole('tab', { name: 'How to use' }).click();
  await expect(page.getByText('Install Tampermonkey')).toBeVisible();
  await expect(page.getByText('Chrome 120+')).toBeVisible();
  await page.getByRole('tab', { name: 'Changelog' }).click();
  await expect(page.getByText('1.0.0')).toBeVisible();
  await expect(page.getByRole('link', { name: 'release' })).toHaveCount(0);

  expect(dialogs).toEqual([]);
  expect(external).toEqual([]);
});

test('market cards show the 16:10 cover or the category fallback', async ({ page }) => {
  await stub(page);
  await page.goto('/search');
  const covers = page.getByTestId('card-cover');
  await expect(covers).toHaveCount(2);
  // The cover image itself (the terminal chip on top of the cover has its own small logo).
  await expect(covers.first().getByTestId('card-cover-img')).toHaveAttribute(
    'src',
    gallery[0]!.url,
  );
  await expect(covers.nth(1).getByTestId('card-cover-img')).toHaveCount(0);
  const ratio = await covers.first().evaluate((el) => el.clientWidth / el.clientHeight);
  expect(ratio).toBeCloseTo(1.6, 1);
});

test('studio editor previews Markdown safely and explains findings', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const external = await stub(page, {
    studio: {
      listing: card,
      status: 'needs_changes',
      draft: {
        readme: README,
        howto: '',
        requirements: '',
        gallery: gallery.map((g) => ({ imageId: g.id, alt: g.alt })),
        coverImageId: ID(1),
      },
      images: gallery.map((g) => ({ ...g, bytes: 1000 })),
      checks: [
        {
          ruleId: 'content-link-hygiene',
          result: 'warn',
          title: 'Link hygiene',
          detail: 'http link',
        },
      ],
      review: {
        decision: 'request_changes',
        notes: 'Automated verification needs a real explanation.',
      },
    },
  });
  await page.goto(`/studio/listings/${ID(9)}/content`);
  await expect(page.getByTestId('md-editor')).toHaveValue(README);
  await expect(page.getByTestId('md-preview')).toContainText('Rich Pack');
  await expect(page.getByTestId('content-findings')).toContainText('Link hygiene');
  await expect(page.getByTestId('content-note')).toBeVisible();
  await page.getByTestId('md-editor').fill('# Edited\n\n<img src=x onerror="window.__xss=9">');
  await expect(page.getByTestId('md-preview')).toContainText('Edited');
  await expectNoInjection(page);
  expect(dialogs).toEqual([]);
  expect(external).toEqual([]);
});
