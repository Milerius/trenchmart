import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

// Seller updates, buyer update entitlement, daily limits and SOL supplements (2026-10-18).
// The CI e2e job has no API or RPC, so /api/v1 is stubbed in the browser and the wallet is the
// test signer (window.__TRENCHMART_E2E_SECRET__). Each test checks the exact requests sent.

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as {
  encode: (bytes: Uint8Array) => string;
  decode: (text: string) => Uint8Array;
};
const web3 = require('@solana/web3.js') as typeof import('@solana/web3.js');

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
  updateFreeDays: 30,
  updatePeriodDays: 30,
  updatePriceDefaultBps: 1000,
  updateLimitPerListingDay: 1,
  uploadLimitPerCreatorDay: 5,
  uploadSupplementLamports: '50000000',
  verifyFreePerDay: 1,
  verifySupplementLamports: '10000000',
};

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => { status?: number; json: unknown } | undefined;

function wallet() {
  const pair = nacl.sign.keyPair();
  return { secret: bs58.encode(pair.secretKey), address: bs58.encode(pair.publicKey) };
}

function unsignedTx(payer: string): string {
  const key = new web3.PublicKey(payer);
  const tx = new web3.Transaction({
    feePayer: key,
    recentBlockhash: bs58.encode(nacl.randomBytes(32)),
  }).add(
    web3.SystemProgram.transfer({
      fromPubkey: key,
      toPubkey: web3.Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

function expectSignedBy(txBase64: string, address: string) {
  const tx = web3.Transaction.from(Buffer.from(txBase64, 'base64'));
  expect(tx.feePayer?.toBase58()).toBe(address);
  expect(tx.verifySignatures()).toBe(true);
}

async function setup(page: Page, address: string, secret: string | null, handler: Handler) {
  if (secret) {
    await page.addInitScript((value) => {
      (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ =
        value;
    }, secret);
  }
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
      /* not JSON */
    }
    const call = { method: request.method(), path, body };
    calls.push(call);
    const custom = handler(call);
    if (custom) return route.fulfill({ status: custom.status ?? 200, json: custom.json });
    if (path === '/me') {
      if (!secret)
        return route.fulfill({
          status: 401,
          json: { error: { code: 'UNAUTHORIZED', message: 'sign in required' } },
        });
      return route.fulfill({
        json: {
          user: { id: 'u1', wallet: address, handle: 'maker', roles: ['creator'] },
          tier: 'none',
        },
      });
    }
    if (path === '/config/public') return route.fulfill({ json: CONFIG });
    if (path === '/prices/sol') return route.fulfill({ json: { centsPerSol: null } });
    if (path === '/tx/send')
      return route.fulfill({ json: { signature: bs58.encode(nacl.randomBytes(64)) } });
    if (path.startsWith('/media/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'not found' } },
    });
  });
  // The upload PUT goes to the signed /files URL.
  await page.route('**/files?**', (route) => route.fulfill({ json: { ok: true, bytes: 10 } }));
  return calls;
}

const LISTING_ID = '11111111-2222-4333-8444-555555555555';
const STUDIO_ROWS = [
  {
    id: LISTING_ID,
    slug: 'trojan-trenches-intel',
    title: 'Trojan Trenches Intel',
    price: '100000000',
    category: 'userscript',
    sales_7d: 3,
    version_status: 'live',
    semver: '1.4.0',
    delisted_at: null,
    update_price: '10000000',
  },
  {
    id: '99999999-2222-4333-8444-555555555555',
    slug: 'draft-pack',
    title: 'Draft Pack',
    price: '100000000',
    category: 'userscript',
    sales_7d: 0,
    version_status: 'in_review',
    semver: null,
    delisted_at: null,
  },
];
const REQUIREMENTS = {
  creator: true,
  xLinked: true,
  bondRequired: '1000000000',
  bondActive: '1000000000',
  bondOk: true,
  verificationFee: '0',
  feeWaived: false,
};

function quota(over: Record<string, unknown> = {}) {
  return {
    listing: {
      id: LISTING_ID,
      slug: 'trojan-trenches-intel',
      title: 'Trojan Trenches Intel',
      updatePrice: '10000000',
    },
    isUpdate: true,
    currentSemver: '1.4.0',
    suggestedSemver: '1.4.1',
    updatesToday: 0,
    uploadsToday: 1,
    limits: { updatesPerListingPerDay: 1, uploadsPerCreatorPerDay: 5 },
    reasons: [],
    supplementLamports: '50000000',
    supplementRequired: false,
    resetsAt: '2026-10-19T00:00:00.000Z',
    verificationFee: '0',
    feeWaived: false,
    versions: [
      { id: 'v-140', semver: '1.4.0', status: 'live', created_at: '2026-10-17T10:00:00Z' },
    ],
    ...over,
  };
}

test('studio: live listings offer "Upload new version"; the form suggests a patch bump and needs a changelog', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (path === '/studio/requirements') return { json: REQUIREMENTS };
    if (path === '/studio/listings') return { json: STUDIO_ROWS };
    if (path === '/studio/payouts')
      return { json: { total: { lamports: '0', usdCents: null }, payouts: [] } };
    if (path === `/studio/listings/${LISTING_ID}/upload-quota`) return { json: quota() };
    if (method === 'POST' && path === `/studio/listings/${LISTING_ID}/versions`) {
      return {
        json: {
          versionId: 'v-141',
          uploadUrl: '/api/v1/files?key=uploads/v-141&exp=1&sig=s',
          feeTx: null,
          supplement: null,
        },
      };
    }
    if (path === '/studio/versions/v-141')
      return {
        json: {
          version: {
            status: 'in_review',
            semver: '1.4.1',
            file_name: 'intel.user.js',
            sha256: 'ab'.repeat(32),
            creator_note: null,
          },
          checks: [],
          review: null,
        },
      };
    return undefined;
  });
  await page.goto('/studio');
  const button = page.getByTestId('upload-new-version');
  // Only the live listing has it.
  await expect(button).toHaveCount(1);
  if (process.env.VERSIONING_SHOTS) {
    await page.screenshot({
      path: `${process.env.VERSIONING_SHOTS}/versioning-studio-upload.png`,
      fullPage: true,
    });
  }
  await expect(button).toHaveAttribute('href', `/studio/listings/${LISTING_ID}/versions/new`);
  await button.click();
  await expect(page).toHaveURL(`/studio/listings/${LISTING_ID}/versions/new`);
  await expect(page.getByRole('heading', { name: 'Upload new version' })).toBeVisible();
  await expect(page.getByLabel('Version')).toHaveValue('1.4.1');
  await expect(page.getByTestId('upload-limits')).toContainText(
    '0 of 1 free update on this listing',
  );
  await expect(page.getByTestId('upload-limits')).toContainText('1 of 5 free uploads');
  await expect(page.getByTestId('supplement-notice')).toHaveCount(0);
  // Changelog is required before anything is sent.
  await page.getByTestId('submit-version').click();
  expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/versions'))).toBe(false);

  await page.getByLabel('Version').fill('1.5.0');
  await page.getByLabel('Changelog').fill('Adds Photon support');
  await page.locator('#file').setInputFiles({
    name: 'intel.user.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from('// ==UserScript==\nconsole.log(2)\n'),
  });
  await page.getByTestId('submit-version').click();
  await expect(page).toHaveURL(`/studio/listings/${LISTING_ID}/versions/v-141`);
  const create = calls.find((c) => c.method === 'POST' && c.path.endsWith('/versions'))!;
  expect(create.body).toEqual({
    semver: '1.5.0',
    changelog: 'Adds Photon support',
    fileName: 'intel.user.js',
    fileSize: 33,
  });
});

