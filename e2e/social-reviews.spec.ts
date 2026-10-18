import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

// Verified-buyer reviews: the listing Reviews tab, helpful votes, creator replies, and the
// sign-to-post dialog on Purchases. The CI e2e job runs without the API, so /api/v1 is stubbed.

const SLUG = 'bundle-detector-overlay';
const ORDER = 'cccccccc-0000-4000-8000-000000000003';
const VERSION = '11111111-0000-4000-8000-000000000001';
const buyer = nacl.sign.keyPair();
const BUYER = bs58.encode(buyer.publicKey);
const CREATOR = 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ';
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
const LISTING = {
  id: '00000000-0000-4000-8000-000000000009',
  slug: SLUG,
  title: 'Bundle Detector Overlay',
  summary: 'Flags bundled launches.',
  description: 'Overlay.',
  category: 'userscript',
  terminals: ['Axiom', 'GMGN'],
  price: '1200000000',
  license: 'single',
  holderOnly: false,
  ratingAvg: '4.50',
  ratingCount: 2,
  creator: { handle: 'rugradar', wallet: CREATOR, bondLamports: '1000000000' },
  preview: null,
  security: null,
  content: null,
};
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const wallet = (w: string) => ({
  kind: 'wallet',
  name: `${w.slice(0, 4)}…${w.slice(-4)}`,
  handle: null,
  avatarUrl: null,
  wallet: w,
});

function reviewsPage(viewer: 'anon' | 'buyer' | 'creator') {
  return {
    summary: {
      count: 2,
      avg: 4.5,
      histogram: { '5': 1, '4': 1, '3': 0, '2': 0, '1': 0 },
      hidden: 1,
      byVersion: [
        { semver: '1.4.2', current: true, count: 1, avg: 5 },
        { semver: '1.3.0', current: false, count: 1, avg: 4 },
      ],
    },
    counts: { all: 2, '5': 1, critical: 0, replied: 1, current: 1 },
    sort: 'helpful',
    filter: 'all',
    offset: 0,
    reviews: [
      {
        id: 'r1',
        rating: 5,
        body: 'Caught two bundled launches on day one that my usual checks missed.',
        terminal: 'Axiom',
        createdAt: day(2),
        editedAt: null,
        version: { semver: '1.4.2', current: true },
        reviewer: {
          kind: 'pseudonym',
          name: 'degen.filter',
          handle: 'degenfilter',
          avatarUrl: null,
          wallet: 'Gk2P11111111111111111111111111111111119fTa',
        },
        order: { ref: 'TM-48213aa', releasedAt: day(3) },
        helpful: { count: 3, unhelpful: 1, score: 30000 },
        reply: {
          body: 'Thanks! v1.4.2 adds a GMGN fallback.',
          createdAt: day(1),
          editedAt: null,
          creator: { ...wallet(CREATOR), kind: 'x', name: 'RugRadar', handle: 'rugradar' },
        },
        viewer:
          viewer === 'anon'
            ? null
            : { vote: null, mine: false, editableUntil: null, canReply: viewer === 'creator' },
      },
      {
        id: 'r2',
        rating: 4,
        body: 'Works, but the GMGN layout change broke the badges for a day.',
        terminal: null,
        createdAt: day(9),
        editedAt: day(8),
        version: { semver: '1.3.0', current: false },
        reviewer: wallet('7xKp2222222222222222222222222222222222mJr3'),
        order: { ref: 'TM-47702bb', releasedAt: day(10) },
        helpful: { count: 0, unhelpful: 0, score: 0 },
        reply: null,
        viewer:
          viewer === 'anon'
            ? null
            : { vote: null, mine: false, editableUntil: null, canReply: viewer === 'creator' },
      },
    ],
    viewer:
      viewer === 'anon'
        ? null
        : {
            eligibleOrderId: viewer === 'buyer' ? ORDER : null,
            ownReviewId: null,
            isCreator: viewer === 'creator',
          },
  };
}

