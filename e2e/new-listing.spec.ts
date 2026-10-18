import { expect, test, type Page } from '@playwright/test';
import { expectTerminalLogo } from './terminal-logo-helpers';

// New-listing wizard: type picker, type-specific step, details with the template editor,
// media, pricing (real median only), file pre-check, review and submit. The CI e2e job runs
// without the API, so /api/v1 is stubbed in the browser and the wallet is the test signer.

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
  verificationFeeLamports: '250000000',
  bondLamportsByCategory: { userscript: '0', wallet_list: '0' },
  terminals: ['Axiom'],
  updateFreeDays: 30,
  updatePriceDefaultBps: 1000,
};
const REQ = {
  xLinked: true,
  bondActive: '0',
  bondOk: true,
  verificationFee: '0',
  feeWaived: false,
  bondByCategory: CONFIG.bondLamportsByCategory,
};
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });
const SCRIPT = Buffer.from(
  '// ==UserScript==\n// @name Intel\n// @match https://axiom.trade/*\n// @grant none\n// ==/UserScript==\nconsole.log(1)\n',
);

type Call = { method: string; path: string; search: string; body: string };

async function stub(
  page: Page,
  opts: { req?: Partial<typeof REQ>; peers?: string[]; signer?: boolean } = {},
) {
  const calls: Call[] = [];
  let imageN = 0;
  await page.route('**/uploads/**', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    calls.push({
      method,
      path,
      search: url.search,
      body: method === 'GET' ? '' : (request.postData() ?? ''),
    });
    if (path === '/me') return route.fulfill({ json: SESSION });
    if (path === '/config/public') return route.fulfill({ json: CONFIG });
    if (path === '/studio/requirements') return route.fulfill({ json: { ...REQ, ...opts.req } });
    if (path === '/categories') return route.fulfill({ json: [{ code: 'userscript', count: 4 }] });
    if (path === '/listings')
      return route.fulfill({ json: (opts.peers ?? []).map((price) => ({ price })) });
    if (path === '/studio/listings' && method === 'POST')
      return route.fulfill({ json: { id: 'new-listing-1' } });
    if (path === '/studio/listings/new-listing-1/images' && method === 'POST') {
      imageN += 1;
      return route.fulfill({ json: { id: `0000000${imageN}-aaaa-4bbb-8ccc-dddddddddddd` } });
    }
    if (path.startsWith('/studio/listings/new-listing-1/content'))
      return route.fulfill({ json: { ok: true } });
    if (path === '/studio/listings/new-listing-1/versions' && method === 'POST')
      return route.fulfill({
        json: { versionId: 'V1', uploadUrl: '/uploads/V1?sig=abc', feeTx: null },
      });
    if (path.startsWith('/studio')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nf' } } });
  });
  return calls;
}

const editor = (page: Page) => page.getByTestId('md-editor');
const preview = (page: Page) => page.getByTestId('md-preview');
const next = (page: Page) => page.getByTestId('continue').click();

async function pickScript(page: Page) {
  await page.goto('/studio/listings/new');
  await page.getByTestId('kind-script').click();
  await next(page);
  await page.getByTestId('terminals').getByRole('button', { name: /Axiom/ }).click();
  await next(page);
}

async function fillDetails(page: Page) {
  await page.fill('#title', 'Trojan Trenches Intel');
  await page.fill('#summary', 'Labels copycat coins and finds the OG.');
  await page.fill('#description', 'Userscript for axiom.trade.');
}