test('studio: beyond the daily limit the supplement is shown first, then paid on chain', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (path === `/studio/listings/${LISTING_ID}/upload-quota`)
      return {
        json: quota({
          updatesToday: 1,
          reasons: ['listing_update_limit'],
          supplementRequired: true,
        }),
      };
    if (method === 'POST' && path === `/studio/listings/${LISTING_ID}/versions`) {
      return {
        json: {
          versionId: 'v-142',
          uploadUrl: '/api/v1/files?key=uploads/v-142&exp=1&sig=s',
          feeTx: null,
          supplement: { id: 'sup-1', lamports: '50000000', tx: { txBase64: unsignedTx(address) } },
        },
      };
    }
    if (method === 'POST' && path === '/supplements/sup-1/submitted') return { json: { ok: true } };
    if (path === '/studio/versions/v-142')
      return {
        json: {
          version: {
            status: 'in_review',
            semver: '1.4.1',
            file_name: 'a.user.js',
            sha256: 'cd'.repeat(32),
            creator_note: null,
          },
          checks: [],
          review: null,
        },
      };
    return undefined;
  });
  await page.goto(`/studio/listings/${LISTING_ID}/versions/new`);
  const notice = page.getByTestId('supplement-notice');
  await expect(notice).toContainText('Daily limit reached');
  await expect(notice).toContainText('0.05 SOL');
  await expect(notice).toContainText('already had its free update today');
  await expect(page.getByTestId('submit-version')).toHaveText('Pay supplement and start review');
  await page.getByLabel('Changelog').fill('Hotfix');
  await page
    .locator('#file')
    .setInputFiles({ name: 'a.user.js', mimeType: 'text/javascript', buffer: Buffer.from('x') });
  await page.getByTestId('submit-version').click();
  await expect(page).toHaveURL(`/studio/listings/${LISTING_ID}/versions/v-142`);
  const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
  expect(posts).toEqual([
    `/studio/listings/${LISTING_ID}/versions`,
    '/tx/send',
    '/supplements/sup-1/submitted',
  ]);
  expect(
    calls.find((c) => c.path.endsWith('/versions') && c.method === 'POST')!.body,
  ).toMatchObject({
    acceptSupplementLamports: '50000000',
  });
  expectSignedBy(
    (calls.find((c) => c.path === '/tx/send')!.body as { txBase64: string }).txBase64,
    address,
  );
});

