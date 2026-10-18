import { expect, test, type Page } from '@playwright/test';

// New listing form: category templates, Markdown editor (toolbar, shortcuts, live preview),
// image gallery, and the submit flow that saves the page and sends it to review.
// The CI e2e job runs without the API, so /api/v1 is stubbed in the browser.

const SESSION = {
  user: {
    id: 'c1',
    wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
    handle: 'maker',
    roles: [],
  },
  tier: 'none',
};
const CONFIG = {
  feeBps: 500,
  tierRebateBps: { none: 0, scout: 2500, trencher: 6000, og: 10000 },
  tierThresholds: { scout: '100000', trencher: '1000000', og: '10000000' },
  tierWindowHours: 72,
  feeSplitBps: { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 },
  escrowHours: 1,
  verificationFeeLamports: '0',
  bondLamportsByCategory: { userscript: '5000000000' },
  terminals: ['Axiom'],
};
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

type Call = { method: string; path: string; body: string };

async function stub(page: Page) {
  const calls: Call[] = [];
  let imageN = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    calls.push({ method, path, body: method === 'GET' ? '' : (request.postData() ?? '') });
    if (path === '/me') return route.fulfill({ json: SESSION });
    if (path === '/config/public') return route.fulfill({ json: CONFIG });
    if (path === '/studio/listings' && method === 'POST')
      return route.fulfill({ json: { id: 'new-listing-1' } });
    if (path === '/studio/listings/new-listing-1/images' && method === 'POST') {
      imageN += 1;
      return route.fulfill({ json: { id: `0000000${imageN}-aaaa-4bbb-8ccc-dddddddddddd` } });
    }
    if (path.startsWith('/studio/listings/new-listing-1/content'))
      return route.fulfill({ json: { ok: true } });
    if (path.startsWith('/studio')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return calls;
}

const editor = (page: Page) => page.getByTestId('md-editor');
const preview = (page: Page) => page.getByTestId('md-preview');

test('starts from the category template and follows category changes until edited', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/studio/listings/new');
  await expect(page.getByTestId('template-note')).toContainText('Userscripts');
  await expect(editor(page)).toHaveValue(/^# \[Script name\]/);
  await expect(page.getByRole('tab', { name: /README/ })).toContainText('●');

  await page.locator('#category').selectOption('wallet_list');
  await expect(editor(page)).toHaveValue(/^# \[List name\]/);
  await page.getByRole('tab', { name: /How to use/ }).click();
  await expect(editor(page)).not.toHaveValue('');

  // Start blank, then Reset to template.
  await page.getByRole('button', { name: 'Start blank' }).click();
  await expect(editor(page)).toHaveValue('');
  await expect(page.getByRole('tab', { name: /How to use/ })).toContainText('○');
  await expect(page.getByTestId('md-counter')).toContainText(/^0 \//);
  await page.getByRole('button', { name: 'Reset to template' }).click();
  await expect(editor(page)).not.toHaveValue('');
  await expect(page.getByRole('button', { name: 'Reset to template' })).toBeDisabled();

  // An edited section stays when the category changes.
  await page.getByRole('tab', { name: /README/ }).click();
  await editor(page).fill('# My own README');
  await page.locator('#category').selectOption('filter');
  await expect(editor(page)).toHaveValue('# My own README');
});

test('toolbar, shortcuts and live preview', async ({ page }) => {
  await stub(page);
  await page.goto('/studio/listings/new');
  await editor(page).fill('hello world');
  await editor(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(editor(page)).toHaveValue('**hello** world');
  await expect(preview(page).locator('strong')).toHaveText('hello');

  await editor(page).fill('code');
  await editor(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 4));
  await editor(page).press('ControlOrMeta+e');
  await expect(editor(page)).toHaveValue('`code`');
  await expect(preview(page).locator('code')).toHaveText('code');

  await editor(page).fill('Title');
  await editor(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await page.getByRole('button', { name: 'Heading', exact: true }).click();
  await expect(editor(page)).toHaveValue('## Title');
  await expect(preview(page).getByRole('heading', { name: 'Title' })).toBeVisible();

  // Raw HTML is shown as text, never rendered.
  await editor(page).fill('<script>alert(1)</script>');
  await expect(preview(page).locator('script')).toHaveCount(0);
});

test('gallery: add, reorder, alt text, insert into README with preview', async ({ page }) => {
  await stub(page);
  await page.goto('/studio/listings/new');
  await page.locator('#images').setInputFiles([png('one.png'), png('two.png')]);
  const grid = page.getByTestId('image-grid');
  await expect(grid.locator('li')).toHaveCount(2);
  await page.getByLabel('Alt text for image 1').fill('first shot');
  await grid.locator('li').nth(0).getByRole('button', { name: 'Move right' }).click();
  await expect(page.getByLabel('Alt text for image 2')).toHaveValue('first shot');

  await editor(page).fill('Intro\n\n');
  await editor(page).evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await page.getByRole('button', { name: /Image/ }).click();
  await page.getByRole('menuitem', { name: 'Insert image 1' }).click();
  await expect(editor(page)).toHaveValue(/!\[.*\]\(\/api\/v1\/media\/[0-9a-f-]{36}\)/);
  await expect(preview(page).locator('img')).toHaveCount(1);

  // Wrong types are refused with a message.
  await page
    .locator('#images')
    .setInputFiles([{ name: 'x.gif', mimeType: 'image/gif', buffer: PNG }]);
  await expect(page.getByText('x.gif: PNG, JPEG or WebP only.')).toBeVisible();
});

test('submit creates the listing, uploads images, saves the page with real media ids and sends it to review', async ({
  page,
}) => {
  const calls = await stub(page);
  await page.goto('/studio/listings/new');
  await page.fill('#title', 'Trojan Trenches Intel');
  await page.fill('#summary', 'Labels copycat coins and finds the OG.');
  await page.fill('#description', 'Userscript for trojan.com.');
  await page.fill('#terminals', 'Trojan');
  await page.fill('#price', '0.10');
  await page.locator('#images').setInputFiles([png('one.png')]);
  await editor(page).fill('Intro\n\n');
  await editor(page).evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await page.getByRole('button', { name: /Image/ }).click();
  await page.getByRole('menuitem', { name: 'Insert image 1' }).click();
  await page
    .locator('form[data-testid="studio"]')
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.waitForURL('**/studio');

  const create = calls.find((c) => c.method === 'POST' && c.path === '/studio/listings')!;
  expect(JSON.parse(create.body)).toMatchObject({
    title: 'Trojan Trenches Intel',
    terminals: ['Trojan'],
    priceLamports: '100000000',
  });
  expect(calls.filter((c) => c.path === '/studio/listings/new-listing-1/images')).toHaveLength(1);
  const put = calls.find(
    (c) => c.method === 'PUT' && c.path === '/studio/listings/new-listing-1/content',
  )!;
  const saved = JSON.parse(put.body);
  expect(saved.readme).toContain('/api/v1/media/00000001-aaaa-4bbb-8ccc-dddddddddddd');
  expect(saved.coverImageId).toBe('00000001-aaaa-4bbb-8ccc-dddddddddddd');
  expect(saved.gallery).toEqual([{ imageId: '00000001-aaaa-4bbb-8ccc-dddddddddddd', alt: '' }]);
  expect(
    calls.some(
      (c) => c.method === 'POST' && c.path === '/studio/listings/new-listing-1/content/review',
    ),
  ).toBe(true);
});

test('mobile: Write / Preview tabs and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/studio/listings/new');
  const view = page.getByRole('tablist', { name: 'View' });
  await expect(view).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await view.getByRole('tab', { name: 'Preview' }).click();
  await expect(preview(page)).toBeVisible();
  await expect(editor(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// Uploads are re-encoded to WebP by the API (perf: a 354 KB PNG cover made LCP 7.1 s).
// The media the README points at is served as image/webp and must render in the page.
const WEBP_1PX = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
  'base64',
);

test('inserted images are served as WebP and render in the preview', async ({ page }) => {
  await stub(page);
  await page.route('**/api/v1/media/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/webp', body: WEBP_1PX }),
  );
  await page.goto('/studio/listings/new');
  await page.locator('#images').setInputFiles([png('one.png')]);
  await editor(page).fill('Intro\n\n');
  await editor(page).evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await page.getByRole('button', { name: /Image/ }).click();
  await page.getByRole('menuitem', { name: 'Insert image 1' }).click();
  const img = preview(page).locator('img');
  await expect(img).toHaveCount(1);
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBe(1);
});

test('large PNG covers are converted to WebP (max 1600 px) in the browser before upload', async ({
  page,
}) => {
  await stub(page);
  const uploads: { type: string; size: number }[] = [];
  await page.route('**/api/v1/studio/listings/new-listing-1/images', async (route) => {
    const body = route.request().postDataBuffer();
    uploads.push({
      type: route.request().headers()['content-type'] ?? '',
      size: body?.length ?? 0,
    });
    const head = body?.subarray(0, 12).toString('latin1') ?? '';
    expect(head.startsWith('RIFF') && head.endsWith('WEBP')).toBe(true);
    await route.fulfill({ json: { id: '00000009-aaaa-4bbb-8ccc-dddddddddddd' } });
  });
  await page.goto('/studio/listings/new');
  // A 2400x1200 PNG with detail, made in the page.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1200;
    const g = c.getContext('2d')!;
    for (let x = 0; x < 2400; x += 6)
      for (let y = 0; y < 1200; y += 6) {
        g.fillStyle = `rgb(${x % 255},${(x * y) % 255},${y % 255})`;
        g.fillRect(x, y, 6, 6);
      }
    return c.toDataURL('image/png');
  });
  const png = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  await page.fill('#title', 'Trojan Trenches Intel');
  await page.fill('#summary', 'Labels copycat coins and finds the OG.');
  await page.fill('#description', 'Userscript for trojan.com.');
  await page.fill('#terminals', 'Trojan');
  await page.fill('#price', '0.10');
  await page
    .locator('#images')
    .setInputFiles([{ name: 'cover.png', mimeType: 'image/png', buffer: png }]);
  await page
    .locator('form[data-testid="studio"]')
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]!.type).toBe('image/webp');
  expect(uploads[0]!.size).toBeLessThan(png.length);
});