test('step 1 picks the type; step 2 asks for terminals and what the script touches', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/studio/listings/new');
  await expect(page.getByRole('heading', { name: 'What are you selling?' })).toBeVisible();
  await expect(page.getByTestId('kind-script')).toContainText('4 live in this category');
  await next(page);
  await expect(page.getByTestId('step-problem')).toHaveText('Pick what you are selling.');
  await page.getByTestId('kind-script').click();
  await expect(page.getByTestId('kind-script')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('continue')).toHaveText('Continue: terminals →');
  await next(page);

  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', '2');
  await next(page);
  await expect(page.getByTestId('step-problem')).toContainText('terminal');
  const terms = page.getByTestId('terminals');
  await terms.getByRole('button', { name: /Axiom/ }).click();
  await terms.getByRole('button', { name: /GMGN/ }).click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await terms.getByRole('button', { name: /Any site/ }).click();
  await expect(terms.getByRole('button', { name: /Axiom/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await terms.getByRole('button', { name: /Axiom/ }).click();
  await expect(terms.getByRole('button', { name: /Any site/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await page
    .getByRole('radiogroup', { name: 'Network requests' })
    .getByRole('radio', { name: 'Listed hosts' })
    .click();
  await next(page);
  await expect(page.getByTestId('step-problem')).toHaveText('List every host the script calls.');
  await page.getByLabel('Add host').fill('api.axiom.trade');
  await page.getByLabel('Add host').press('Enter');
  await expect(page.getByText('Calls listed hosts: api.axiom.trade')).toBeVisible();
  await expect(page.getByText('Keys and signing')).toBeVisible();
  await next(page);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', '3');
});

test("terminal cards show each terminal's own logo, served locally", async ({ page }) => {
  await stub(page);
  await page.goto('/studio/listings/new');
  await page.getByTestId('kind-script').click();
  await next(page);
  await expect(
    page.getByRole('heading', { name: 'Which terminals does it run on?' }),
  ).toBeVisible();
  const terms = page.getByTestId('terminals');
  const logos = {
    Axiom: '/terminals/axiom.svg',
    GMGN: '/terminals/gmgn.png',
    Photon: '/terminals/photon.png',
    Terminal: '/terminals/terminal.svg',
    Trojan: '/terminals/trojan.png',
  };
  for (const [name, src] of Object.entries(logos)) {
    const card = terms.getByRole('button', { name: new RegExp(name) });
    const img = card.getByTestId(`terminal-logo-${name}`);
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', src);
    // Loaded and decoded, not a broken image.
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    const box = await img.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(30);
    // No letter placeholder left in the tile.
    await expect(card.locator('[aria-hidden="true"]').first()).toHaveText('');
  }
  await expect(terms.locator('img')).toHaveCount(5);
  await expect(page.getByText('TrenchMart is not affiliated with these terminals')).toBeVisible();
  // The live card preview in the studio shows the picked terminals with their logos too.
  await terms.getByRole('button', { name: /Photon/ }).click();
  await terms.getByRole('button', { name: /Trojan/ }).click();
  const previewLine = page.getByTestId('card-preview').getByTestId('card-terminals');
  await expect(previewLine).toHaveText('Photon · Trojan');
  await expectTerminalLogo(previewLine, 'Photon', 14);
  await expectTerminalLogo(previewLine, 'Trojan', 14);
  // The asset itself is served by the app (not hotlinked).
  const res = await page.request.get('/terminals/axiom.svg');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('image/svg+xml');
});

test('wallet lists ask for format, cadence and imports; the count comes from the file', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/studio/listings/new');
  await page.getByTestId('kind-wallet').click();
  await expect(page.getByTestId('continue')).toHaveText('Continue: list details →');
  await next(page);
  await expect(page.getByRole('heading', { name: 'Imports into' })).toBeVisible();
  await page
    .getByTestId('terminals')
    .getByRole('button', { name: /Photon/ })
    .click();
  // No manual wallet count: no stepper, no input, no "How many wallets" prompt.
  await expect(page.getByLabel('Wallet count')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Fewer wallets|More wallets/ })).toHaveCount(0);
  await expect(page.getByText('How many wallets the file holds')).toHaveCount(0);
  await expect(page.getByTestId('wallet-count-auto')).toContainText('verified count');
  await expect(page.getByTestId('wizard').locator('input[inputmode="numeric"]')).toHaveCount(0);
  await page.getByRole('radio', { name: /Daily/ }).click();
  await page.getByRole('button', { name: /\.json/ }).click();
  const spec = page.getByText('Spec buyers see').locator('..');
  await expect(spec).not.toContainText('Wallets');
  await expect(spec).toContainText('CSV, JSON');
  await expect(spec).toContainText('Daily');
  await expect(spec).toContainText('Photon');
});

test('the guide starts from the type template and follows type changes until edited', async ({
  page,
}) => {
  await stub(page);
  await pickScript(page);
  await expect(page.getByTestId('template-note')).toContainText('Userscripts');
  await expect(page.getByTestId('template-note')).toContainText('[bracketed] parts left');
  await expect(editor(page)).toHaveValue(/^# \[Script name\]/);

  // Back to step 1, switch to a wallet list: untouched sections follow.
  await page
    .getByTestId('stepper')
    .getByRole('button', { name: /What you sell/ })
    .click();
  await page.getByTestId('kind-wallet').click();
  await page
    .getByTestId('stepper')
    .getByRole('button', { name: /Details/ })
    .click();
  await expect(editor(page)).toHaveValue(/^# \[List name\]/);

  await editor(page).fill('# My own README');
  await page
    .getByTestId('stepper')
    .getByRole('button', { name: /What you sell/ })
    .click();
  await page.getByTestId('kind-filter').click();
  await page
    .getByTestId('stepper')
    .getByRole('button', { name: /Details/ })
    .click();
  await expect(editor(page)).toHaveValue('# My own README');

  await page.getByRole('button', { name: 'Start blank' }).click();
  await expect(editor(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Reset to template' }).click();
  await expect(editor(page)).not.toHaveValue('');
});

test('toolbar, shortcuts and live preview', async ({ page }) => {
  await stub(page);
  await pickScript(page);
  await editor(page).fill('hello world');
  await editor(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(editor(page)).toHaveValue('**hello** world');
  await expect(preview(page).locator('strong')).toHaveText('hello');
  await editor(page).fill('code');
  await editor(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 4));
  await editor(page).press('ControlOrMeta+e');
  await expect(editor(page)).toHaveValue('`code`');
  await editor(page).fill('<script>alert(1)</script>');
  await expect(preview(page).locator('script')).toHaveCount(0);
});

test('pricing: the median shows only with three real listings; updates timeline and earnings', async ({
  page,
}) => {
  await stub(page, { peers: ['500000000', '900000000', '2000000000'] });
  await pickScript(page);
  await fillDetails(page);
  await next(page);
  await next(page);
  await expect(page.getByRole('heading', { name: 'One-time price' })).toBeVisible();
  await expect(page.getByTestId('price-median')).toContainText('median 0.90 SOL · 3 listings');
  await next(page);
  await expect(page.getByTestId('step-problem')).toHaveText('Set a price in SOL.');
  await page.fill('#price', '1.2');
  await expect(page.locator('#update-price')).toHaveValue('0.12');
  await expect(
    page.getByText('First 30 days of updates are free with every purchase'),
  ).toBeVisible();
  await expect(page.getByText('Renews at 0.12 SOL/mo')).toBeVisible();
  await expect(page.getByTestId('earnings')).toContainText('+ 0.06 SOL');
  await expect(page.getByTestId('earnings')).toContainText('after each 1 h escrow releases');
  await page.getByRole('switch', { name: 'Paid updates' }).click();
  await expect(
    page.getByText('Off: every buyer gets every future version free, forever.'),
  ).toBeVisible();
});

test('pricing: no median with fewer than three listings', async ({ page }) => {
  await stub(page, { peers: ['500000000'] });
  await pickScript(page);
  await fillDetails(page);
  await next(page);
  await next(page);
  await expect(page.getByRole('heading', { name: 'One-time price' })).toBeVisible();
  await expect(page.getByTestId('price-median')).toHaveCount(0);
});

test('submit: creates the listing with kind and specs, uploads images, file and opens the review', async ({
  page,
}) => {
  const calls = await stub(page);
  await pickScript(page);
  await fillDetails(page);
  await next(page);
  await page.locator('#images').setInputFiles([png('one.png')]);
  await page.getByLabel('Alt text for image 1').fill('overlay');
  await page
    .getByTestId('stepper')
    .getByRole('button', { name: /Details/ })
    .click();
  await editor(page).fill('Intro\n\n');
  await editor(page).evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await page.getByRole('button', { name: /Image/ }).click();
  await page.getByRole('menuitem', { name: 'Insert image 1' }).click();
  await next(page);
  await next(page);
  await page.fill('#price', '0.10');
  await next(page);
  await next(page);
  await expect(page.getByTestId('step-problem')).toHaveText('Add the file buyers download.');
  await page
    .locator('#file')
    .setInputFiles({ name: 'intel.user.js', mimeType: 'text/javascript', buffer: SCRIPT });
  const summary = page.getByTestId('file-summary');
  await expect(summary).toContainText('@name Intel');
  await expect(summary).toContainText('@match: 1 line');
  await expect(summary).toContainText(/sha256 [0-9a-f]{6}…/);
  await next(page);

  const review = page.getByTestId('review');
  await expect(review).toContainText('Terminal script');
  await expect(review).toContainText('Axiom');
  await expect(page.getByTestId('submit-card')).toContainText('Verification fee0.00 SOL');
  await expect(page.getByTestId('submit')).toBeDisabled();
  await page.getByText('The file does what this listing says').click();
  await page.getByTestId('submit').click();
  await page.waitForURL('**/studio/listings/new-listing-1/versions/V1');

  const create = JSON.parse(
    calls.find((c) => c.method === 'POST' && c.path === '/studio/listings')!.body,
  );
  expect(create).toMatchObject({
    title: 'Trojan Trenches Intel',
    category: 'userscript',
    kind: 'script',
    terminals: ['Axiom'],
    priceLamports: '100000000',
    updatePriceLamports: '10000000',
    specs: { managers: ['Tampermonkey', 'Violentmonkey'], network: 'terminal', storage: 'local' },
  });
  const put = calls.find(
    (c) => c.method === 'PUT' && c.path === '/studio/listings/new-listing-1/content',
  )!;
  const saved = JSON.parse(put.body);
  expect(saved.readme).toContain('/api/v1/media/00000001-aaaa-4bbb-8ccc-dddddddddddd');
  expect(saved.gallery).toEqual([
    { imageId: '00000001-aaaa-4bbb-8ccc-dddddddddddd', alt: 'overlay' },
  ]);
  expect(
    JSON.parse(calls.find((c) => c.path === '/studio/listings/new-listing-1/versions')!.body),
  ).toEqual({
    semver: '1.0.0',
    changelog: 'initial',
    fileName: 'intel.user.js',
    fileSize: SCRIPT.length,
  });
  // The draft is cleared after a successful submit.
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('tm:new-listing:')),
    ),
  ).toEqual([]);
});

test('review: an unverified creator (no X) with the bond can submit; X is a gentle optional nudge', async ({
  page,
}) => {
  await stub(page, { req: { xLinked: false, verificationFee: '250000000' } });
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, step: 7, kind: 'script', terminals: ['Axiom'] }),
    );
  }, `tm:new-listing:${SESSION.user.wallet}:review-draft`);
  await page.goto('/studio/listings/new?draft=review-draft');
  await expect(page.getByTestId('x-required')).toHaveCount(0);
  await expect(page.getByTestId('x-optional')).toContainText('Optional: verify with X');
  await expect(
    page.getByTestId('x-optional').getByRole('link', { name: 'Verify with X →' }),
  ).toHaveAttribute('href', '/studio/profile#socials');
  await expect(page.getByTestId('submit-card')).toContainText('0.25 SOL');
  await expect(page.getByTestId('submit')).toBeDisabled();
  await page.getByText('The file does what this listing says').click();
  await expect(page.getByTestId('submit')).toBeEnabled();
  if (process.env.X_OPTIONAL_SHOTS) {
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByTestId('submit-card').screenshot({
      path: `${process.env.X_OPTIONAL_SHOTS}/wizard-submit-no-x.png`,
    });
  }
});

