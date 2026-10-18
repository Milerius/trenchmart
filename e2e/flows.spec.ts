import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

// Money flows end to end in the browser: checkout into escrow, opening a dispute, staking the
// creator bond and linking X. The CI e2e job has no API or RPC, so /api/v1 is stubbed and the
// wallet is the test signer (window.__TRENCHMART_E2E_SECRET__). Each test checks the exact
// requests and that the transaction sent to /tx/send carries a valid signature from the wallet.

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
  terminals: ['Axiom', 'Trojan'],
};

const LISTING = {
  id: 'listing-1',
  slug: 'trojan-trenches-intel',
  title: 'Trojan Trenches Intel',
  summary: 'Labels copycat coins on Trojan.',
  description: 'Labels copycat coins on Trojan.',
  category: 'userscript',
  terminals: ['Trojan'],
  price: '100000000',
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

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => { status?: number; json: unknown } | undefined;

function wallet() {
  const pair = nacl.sign.keyPair();
  return { pair, secret: bs58.encode(pair.secretKey), address: bs58.encode(pair.publicKey) };
}

/** An unsigned legacy transfer paid by `payer`, base64, like the API returns. */
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

async function setup(page: Page, address: string, secret: string, handler: Handler) {
  await page.addInitScript((value) => {
    (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ = value;
  }, secret);
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
      return route.fulfill({
        json: { user: { id: 'u1', wallet: address, handle: 'maker', roles: [] }, tier: 'none' },
      });
    }
    if (path === '/config/public') return route.fulfill({ json: CONFIG });
    if (path === '/tx/send')
      return route.fulfill({ json: { signature: bs58.encode(nacl.randomBytes(64)) } });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'not found' } },
    });
  });
  return calls;
}

test('checkout: quote, order, wallet signs, payment confirmed into escrow', async ({ page }) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (path === '/listings/trojan-trenches-intel') return { json: LISTING };
    if (path.startsWith('/listings/trojan-trenches-intel/')) return { json: [] };
    if (method === 'POST' && path === '/orders/quote') {
      return {
        json: {
          price: '100000000',
          fee: '5000000',
          rebate: '0',
          total: '105000000',
          tier: 'none',
          totalUsd: { usdCents: null },
        },
      };
    }
    if (method === 'POST' && path === '/orders') {
      return {
        json: { orderId: 'order-1234abcd', txBase64: unsignedTx(address), total: '105000000' },
      };
    }
    if (method === 'POST' && path === '/orders/order-1234abcd/submitted')
      return { json: { status: 'PAID' } };
    return undefined;
  });
  await page.goto('/l/trojan-trenches-intel');
  await expect(page.getByTestId('buy')).toHaveText('Pay into escrow');
  await page.getByTestId('buy').click();
  await expect(page.getByTestId('escrow-success')).toContainText('Paid · in escrow');
  await expect(page.getByTestId('checkout').getByTestId('tier-pill')).toContainText(
    'Quote locked for tier',
  );
  await expect(
    page.getByRole('link', { name: /View order order-12 in Purchases/ }),
  ).toHaveAttribute('href', '/me/purchases');

  const flow = calls.filter((c) => c.method === 'POST').map((c) => c.path);
  expect(flow).toEqual([
    '/orders/quote',
    '/orders',
    '/tx/send',
    '/orders/order-1234abcd/submitted',
  ]);
  expect(calls.find((c) => c.path === '/orders')!.body).toEqual({ listingId: 'listing-1' });
  expectSignedBy(
    (calls.find((c) => c.path === '/tx/send')!.body as { txBase64: string }).txBase64,
    address,
  );
  expect(calls.find((c) => c.path.endsWith('/submitted'))!.body).toMatchObject({
    txSig: expect.any(String),
  });
});

test('checkout: an API error is shown and the button offers a retry', async ({ page }) => {
  const { secret, address } = wallet();
  await setup(page, address, secret, ({ method, path }) => {
    if (path === '/listings/trojan-trenches-intel') return { json: LISTING };
    if (path.startsWith('/listings/trojan-trenches-intel/')) return { json: [] };
    if (method === 'POST' && path === '/orders/quote') {
      return {
        status: 409,
        json: {
          error: { code: 'LISTING_LOCKED', message: 'This listing is in holder early access.' },
        },
      };
    }
    return undefined;
  });
  await page.goto('/l/trojan-trenches-intel');
  await page.getByTestId('buy').click();
  await expect(page.getByTestId('toast')).toHaveText('This listing is in holder early access.');
  await expect(page.getByTestId('buy')).toHaveText('Try again');
});

