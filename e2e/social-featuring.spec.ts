import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Paid featured spots: the studio booking flow (checks, placement, calendar, quote, pay in SOL),
// and the labelled "Featured · Sponsored" placements on home, category pages and the activity
// band. The CI e2e job has no API or RPC, so /api/v1 is stubbed and the wallet is the test signer
// (window.__TRENCHMART_E2E_SECRET__). Each test checks the exact requests sent.

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
};

const FEATURE_CONFIG = {
  slots: {
    home: { perDay: 3, lamportsPerDay: '1500000000', label: 'Home · Featured row' },
    category: { perDay: 2, lamportsPerDay: '600000000', label: 'Category top' },
    band: { perDay: 6, lamportsPerDay: '200000000', label: 'Live band' },
  },
  discountBps: { none: 0, scout: 1000, trencher: 2000, og: 3000 },
  rules: {
    maxConsecutiveDays: 7,
    maxDaysAhead: 28,
    minRatingX10: 40,
    holdMinutes: 15,
    cancelHours: 24,
    homePerCreatorPerDay: 1,
  },
};

const LISTING_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '11111111-2222-4333-8444-666666666666';
const BOOKING_ID = '99999999-2222-4333-8444-555555555555';

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}
function addDays(day: string, n: number) {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
}
const TODAY = utcDay(new Date());

function calendar(kind: string, soldOut: string[] = [], lastSlot: string[] = []) {
  const capacity = FEATURE_CONFIG.slots[kind as 'home'].perDay;
  return {
    kind,
    category: null,
    capacity,
    lamportsPerDay: FEATURE_CONFIG.slots[kind as 'home'].lamportsPerDay,
    days: Array.from({ length: 29 }, (_, i) => {
      const day = addDays(TODAY, i);
      const free = soldOut.includes(day) ? 0 : lastSlot.includes(day) ? 1 : capacity;
      return { day, booked: capacity - free, free };
    }),
  };
}

const CARD = {
  id: LISTING_ID,
  slug: 'bundle-detector',
  title: 'Bundle Detector Overlay',
  summary: 'Flags bundled launches and sniper clusters right on the token list.',
  category: 'userscript',
  terminals: ['Axiom'],
  price: '1200000000',
  handle: 'rugradar',
  ratingAvg: '4.90',
  upvotes: 642,
  rank: { category: 3, overall: 12 },
  cover: null,
};

function facts(over: Record<string, unknown> = {}) {
  return {
    semver: '1.4.2',
    reviewedAt: '2026-10-15T09:00:00.000Z',
    versionLive: true,
    openDisputes: 0,
    disputes30d: 0,
    ratingAvg: 4.9,
    ratingCount: 41,
    minRatingX10: 40,
    bondLamports: '2000000000',
    bondRequired: '2000000000',
    ...over,
  };
}

function overview(bookings: unknown[] = [], tier = 'trencher') {
  return {
    tier,
    config: FEATURE_CONFIG,
    listings: [
      {
        id: LISTING_ID,
        slug: CARD.slug,
        title: CARD.title,
        category: 'userscript',
        price: CARD.price,
        problems: [],
        facts: facts(),
        card: CARD,
      },
      {
        id: OTHER_ID,
        slug: 'kol-list',
        title: 'KOL Entry Timing List',
        category: 'wallet_list',
        price: '500000000',
        problems: [
          { code: 'OPEN_DISPUTE', message: 'Resolve the open dispute on this listing first.' },
        ],
        facts: facts({ openDisputes: 1, disputes30d: 1, ratingAvg: null, ratingCount: 0 }),
        card: null,
      },
    ],
    bookings,
  };
}

type Call = { method: string; path: string; query: string; body: unknown };
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
      lamports: 4_800_000_000,
    }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