test('studio: the listing page editor has the upload button and the monthly update price', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (path === `/studio/listings/${LISTING_ID}/content`)
      return {
        json: {
          listing: {
            id: LISTING_ID,
            slug: 'trojan-trenches-intel',
            title: 'Trojan Trenches Intel',
            summary: 's',
            category: 'userscript',
            terminals: [],
            price: '100000000',
            liveVersionId: 'v-140',
            updatePrice: '10000000',
            categoryMeta: { label: 'Userscript' },
          },
          status: 'live',
          draft: { readme: '', howto: '', requirements: '', gallery: [], coverImageId: null },
          images: [],
          checks: [],
          review: null,
        },
      };
    if (method === 'PATCH' && path === `/studio/listings/${LISTING_ID}`)
      return { json: { ok: true } };
    return undefined;
  });
  await page.goto(`/studio/listings/${LISTING_ID}/content`);
  const panel = page.getByTestId('versions-panel');
  await expect(panel.getByTestId('upload-new-version')).toHaveAttribute(
    'href',
    `/studio/listings/${LISTING_ID}/versions/new`,
  );
  await expect(panel.getByTestId('update-price')).toHaveValue('0.01');
  await panel.getByTestId('update-price').fill('0');
  await panel.getByRole('button', { name: 'Save price' }).click();
  await expect(panel).toContainText('Saved.');
  await expect(panel).toContainText('free forever');
  expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ updatePriceLamports: '0' });
});