test('dispute: reason and details are sent, and the wallet signs the escrow freeze', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (method === 'POST' && path === '/orders/order-1/dispute') {
      return { json: { disputeId: 'disp-1', txBase64: unsignedTx(address) } };
    }
    return undefined;
  });
  await page.goto('/me/purchases/order-1/dispute');
  await page.getByLabel(/Broken or changed/).check();
  await page.getByLabel('Details').fill('short');
  await page.getByRole('button', { name: 'Submit dispute' }).click();
  // Native validation keeps short details from being sent.
  expect(calls.some((c) => c.path === '/orders/order-1/dispute')).toBe(false);
  await page.getByLabel('Details').fill('The script stopped labelling coins after the update.');
  await page.getByRole('button', { name: 'Submit dispute' }).click();
  await expect(page.getByTestId('dispute').getByRole('status')).toHaveText(
    'Dispute disp-1 opened. The escrow is frozen and downloads pause.',
  );
  await expect(page.getByRole('button', { name: 'Submit dispute' })).toBeDisabled();
  expect(calls.find((c) => c.path === '/orders/order-1/dispute')!.body).toEqual({
    reason: 'broken',
    details: 'The script stopped labelling coins after the update.',
  });
  expectSignedBy(
    (calls.find((c) => c.path === '/tx/send')!.body as { txBase64: string }).txBase64,
    address,
  );
});

test('dispute (escrow v2): the server freezes the escrow, the wallet is never asked to sign', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (method === 'POST' && path === '/orders/order-1/dispute') {
      return { json: { disputeId: 'disp-2', txBase64: null, onChain: true } };
    }
    return undefined;
  });
  await page.goto('/me/purchases/order-1/dispute');
  await page.getByLabel('Details').fill('The script stopped labelling coins after the update.');
  await page.getByRole('button', { name: 'Submit dispute' }).click();
  await expect(page.getByTestId('dispute').getByRole('status')).toHaveText(
    'Dispute disp-2 opened. The escrow is frozen and downloads pause.',
  );
  expect(calls.some((c) => c.path === '/tx/send')).toBe(false);
  expect(calls.some((c) => c.path === '/orders/order-1/dispute/tx')).toBe(false);
});

test('checkout: the kill switch (503 CHECKOUT_PAUSED) is explained and nothing is signed', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (path === '/listings/trojan-trenches-intel') return { json: LISTING };
    if (path.startsWith('/listings/trojan-trenches-intel/')) return { json: [] };
    if (method === 'POST' && path === '/orders/quote') {
      return {
        json: {
          price: '100000000',
          fee: '5000000',
          rebate: '0',
          total: '105000000',
          tier: 'none',
          totalUsd: { usdCents: null },
        },
      };
    }
    if (method === 'POST' && path === '/orders') {
      return {
        status: 503,
        json: { error: { code: 'CHECKOUT_PAUSED', message: 'checkout is paused for maintenance' } },
      };
    }
    return undefined;
  });
  await page.goto('/l/trojan-trenches-intel');
  await page.getByTestId('buy').click();
  await expect(page.getByTestId('toast')).toHaveText('checkout is paused for maintenance');
  await expect(page.getByTestId('buy')).toHaveText('Try again');
  expect(calls.some((c) => c.path === '/tx/send')).toBe(false);
});

test('dispute: an API refusal is shown', async ({ page }) => {
  const { secret, address } = wallet();
  await setup(page, address, secret, ({ path }) =>
    path === '/orders/order-1/dispute'
      ? {
          status: 409,
          json: { error: { code: 'WINDOW_CLOSED', message: 'The escrow window has ended.' } },
        }
      : undefined,
  );
  await page.goto('/me/purchases/order-1/dispute');
  await page.getByLabel('Details').fill('It does not do what the page said.');
  await page.getByRole('button', { name: 'Submit dispute' }).click();
  await expect(page.getByTestId('dispute').getByRole('alert')).toHaveText(
    'The escrow window has ended.',
  );
});