test('the draft survives a reload on this device', async ({ page }) => {
  await stub(page);
  await pickScript(page);
  await page.fill('#title', 'Kept title');
  await expect(page.getByTestId('draft-status')).toContainText('Draft saved on this device');
  await expect
    .poll(() => page.evaluate(() => Object.values(localStorage).join('')))
    .toContain('Kept title');
  await page.reload();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', '3');
  await expect(page.locator('#title')).toHaveValue('Kept title');
});

test('a fresh "New listing" starts on step 1 with nothing chosen, even with a saved draft', async ({
  page,
}) => {
  await stub(page);
  const prefix = `tm:new-listing:${SESSION.user.wallet}`;
  // An abandoned draft (old single slot) that had picked a filter pack and reached step 2.
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        step: 2,
        kind: 'filter',
        terminals: [],
        savedAt: '2026-10-18T07:00:00.000Z',
      }),
    );
  }, prefix);
  // The studio's "+ New listing" button links here, with no query.
  await page.goto('/studio/listings/new');
  await expect(page).toHaveURL(/\/studio\/listings\/new$/);
  const wizard = page.getByTestId('wizard');
  await expect(wizard).toHaveAttribute('data-step', '1');
  await expect(page.locator('[data-testid^="kind-"][aria-checked="true"]')).toHaveCount(0);
  const stepper = page.getByTestId('stepper');
  await expect(stepper.getByRole('button').first()).toHaveAttribute('aria-current', 'step');
  await expect(stepper).not.toContainText('Done');
  // Opening the page stores nothing new, and the old draft is offered, not opened.
  const resume = page.getByTestId('resume-draft');
  await expect(resume).toContainText('Filter');
  await expect(resume).toContainText('step 2 of');
  if (process.env.WIZARD_SHOTS)
    await page.screenshot({ path: `${process.env.WIZARD_SHOTS}/new-listing-fresh-step1.png` });
  expect(
    await page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)), prefix),
  ).toEqual([`${prefix}:legacy`]);

  // Resuming restores that draft (and its step), only on request.
  await resume.getByRole('link', { name: 'Resume it →' }).click();
  await expect(page).toHaveURL(/\?draft=legacy$/);
  await expect(wizard).toHaveAttribute('data-step', '2');
  await expect(page.getByText('Filter', { exact: false }).first()).toBeVisible();

  // Starting another new listing is clean again; the new one gets its own slot.
  await page.goto('/studio/listings/new');
  await expect(wizard).toHaveAttribute('data-step', '1');
  await expect(page.locator('[data-testid^="kind-"][aria-checked="true"]')).toHaveCount(0);
  await page.getByTestId('kind-script').click();
  await expect(page).toHaveURL(/\?draft=[0-9a-f-]{36}$/);
  const keys = await page.evaluate(
    (p) => Object.keys(localStorage).filter((k) => k.startsWith(p)),
    prefix,
  );
  expect(keys).toHaveLength(2);
  await page.goto('/studio/listings/new');
  await expect(wizard).toHaveAttribute('data-step', '1');
  await expect(page.locator('[data-testid^="kind-"][aria-checked="true"]')).toHaveCount(0);
});