const NOW = Date.now();
function order(updates: Record<string, unknown>) {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    title: 'Trojan Trenches Intel',
    slug: 'trojan-trenches-intel',
    status: 'released',
    tier_at_purchase: 'none',
    amount: { lamports: '105000000', usdCents: null },
    escrow_address: null,
    tx_sig: '5'.repeat(88),
    paid_at: new Date(NOW - 40 * 86_400_000).toISOString(),
    escrow_until: new Date(NOW - 40 * 86_400_000 + 3_600_000).toISOString(),
    released_at: new Date(NOW - 40 * 86_400_000 + 3_600_000).toISOString(),
    cover: null,
    updates: {
      purchased: { id: 'v-100', semver: '1.0.0' },
      current: { id: 'v-100', semver: '1.0.0' },
      latest: { id: 'v-101', semver: '1.0.1', changelog: 'Fixes the copycat badge on Trojan' },
      latestEntitled: { id: 'v-101', semver: '1.0.1' },
      updateAvailable: true,
      entitledToLatest: true,
      changes: [{ semver: '1.0.1', changelog: 'Fixes the copycat badge on Trojan' }],
      updatesUntil: new Date(NOW + 10 * 86_400_000).toISOString(),
      forever: false,
      active: true,
      updatePrice: '10000000',
      renewTotal: '10500000',
      periodDays: 30,
      versions: [
        { id: 'v-101', semver: '1.0.1', purchased: false },
        { id: 'v-100', semver: '1.0.0', purchased: true },
      ],
      ...updates,
    },
  };
}

test('purchases: "Update available" with changelog; download the latest or the exact purchased version', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (path === '/me/orders') return { json: { orders: [order({})] } };
    if (method === 'POST' && path.endsWith('/download'))
      return { json: { url: '/me/purchases#downloaded', semver: '1.0.1' } };
    return undefined;
  });
  await page.goto('/me/purchases');
  await page.getByRole('tab', { name: /Completed/ }).click();
  const banner = page.getByTestId('update-available');
  await expect(banner).toHaveAttribute('data-state', 'included');
  await expect(banner).toContainText('Update available v1.0.0 → v1.0.1');
  await expect(page.getByTestId('update-changelog')).toContainText(
    'Fixes the copycat badge on Trojan',
  );
  if (process.env.VERSIONING_SHOTS) {
    await page
      .getByTestId('order-card')
      .screenshot({ path: `${process.env.VERSIONING_SHOTS}/versioning-purchases-update.png` });
  }
  await expect(page.getByTestId('updates-status')).toContainText('Updates included until');
  await page.getByTestId('download-latest').click();
  await expect.poll(() => calls.filter((c) => c.path.endsWith('/download')).length).toBe(1);
  await page.getByTestId('download-purchased').click();
  await expect.poll(() => calls.filter((c) => c.path.endsWith('/download')).length).toBe(2);
  const bodies = calls.filter((c) => c.path.endsWith('/download')).map((c) => c.body);
  expect(bodies).toEqual([{ versionId: 'v-101' }, { versionId: 'v-100' }]);
  // The main Download button serves the latest entitled version (no version named).
  await page.getByTestId('download-button').click();
  await expect.poll(() => calls.filter((c) => c.path.endsWith('/download')).length).toBe(3);
  expect(calls.filter((c) => c.path.endsWith('/download'))[2]!.body).toBeNull();
});