function studioHandler(address: string, state: { xLinked: boolean; bond: string }): Handler {
  return ({ method, path }) => {
    if (path === '/studio/requirements') {
      return {
        json: {
          xLinked: state.xLinked,
          bondRequired: '5000000000',
          bondActive: state.bond,
          bondOk: BigInt(state.bond) >= 5000000000n,
          verificationFee: '0',
          feeWaived: false,
        },
      };
    }
    if (path === '/studio/listings' && method === 'GET') return { json: [] };
    // Devnet without an X app: the studio falls back to the unverified handle link (M-04).
    if (path === '/auth/x/start')
      return {
        status: 501,
        json: { error: { code: 'X_UNCONFIGURED', message: 'X OAuth is not configured.' } },
      };
    if (path === '/studio/payouts')
      return { json: { total: { lamports: '0', usdCents: null }, payouts: [] } };
    if (method === 'POST' && path === '/studio/x') {
      state.xLinked = true;
      return { json: { ok: true } };
    }
    if (method === 'POST' && path === '/studio/bond')
      return { json: { bondId: 'bond-1', txBase64: unsignedTx(address) } };
    if (method === 'POST' && path === '/studio/bond/bond-1/submitted') {
      state.bond = '5000000000';
      return { json: { ok: true } };
    }
    return undefined;
  };
}

test('studio asks for a wallet before opening', async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
    }),
  );
  await page.goto('/studio');
  await expect(page.getByText('Connect a wallet to open the studio.')).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Connect wallet' }),
  ).toBeVisible();
});

test('studio: link X, then stake the creator bond with a signed transaction', async ({ page }) => {
  const { secret, address } = wallet();
  const state = { xLinked: false, bond: '0' };
  const calls = await setup(page, address, secret, studioHandler(address, state));
  await page.goto('/studio');
  const ready = page.getByRole('heading', { name: 'Ready to sell' }).locator('..');
  await expect(ready).toContainText('X account linked (needed)');
  await expect(ready).toContainText('Creator bond (needed)');

  await page.getByLabel('X handle').fill('trenchmaker');
  await page.getByRole('button', { name: 'Link X' }).click();
  await expect(ready).toContainText('X account linked (done)');
  await expect(page.getByLabel('X handle')).toHaveCount(0);
  expect(calls.find((c) => c.path === '/studio/x')!.body).toEqual({ handle: 'trenchmaker' });

  await page.getByLabel('Bond SOL').fill('5');
  await page.getByRole('button', { name: 'Stake bond' }).click();
  await expect(page.getByTestId('studio').getByRole('status')).toHaveText('Bond submitted.');
  await expect(ready).toContainText('Creator bond (done)');
  expect(calls.find((c) => c.path === '/studio/bond')!.body).toEqual({ amount: '5000000000' });
  expectSignedBy(
    (calls.find((c) => c.path === '/tx/send')!.body as { txBase64: string }).txBase64,
    address,
  );
  expect(calls.find((c) => c.path === '/studio/bond/bond-1/submitted')!.body).toMatchObject({
    txSig: expect.any(String),
  });
});

test('studio: a rejected X link shows the reason', async ({ page }) => {
  const { secret, address } = wallet();
  const base = studioHandler(address, { xLinked: false, bond: '0' });
  await setup(page, address, secret, (call) =>
    call.path === '/studio/x'
      ? {
          status: 400,
          json: { error: { code: 'BAD_HANDLE', message: 'That X handle is not valid.' } },
        }
      : base(call),
  );
  await page.goto('/studio');
  await page.getByLabel('X handle').fill('!!');
  await page.getByRole('button', { name: 'Link X' }).click();
  await expect(page.getByTestId('studio').getByRole('status')).toHaveText(
    'That X handle is not valid.',
  );
});