/** The exact text the wallet signs (packages/shared reviewMessage); pinned here on purpose. */
function reviewMessage(input: {
  orderId: string;
  rating: number;
  semver: string;
  bodySha256: string;
}) {
  return [
    'TrenchMart review',
    `Order: ${input.orderId}`,
    `Rating: ${input.rating}`,
    `Version: ${input.semver}`,
    `Text SHA-256: ${input.bodySha256}`,
    'Signing is free and sends no transaction.',
  ].join('\n');
}

type Call = { method: string; path: string; search: string; body: any };

async function stub(page: Page, who: 'anon' | 'buyer' | 'creator', opts: { empty?: boolean } = {}) {
  if (who === 'buyer') {
    await page.addInitScript((value) => {
      (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ =
        value;
    }, bs58.encode(buyer.secretKey));
  }
  const calls: Call[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const raw = request.postData();
    calls.push({
      method: request.method(),
      path,
      search: url.search,
      body: raw ? JSON.parse(raw) : null,
    });
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/me') {
      if (who === 'anon') return json({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401);
      return json({
        user: {
          id: who,
          wallet: who === 'buyer' ? BUYER : CREATOR,
          handle: null,
          roles: who === 'creator' ? ['creator'] : ['buyer'],
        },
        tier: 'none',
      });
    }
    if (path === '/config/public') return json(CONFIG);
    if (path === `/listings/${SLUG}`) return json(LISTING);
    if (path === `/listings/${SLUG}/versions`) return json([]);
    if (path === `/listings/${SLUG}/reviews`) {
      if (opts.empty)
        return json({
          summary: {
            count: 0,
            avg: null,
            histogram: { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 },
            hidden: 0,
            byVersion: [],
          },
          counts: { all: 0, '5': 0, critical: 0, replied: 0, current: 0 },
          reviews: [],
          viewer: null,
        });
      return json(reviewsPage(who));
    }
    if (path === '/reviews/r2/vote')
      return json({
        ok: true,
        vote: true,
        weight: {
          bps: 10000,
          label: '1.0×',
          reason: 'Your vote counts fully: this wallet has a released order.',
        },
      });
    if (path === '/reviews/r2/reply') return json({ ok: true });
    if (path === '/me/orders')
      return json({
        orders: [
          {
            id: ORDER,
            title: LISTING.title,
            slug: SLUG,
            status: 'released',
            tier_at_purchase: 'none',
            amount: { lamports: '1260000000', usdCents: null },
            paid_at: day(3),
            escrow_until: day(3),
            released_at: day(3),
            escrow_address: null,
            tx_sig: null,
            cover: null,
          },
        ],
      });
    if (path === '/me/reviews') return json([]);
    if (path === `/orders/${ORDER}/review-form`)
      return json({
        order: { id: ORDER, ref: 'TM-cccccccc', status: 'released', releasedAt: day(3) },
        listing: { title: LISTING.title, slug: SLUG, terminals: ['Axiom', 'GMGN'] },
        creator: { ...wallet(CREATOR), kind: 'x', name: 'RugRadar', handle: 'rugradar' },
        poster: wallet(BUYER),
        versions: [{ id: VERSION, semver: '1.4.2', downloadedAt: day(3) }],
        rules: { minChars: 40, maxChars: 1000, editDays: 30 },
        canReview: true,
        review: null,
      });
    if (path === `/orders/${ORDER}/review`) return json({ ok: true, id: 'r9' });
    return json({ error: { code: 'NOT_FOUND', message: 'nf' } }, 404);
  });
  return calls;
}