test('purchases: outside the update window, renew updates for N SOL/month through the wallet', async ({
  page,
}) => {
  const { secret, address } = wallet();
  let renewed = false;
  const lapsed = order({
    latest: { id: 'v-110', semver: '1.1.0', changelog: 'New Photon overlay' },
    latestEntitled: { id: 'v-101', semver: '1.0.1' },
    current: { id: 'v-101', semver: '1.0.1' },
    entitledToLatest: false,
    active: false,
    changes: [{ semver: '1.1.0', changelog: 'New Photon overlay' }],
    updatesUntil: new Date(NOW - 10 * 86_400_000).toISOString(),
  });
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (path === '/me/orders')
      return {
        json: {
          orders: [
            renewed
              ? order({
                  latest: { id: 'v-110', semver: '1.1.0', changelog: 'New Photon overlay' },
                  latestEntitled: { id: 'v-110', semver: '1.1.0' },
                  current: { id: 'v-101', semver: '1.0.1' },
                  changes: [{ semver: '1.1.0', changelog: 'New Photon overlay' }],
                })
              : lapsed,
          ],
        },
      };
    if (method === 'POST' && path === `/orders/${lapsed.id}/updates/renew`)
      return { json: { renewalId: 'ren-1', txBase64: unsignedTx(address), total: '10500000' } };
    if (method === 'POST' && path === `/orders/${lapsed.id}/updates/ren-1/submitted`) {
      renewed = true;
      return { json: { ok: true, updatesUntil: new Date(NOW + 30 * 86_400_000).toISOString() } };
    }
    return undefined;
  });
  await page.goto('/me/purchases');
  await page.getByRole('tab', { name: /Completed/ }).click();
  const banner = page.getByTestId('update-available');
  await expect(banner).toHaveAttribute('data-state', 'renew');
  await expect(banner).toContainText('Update available v1.0.1 → v1.1.0');
  await expect(page.getByTestId('renew-updates')).toHaveText('Renew updates for 0.0105 SOL/month');
  await expect(page.getByTestId('updates-status')).toContainText('Updates ended');
  if (process.env.VERSIONING_SHOTS) {
    await page
      .getByTestId('order-card')
      .screenshot({ path: `${process.env.VERSIONING_SHOTS}/versioning-purchases-renew.png` });
  }
  await page.getByTestId('renew-updates').click();
  await expect(page.getByTestId('toast')).toContainText('Updates renewed');
  await expect(page.getByTestId('update-available')).toHaveAttribute('data-state', 'included');
  const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
  expect(posts).toEqual([
    `/orders/${lapsed.id}/updates/renew`,
    '/tx/send',
    `/orders/${lapsed.id}/updates/ren-1/submitted`,
  ]);
  expectSignedBy(
    (calls.find((c) => c.path === '/tx/send')!.body as { txBase64: string }).txBase64,
    address,
  );
});

test('verify: needs a wallet; one free check a day, then a SOL supplement paid on chain', async ({
  page,
}) => {
  const { secret, address } = wallet();
  let used = 0;
  const calls = await setup(page, address, secret, ({ method, path, body }) => {
    if (path === '/transparency')
      return { status: 503, json: { error: { code: 'X', message: 'x' } } };
    if (path === '/verify/quota')
      return {
        json: {
          signedIn: true,
          freeLeft: used === 0,
          freePerDay: 1,
          supplementLamports: '10000000',
          resetsAt: '2026-10-19T00:00:00.000Z',
        },
      };
    if (method === 'POST' && path === '/verify') {
      const paid = (body as { supplementId?: string }).supplementId === 'sup-v';
      if (used > 0 && !paid)
        return {
          status: 402,
          json: {
            error: {
              code: 'SUPPLEMENT_REQUIRED',
              message: 'used',
              supplement: { lamports: '10000000' },
            },
          },
        };
      used += 1;
      return {
        json: {
          match: true,
          message: 'Matches reviewed v1.4.0 of Trojan Trenches Intel',
          free: !paid,
        },
      };
    }
    if (method === 'POST' && path === '/verify/supplement')
      return {
        json: { supplementId: 'sup-v', lamports: '10000000', txBase64: unsignedTx(address) },
      };
    if (method === 'POST' && path === '/supplements/sup-v/submitted') return { json: { ok: true } };
    return undefined;
  });
  await page.goto('/verify');
  await expect(page.getByTestId('verify-quota')).toContainText(
    'free verification for today (UTC) is available',
  );
  const file = {
    name: 'intel.user.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from('console.log(1)'),
  };
  await page.locator('#verify-file').setInputFiles(file);
  await expect(page.getByRole('status').filter({ hasText: 'Match' })).toContainText(
    'Matches reviewed v1.4.0',
  );
  await expect(page.getByTestId('verify-quota')).toContainText('Free verification used today');
  await expect(page.getByTestId('verify-quota')).toContainText('0.01 SOL');

  await page.locator('#verify-file').setInputFiles({ ...file, name: 'second.user.js' });
  const offer = page.getByTestId('verify-supplement');
  await expect(offer).toContainText('second.user.js');
  await expect(offer).toContainText('0.01 SOL');
  await page.getByTestId('pay-verify').click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Match' })).toBeVisible();
  const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
  expect(posts).toEqual([
    '/verify',
    '/verify',
    '/verify/supplement',
    '/tx/send',
    '/supplements/sup-v/submitted',
    '/verify',
  ]);
  expect(
    (
      calls.filter((c) => c.path === '/verify' && c.method === 'POST')[2]!.body as {
        supplementId: string;
      }
    ).supplementId,
  ).toBe('sup-v');
});