test('studio: with an X app configured, Link X goes to X sign-in (OAuth PKCE)', async ({
  page,
}) => {
  const { secret, address } = wallet();
  const base = studioHandler(address, { xLinked: false, bond: '0' });
  const authorize =
    'https://x.com/i/oauth2/authorize?response_type=code&client_id=c&state=s&code_challenge=x&code_challenge_method=S256';
  const calls = await setup(page, address, secret, (call) =>
    call.path === '/auth/x/start' ? { json: { url: authorize } } : base(call),
  );
  await page.route('https://x.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>X sign-in</title>' }),
  );
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Link X' }).click();
  await page.waitForURL(/x\.com\/i\/oauth2\/authorize/);
  expect(new URL(page.url()).searchParams.get('code_challenge_method')).toBe('S256');
  // The typed handle is never sent: the account comes from X itself.
  expect(calls.some((c) => c.path === '/studio/x')).toBe(false);
});

test('studio: the X sign-in result is shown after the callback', async ({ page }) => {
  const { secret, address } = wallet();
  await setup(page, address, secret, studioHandler(address, { xLinked: true, bond: '0' }));
  await page.goto('/studio?x=linked');
  await expect(page.getByTestId('studio').getByRole('status')).toHaveText(
    'X account verified and linked.',
  );
  await page.goto('/studio?x=taken');
  await expect(page.getByTestId('studio').getByRole('status')).toHaveText(
    'That X account is already linked to another wallet.',
  );
});

test('studio upload: creates the listing, pays the verification fee, uploads the file, opens the live review', async ({
  page,
}) => {
  const { secret, address } = wallet();
  let uploaded = '';
  await page.route('**/uploads/**', async (route) => {
    uploaded = route.request().postData() ?? '';
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  const calls = await setup(page, address, secret, ({ method, path }) => {
    if (method === 'POST' && path === '/studio/listings') return { json: { id: 'L1' } };
    if (path.startsWith('/studio/listings/L1/content')) return { json: { ok: true } };
    if (method === 'POST' && path === '/studio/listings/L1/versions') {
      return {
        json: {
          versionId: 'V1',
          uploadUrl: 'https://api.example/uploads/V1?sig=abc',
          feeTx: { txBase64: unsignedTx(address) },
        },
      };
    }
    if (method === 'POST' && path === '/studio/versions/V1/fee') return { json: { ok: true } };
    if (path === '/studio/requirements')
      return {
        json: { xLinked: true, bondActive: '0', verificationFee: '250000000', feeWaived: false },
      };
    if (path.startsWith('/studio')) return { json: [] };
    return undefined;
  });
  await page.goto('/studio/listings/new');
  await page.getByTestId('kind-script').click();
  await page.getByTestId('continue').click();
  await page
    .getByTestId('terminals')
    .getByRole('button', { name: /Trojan/ })
    .click();
  await page.getByTestId('continue').click();
  await page.fill('#title', 'Trojan Trenches Intel');
  await page.fill('#summary', 'Labels copycat coins and finds the OG.');
  await page.fill('#description', 'Userscript for trojan.com that labels copycat coins.');
  await page.getByTestId('continue').click();
  await page.getByTestId('continue').click();
  await page.fill('#price', '0.1');
  await page.getByTestId('continue').click();
  await page.locator('#file').setInputFiles({
    name: 'intel.user.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from('// ==UserScript==\n// @name Intel\n// ==/UserScript==\n'),
  });
  await expect(page.getByTestId('file-summary')).toContainText('@name Intel');
  await page.getByTestId('continue').click();
  await page.getByText('The file does what this listing says').click();
  await page.getByTestId('submit').click();
  await page.waitForURL('**/studio/listings/L1/versions/V1');

  expect(
    calls.find((c) => c.method === 'POST' && c.path === '/studio/listings')!.body,
  ).toMatchObject({
    title: 'Trojan Trenches Intel',
    priceLamports: '100000000',
  });
  expect(calls.find((c) => c.path === '/studio/listings/L1/versions')!.body).toEqual({
    semver: '1.0.0',
    changelog: 'initial',
    fileName: 'intel.user.js',
    fileSize: 52,
  });
  expectSignedBy(
    (calls.find((c) => c.path === '/tx/send')!.body as { txBase64: string }).txBase64,
    address,
  );
  expect(calls.find((c) => c.path === '/studio/versions/V1/fee')!.body).toMatchObject({
    txSig: expect.any(String),
  });
  // The upload goes to the same origin (cookie auth), with the signed query kept.
  expect(uploaded).toContain('@name Intel');
});