test('mobile: progress bar instead of the stepper, two-column type cards, no overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/studio/listings/new');
  await expect(page.getByTestId('stepper')).toBeHidden();
  await expect(page.getByTestId('stepper-mobile')).toContainText('Step 1 of 7');
  await page.getByTestId('kind-script').click();
  await next(page);
  await expect(page.getByTestId('stepper-mobile')).toContainText('Terminals');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId('terminals').getByRole('button', { name: /Axiom/ }).click();
  await next(page);
  const view = page.getByRole('tablist', { name: 'View' });
  await expect(view).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
  // Then the phone/card/high-DPI copies, made in the browser (the API cannot re-encode).
  const copies: { width: string; type: string; size: number; head: string }[] = [];
  await page.route(
    '**/api/v1/studio/listings/new-listing-1/images/00000009-aaaa-4bbb-8ccc-dddddddddddd/w/*',
    async (route) => {
      const body = route.request().postDataBuffer();
      copies.push({
        width: route.request().url().split('/').pop()!,
        type: route.request().headers()['content-type'] ?? '',
        size: body?.length ?? 0,
        head: body?.subarray(0, 12).toString('latin1') ?? '',
      });
      await route.fulfill({ json: { stored: true } });
    },
  );
  await pickScript(page);
  await fillDetails(page);
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
  const big = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  await next(page);
  await page
    .locator('#images')
    .setInputFiles([{ name: 'cover.png', mimeType: 'image/png', buffer: big }]);
  await next(page);
  await page.fill('#price', '0.10');
  await next(page);
  await page
    .locator('#file')
    .setInputFiles({ name: 'intel.user.js', mimeType: 'text/javascript', buffer: SCRIPT });
  await expect(page.getByTestId('file-summary')).toBeVisible();
  await next(page);
  await page.getByText('The file does what this listing says').click();
  await page.getByTestId('submit').click();
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]!.type).toBe('image/webp');
  expect(uploads[0]!.size).toBeLessThan(big.length);
  // Each width narrower than the upload, skipping any copy that would not be smaller (this
  // noisy test art barely compresses; a real photo gets all three).
  await expect.poll(() => copies[0]?.width).toBe('480');
  expect(copies.map((c) => c.width).every((w) => ['480', '960', '1200'].includes(w))).toBe(true);
  for (const copy of copies) {
    expect(copy.type).toBe('image/webp');
    expect(copy.head.startsWith('RIFF') && copy.head.endsWith('WEBP')).toBe(true);
    expect(copy.size).toBeLessThan(uploads[0]!.size);
  }
});