test('verify: signed out, the page asks for a wallet sign-in instead of uploading', async ({
  page,
}) => {
  const { address } = wallet();
  await setup(page, address, null, ({ path }) => {
    if (path === '/transparency')
      return { status: 503, json: { error: { code: 'X', message: 'x' } } };
    if (path === '/verify/quota')
      return {
        json: {
          signedIn: false,
          freeLeft: false,
          freePerDay: 1,
          supplementLamports: '10000000',
          resetsAt: '2026-10-19T00:00:00.000Z',
        },
      };
    return undefined;
  });
  await page.goto('/verify');
  await expect(page.getByTestId('verify-signin')).toContainText(
    'Sign in with a wallet to verify a file',
  );
  await expect(page.locator('#verify-file')).toHaveCount(0);
});

test('docs and terms state the update policy, limits and supplements', async ({ page }) => {
  await page.goto('/docs/sellers');
  await expect(page.getByTestId('seller-limits')).toContainText('1 free update per listing');
  await expect(page.getByTestId('seller-limits')).toContainText('5 free file uploads');
  await expect(page.getByTestId('seller-upload-supplement')).toHaveText('0.05 SOL');
  await page.goto('/docs/buyers');
  await expect(page.getByTestId('buyer-update-days')).toHaveText('30 days');
  await expect(page.getByTestId('buyer-updates')).toContainText('upd:');
  await page.goto('/docs/fees');
  await expect(page.getByTestId('fee-upload-supplement')).toHaveText('0.05 SOL');
  await expect(page.getByTestId('fee-verify-supplement')).toHaveText('0.01 SOL');
  await page.goto('/terms');
  await expect(page.getByTestId('terms-updates')).toContainText('30 days after payment');
});

test('listing page states the seller update policy', async ({ page }) => {
  const { secret, address } = wallet();
  const listing = {
    id: 'listing-1',
    slug: 'trojan-trenches-intel',
    title: 'Trojan Trenches Intel',
    summary: 'Labels copycat coins on Trojan.',
    description: 'Labels copycat coins on Trojan.',
    category: 'userscript',
    terminals: ['Trojan'],
    price: '100000000',
    updatePrice: '10000000',
    license: 'single',
    holderOnly: false,
    sales7d: 3,
    ratingAvg: null,
    ratingCount: 0,
    creator: {
      handle: 'maker',
      wallet: 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ',
      bondLamports: '5000000000',
    },
    preview: '// ==UserScript==',
    security: null,
  };
  await setup(page, address, secret, ({ path }) => {
    if (path === '/listings/trojan-trenches-intel') return { json: listing };
    if (path.startsWith('/listings/trojan-trenches-intel/')) return { json: [] };
    return undefined;
  });
  await page.goto('/l/trojan-trenches-intel');
  await expect(page.getByTestId('update-policy')).toContainText(
    'Free updates for 30 days, then 0.01 SOL/month',
  );
});
