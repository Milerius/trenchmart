import { expect, test, type Page } from '@playwright/test';

// Weighted listing upvotes and the rank breakdown on the listing page, plus rank badges and
// upvote counts on market cards. /api/v1 is stubbed (the CI e2e job runs without the API).

const SLUG = 'bundle-detector-overlay';
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
  terminals: ['Axiom'],
  price: '1200000000',
  license: 'single',
  holderOnly: false,
  ratingAvg: '4.80',
  ratingCount: 12,
  upvotes: 41,
  rank: { category: 3, overall: 12 },
  handle: 'rugradar',
  creator: { handle: 'rugradar', wallet: CREATOR, bondLamports: '1000000000' },
  preview: null,
  security: null,
  content: null,
};
const RANK = {
  category: 3,
  overall: 12,
  categoryLabel: 'Userscripts',
  score: 0.854,
  parts: {
    sales: 18,
    bayes: 4.61,
    upvotes: 33.5,
    salesPart: 0.82,
    ratingPart: 0.97,
    upvotesPart: 0.74,
    reviews: 12,
    paused: null,
    leader: { sales: 22, bayes: 4.75, upvotes: 45 },
  },
  rankedAt: new Date().toISOString(),
  weights: { sales: 0.5, rating: 0.3, upvotes: 0.2 },
  windowDays: 30,
};

function state(upvoted: boolean, signedIn: boolean) {
  return {
    count: upvoted ? 42 : 41,
    counted: upvoted ? 34.5 : 33.5,
    mix: { buyers: upvoted ? 27 : 26, holders: 15, others: 0 },
    weights: { buyer: '1.0×', holder: '0.5×', holderMinTier: 'scout' },
    rank: RANK,
    viewer: signedIn
      ? {
          upvoted,
          isCreator: false,
          weight: {
            bps: 10000,
            label: '1.0×',
            reason: 'Your vote counts fully: this wallet has a released order.',
          },
          usedToday: upvoted ? 1 : 0,
          perDay: 30,
        }
      : null,
  };
}

async function stub(page: Page, signedIn: boolean) {
  const posts: unknown[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/me')
      return signedIn
        ? json({
            user: {
              id: 'u1',
              wallet: 'Gk2P9fTa11111111111111111111111111111111',
              handle: null,
              roles: ['buyer'],
            },
            tier: 'none',
          })
        : json({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401);
    if (path === '/config/public') return json(CONFIG);
    if (path === `/listings/${SLUG}`) return json(LISTING);
    if (path === `/listings/${SLUG}/versions`) return json([]);
    if (path === `/listings/${SLUG}/upvotes`) return json(state(false, signedIn));
    if (path === `/listings/${SLUG}/upvote`) {
      const body = JSON.parse(request.postData() ?? '{}') as { up: boolean };
      posts.push(body);
      return json(state(body.up, true));
    }
    if (path === '/listings')
      return json([
        LISTING,
        { ...LISTING, id: 'x2', slug: 'plain', title: 'Plain Pack', upvotes: 0, rank: null },
      ]);
    return json({ error: { code: 'NOT_FOUND', message: 'nf' } }, 404);
  });
  return posts;
}

test('listing: upvote with the wallet weight explained, and the rank breakdown', async ({
  page,
}) => {
  const posts = await stub(page, true);
  await page.goto(`/l/${SLUG}`);
  const panel = page.getByTestId('upvote-panel');
  await expect(panel.getByTestId('upvote-count')).toHaveText('41');
  await expect(panel).toContainText('33.5 counted');
  await expect(panel.getByTestId('upvote-weight')).toContainText('counts fully');
  await panel.getByTestId('upvote').click();
  await expect(panel.getByTestId('upvote')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('upvote-count')).toHaveText('42');
  await expect(page.getByTestId('upvote-chip')).toContainText('42');
  expect(posts).toEqual([{ up: true }]);

  const rank = page.getByTestId('rank-panel');
  await expect(rank).toContainText('#3 in Userscripts');
  await expect(rank).toContainText('Counted sales · 30d');
  await expect(rank).toContainText('0.854');
  await expect(rank).toContainText('#12 overall');
  await expect(rank).toContainText('featuring never changes rank');
});

test('listing: signed out, upvoting asks to connect first', async ({ page }) => {
  const posts = await stub(page, false);
  await page.goto(`/l/${SLUG}`);
  await expect(page.getByTestId('upvote')).toHaveText(/Connect to upvote/);
  await expect(page.getByTestId('upvote-weight')).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('market cards: rank badge for category leaders and upvote counts, nothing invented', async ({
  page,
}) => {
  await stub(page, false);
  await page.goto('/search');
  const cards = page.getByTestId('listing-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByTestId('rank-badge')).toHaveText('#3 in Userscripts');
  await expect(cards.nth(0).getByTestId('card-upvotes')).toContainText('41');
  await expect(cards.nth(1).getByTestId('rank-badge')).toHaveCount(0);
  await expect(cards.nth(1).getByTestId('card-upvotes')).toHaveCount(0);
});