async function setup(
  page: Page,
  who: { address: string; secret: string } | null,
  handler: Handler,
) {
  if (who) {
    await page.addInitScript((value) => {
      (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ =
        value;
    }, who.secret);
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
    const call = { method: request.method(), path, query: url.search, body };
    calls.push(call);
    const custom = handler(call);
    if (custom) return route.fulfill({ status: custom.status ?? 200, json: custom.json });
    if (path === '/me') {
      if (!who)
        return route.fulfill({
          status: 401,
          json: { error: { code: 'UNAUTHORIZED', message: 'sign in required' } },
        });
      return route.fulfill({
        json: {
          user: { id: 'u1', wallet: who.address, handle: 'rugradar', roles: ['creator'] },
          tier: 'trencher',
        },
      });
    }
    if (path === '/config/public') return route.fulfill({ json: CONFIG });
    if (path === '/prices/sol') return route.fulfill({ json: { centsPerSol: '10421' } });
    if (path === '/featuring/config') return route.fulfill({ json: FEATURE_CONFIG });
    if (path === '/tx/send')
      return route.fulfill({ json: { signature: bs58.encode(nacl.randomBytes(64)) } });
    if (path.startsWith('/media/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'not found' } },
    });
  });
  return calls;
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('studio: checks, placement, calendar run, tier quote, pay in SOL and see the booking', async ({
  page,
}) => {
  const who = wallet();
  const start = addDays(TODAY, 3);
  const soldOut = addDays(TODAY, 5);
  let booked = false;
  let txBase64 = '';
  const calls = await setup(page, who, (call) => {
    if (call.path === '/studio/featuring')
      return {
        json: overview(
          booked
            ? [
                {
                  id: BOOKING_ID,
                  listingId: LISTING_ID,
                  title: CARD.title,
                  slug: CARD.slug,
                  kind: 'home',
                  startDay: start,
                  days: 2,
                  subtotal: '3000000000',
                  discountBps: 2000,
                  total: '2400000000',
                  status: 'paid',
                  txSig: '5'.repeat(64),
                  refundLamports: '0',
                  refundReason: null,
                },
              ]
            : [],
        ),
      };
    if (call.path === '/featuring/calendar') {
      const kind = new URLSearchParams(call.query).get('kind')!;
      return { json: calendar(kind, kind === 'home' ? [soldOut] : [], [addDays(TODAY, 4)]) };
    }
    if (call.path === '/studio/featuring/quote') {
      const body = call.body as { days: number };
      const subtotal = 1_500_000_000n * BigInt(body.days);
      const discount = (subtotal * 2000n) / 10000n;
      return {
        json: {
          quote: {
            kind: 'home',
            days: body.days,
            perDayLamports: '1500000000',
            subtotal: subtotal.toString(),
            tier: 'trencher',
            discountBps: 2000,
            discount: discount.toString(),
            total: (subtotal - discount).toString(),
          },
          problems: [],
        },
      };
    }
    if (call.path === '/studio/featuring/bookings') {
      txBase64 = unsignedTx(who.address);
      return {
        json: {
          booking: { id: BOOKING_ID, status: 'pending', total: '2400000000' },
          tx: { txBase64 },
        },
      };
    }
    if (call.path === `/studio/featuring/bookings/${BOOKING_ID}/submitted`) {
      booked = true;
      return { json: { id: BOOKING_ID, status: 'paid' } };
    }
    return undefined;
  });

  await page.goto('/studio/featuring');
  const root = page.getByTestId('studio-featuring');
  await expect(root.getByRole('heading', { name: 'Feature a listing' })).toBeVisible();
  // Step 1: the listing and the four real checks.
  await expect(page.getByTestId('feature-listing-line')).toContainText('v1.4.2');
  await expect(page.getByTestId('feature-listing-line')).toContainText('★ 4.9 (41)');
  await expect(root).toContainText('#3 in Userscripts');
  await expect(page.getByTestId('feature-check')).toHaveCount(4);
  await expect(page.locator('[data-testid="feature-check"][data-ok="true"]')).toHaveCount(4);
  await expect(page.getByTestId('feature-check').nth(3)).toContainText('2.00 SOL on-chain');
  // Step 2: placements read prices and availability from config and the calendars.
  await expect(page.getByTestId('placement-home')).toContainText('1.50');
  await expect(page.getByTestId('placement-home')).toContainText('1 day sold out');
  await expect(page.getByTestId('placement-band')).toContainText('0.20');
  // Step 3: a sold-out day is disabled; a start then a later day books a run.
  const cal = page.getByTestId('feature-calendar');
  await expect(cal.getByRole('button', { name: /sold out/ })).toBeDisabled();
  await expect(cal.getByRole('button', { name: /1 of 3 left/ })).toHaveCount(1);
  const dayBtn = (day: string) =>
    cal.getByRole('button', {
      name: new RegExp(
        `^${new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}:`,
      ),
    });
  await dayBtn(start).click();
  await dayBtn(addDays(start, 1)).click();
  await expect(cal.getByRole('button', { pressed: true })).toHaveCount(2);
  // A run across the sold-out day restarts instead of extending.
  // Summary: subtotal, the Trencher discount and the total in SOL with USD.
  const quote = page.getByTestId('feature-quote');
  await expect(quote).toContainText('2 days');
  await expect(quote).toContainText('3.00 SOL');
  await expect(quote).toContainText('Trencher tier −20%');
  await expect(page.getByTestId('feature-total')).toContainText('2.40 SOL');
  await expect(page.getByTestId('tier-discounts')).toContainText('−30%');
  await expect(page.getByTestId('feature-preview').getByTestId('sponsored-tag')).toBeVisible();
  await expect(page.getByTestId('featuring-never')).toContainText('Search order outside the slot');
  await expectNoSeriousAxe(page);

  await quote.getByRole('button', { name: 'Pay 2.40 SOL' }).click();
  await expect(page.getByRole('status')).toContainText('Paid and booked');
  const create = calls.find((c) => c.path === '/studio/featuring/bookings');
  expect(create?.body).toEqual({ listingId: LISTING_ID, kind: 'home', startDay: start, days: 2 });
  const sent = calls.find((c) => c.path === '/tx/send');
  expect(sent).toBeTruthy();
  const signed = web3.Transaction.from(
    Buffer.from((sent!.body as { txBase64: string }).txBase64, 'base64'),
  );
  expect(signed.feePayer?.toBase58()).toBe(who.address);
  expect(signed.verifySignatures()).toBe(true);
  const submitted = calls.find((c) => c.path.endsWith('/submitted'));
  expect((submitted?.body as { txSig: string }).txSig).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  await expect(page.getByTestId('feature-booking')).toHaveCount(1);
  await expect(page.getByTestId('feature-booking')).toContainText('BOOKED');
  await expect(page.getByTestId('feature-booking')).toContainText('2.40 SOL');
});

test('studio: an ineligible listing shows the failing check and cannot be paid', async ({
  page,
}) => {
  const who = wallet();
  await setup(page, who, (call) => {
    if (call.path === '/studio/featuring') return { json: overview([], 'none') };
    if (call.path === '/featuring/calendar')
      return { json: calendar(new URLSearchParams(call.query).get('kind')!) };
    if (call.path === '/studio/featuring/quote')
      return {
        json: {
          quote: {
            subtotal: '600000000',
            discountBps: 0,
            discount: '0',
            total: '600000000',
            tier: 'none',
            days: 1,
          },
          problems: [
            { code: 'OPEN_DISPUTE', message: 'Resolve the open dispute on this listing first.' },
          ],
        },
      };
    return undefined;
  });
  await page.goto('/studio/featuring');
  await page.getByLabel('Change listing').selectOption(OTHER_ID);
  await expect(page.locator('[data-testid="feature-check"][data-ok="false"]')).toHaveCount(1);
  await expect(page.getByTestId('feature-check').nth(1)).toContainText('1 open now');
  await expect(page.getByTestId('feature-problems')).toContainText('Resolve the open dispute');
  await page.getByTestId('placement-category').click();
  await page
    .getByTestId('feature-calendar')
    .getByRole('button', { name: /of 2 left/ })
    .nth(2)
    .click();
  await expect(page.getByTestId('feature-total')).toContainText('0.60 SOL');
  await expect(
    page.getByTestId('feature-quote').getByRole('button', { name: /Pay/ }),
  ).toBeDisabled();
});

test('home, category and the activity band show paid slots, always labelled', async ({ page }) => {
  const featured = { ...CARD, sponsored: { bookingId: BOOKING_ID, placement: 'home' } };
  await setup(page, null, (call) => {
    if (call.path === '/featured') {
      const q = new URLSearchParams(call.query);
      return {
        json: {
          placement: q.get('placement'),
          items: [
            { ...featured, sponsored: { bookingId: BOOKING_ID, placement: q.get('placement') } },
          ],
        },
      };
    }
    if (call.path === '/activity')
      return {
        json: {
          events: [
            {
              kind: 'featured',
              at: new Date().toISOString(),
              listing: { title: CARD.title, slug: CARD.slug, category: 'userscript' },
              amountLamports: null,
              rating: null,
              semver: null,
              placement: 'home',
            },
          ],
          sponsored: [
            {
              bookingId: BOOKING_ID,
              listing: { title: 'Sniper Config Pack', slug: 'sniper', category: 'setup' },
            },
          ],
        },
      };
    if (call.path === '/listings') return { json: [CARD] };
    if (call.path === '/stats')
      return {
        json: {
          source: 'live',
          listings: 1,
          creators: 1,
          orders: 0,
          volume: { lamports: '0', sol: '0', usdCents: null },
          paidToCreators: {
            lamports: '0',
            sol: '0',
            usdCents: null,
            last24hLamports: '0',
            orders: 0,
          },
          solUsd: { centsPerSol: null },
        },
      };
    return undefined;
  });
  await page.goto('/');
  const row = page.getByTestId('featured-row');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('sponsored-tag')).toHaveText(/FEATURED · SPONSORED/);
  await expect(row).toContainText('Bundle Detector Overlay');
  const band = page.getByTestId('activity-band');
  await expect(band.getByTestId('band-sponsored')).toContainText('Sniper Config Pack');
  await expect(band).toContainText('Featured · Sponsored');
  await expect(page.getByTestId('ticker')).toContainText(
    'FEATURED · SPONSORED · Sniper Config Pack',
  );

  await page.goto('/c/userscript');
  await expect(page.getByTestId('featured-row').getByTestId('sponsored-tag')).toBeVisible();
});

test('studio featuring fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const who = wallet();
  await setup(page, who, (call) => {
    if (call.path === '/studio/featuring') return { json: overview() };
    if (call.path === '/featuring/calendar')
      return { json: calendar(new URLSearchParams(call.query).get('kind')!) };
    return undefined;
  });
  await page.goto('/studio/featuring');
  await expect(page.getByTestId('feature-check')).toHaveCount(4);
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(fits).toBe(true);
});