test('listing reviews: summary, verified buyers, creator reply, filters and weighted helpful votes', async ({
  page,
}) => {
  const calls = await stub(page, 'buyer');
  await page.goto(`/l/${SLUG}`);
  await page.getByRole('tab', { name: /Reviews/ }).click();
  const panel = page.getByTestId('listing-reviews');
  await expect(page.getByTestId('review-summary')).toContainText('4.5');
  await expect(page.getByTestId('review-summary')).toContainText('v1.4.2 · current');
  const cards = panel.getByTestId('review');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('VERIFIED BUYER');
  await expect(cards.nth(0)).toContainText('degen.filter');
  await expect(cards.nth(0).getByTestId('creator-reply')).toContainText('GMGN fallback');
  await expect(cards.nth(1)).toContainText('v1.3.0 · older');
  await expect(panel).toContainText('1 review is hidden while moderation checks a report');

  // Eligible buyer: "Write a review" deep-links to the order on Purchases.
  await expect(panel.getByTestId('write-review')).toHaveAttribute(
    'href',
    `/me/purchases?review=${ORDER}`,
  );

  await cards.nth(1).getByTestId('helpful').click();
  await expect(cards.nth(1).getByTestId('vote-note')).toContainText('counts fully');
  expect(calls.find((c) => c.path === '/reviews/r2/vote')?.body).toEqual({ helpful: true });

  await panel.getByRole('button', { name: /Critical/ }).click();
  await expect.poll(() => calls.some((c) => c.search.includes('filter=critical'))).toBe(true);
  await page.getByTestId('review-sort').selectOption('newest');
  await expect.poll(() => calls.some((c) => c.search.includes('sort=newest'))).toBe(true);
});

test('listing reviews: an honest empty state, never sample reviews', async ({ page }) => {
  await stub(page, 'anon', { empty: true });
  await page.goto(`/l/${SLUG}`);
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await expect(page.getByTestId('reviews-empty')).toContainText('No reviews yet');
  await expect(page.getByTestId('review-summary')).toHaveCount(0);
  await expect(page.getByTestId('write-review')).toHaveCount(0);
});

test('creator replies once from the listing', async ({ page }) => {
  const calls = await stub(page, 'creator');
  await page.goto(`/l/${SLUG}`);
  await page.getByRole('tab', { name: /Reviews/ }).click();
  const second = page.getByTestId('review').nth(1);
  await second.getByTestId('reply').click();
  await second.getByTestId('reply-text').fill('Fixed in v1.4.2, thanks for flagging it.');
  await second.getByTestId('reply-save').click();
  await expect
    .poll(() => calls.find((c) => c.path === '/reviews/r2/reply'))
    .toMatchObject({ method: 'PUT', body: { body: 'Fixed in v1.4.2, thanks for flagging it.' } });
  // Creators never get a "Write a review" button on their own listing.
  await expect(page.getByTestId('write-review')).toHaveCount(0);
});

test('purchases: sign and post a review of a released order (free, no transaction)', async ({
  page,
}) => {
  const calls = await stub(page, 'buyer');
  await page.goto(`/me/purchases?review=${ORDER}`);
  const dialog = page.getByTestId('review-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Review Bundle Detector Overlay');
  await expect(dialog).toContainText('Order released');
  await dialog.getByTestId('star-4').click();
  await dialog.getByTestId('review-text').fill('too short');
  await dialog.getByTestId('post-review').click();
  await expect(dialog.getByTestId('review-error')).toContainText('at least 40');
  const text =
    'Caught two bundled launches on day one. Hover shows the funding wallet, which is the part I use.';
  await dialog.getByTestId('review-text').fill(text);
  await dialog.getByRole('button', { name: /Axiom/ }).click();
  await dialog.getByTestId('post-review').click();
  await expect(page.getByTestId('toast')).toContainText('Review posted');

  const posted = calls.find((c) => c.path === `/orders/${ORDER}/review`)!;
  expect(posted.body).toMatchObject({
    rating: 4,
    body: text,
    versionId: VERSION,
    terminal: 'Axiom',
  });
  const message = reviewMessage({
    orderId: ORDER,
    rating: 4,
    semver: '1.4.2',
    bodySha256: createHash('sha256').update(text).digest('hex'),
  });
  expect(
    nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(posted.body.signature),
      buyer.publicKey,
    ),
  ).toBe(true);
  // Signing a message only: nothing went to /tx/send.
  expect(calls.some((c) => c.path === '/tx/send')).toBe(false);
});

test('purchases: released orders offer a review', async ({ page }) => {
  await stub(page, 'buyer');
  await page.goto('/me/purchases');
  await page.getByRole('tab', { name: /Completed/ }).click();
  await expect(page.getByTestId('order-card').getByTestId('write-review')).toBeVisible();
});
