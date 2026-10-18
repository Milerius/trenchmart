import { expect, test, type Page } from '@playwright/test';
import { studioListing, studioOverview } from './studio-fixtures';

// /studio must feel instant: the dashboard reads start with the page (not after the /me
// session check), there is no "Connect wallet" flash while the session is being checked, and
// coming back to the studio renders the last data at once while it refreshes.

const WALLET = 'H4kHTS2dSvuJX6NL4KxYRsPBZvHNc79rTpmnWm2ecdbZ';
const REQ = {
  xLinked: true,
  bondRequired: '0',
  bondActive: '0',
  bondOk: true,
  verificationFee: '0',
  feeWaived: true,
};
const OVERVIEW = studioOverview(
  WALLET,
  {
    creator: {
      wallet: WALLET,
      handle: 'rugradar',
      memberSince: '2026-03-02T00:00:00.000Z',
      displayName: 'RugRadar',
      avatarUrl: null,
      xHandle: null,
      xVerified: false,
      profileFilled: { done: 1, of: 5 },
    },
  },
  [studioListing({ id: 'L1', slug: 'pack', title: 'Speed Pack' })],
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stub(page: Page, opts: { signedIn?: boolean; meDelay?: number } = {}) {
  const calls: { path: string; at: number; done?: number }[] = [];
  let overviewDelay = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const call: { path: string; at: number; done?: number } = { path, at: Date.now() };
    calls.push(call);
    const json = async (body: unknown, status = 200, delay = 0) => {
      if (delay) await sleep(delay);
      call.done = Date.now();
      return route.fulfill({ status, json: body });
    };
    const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'sign in' } };
    if (path === '/me')
      return opts.signedIn === false
        ? json(unauthorized, 401, opts.meDelay)
        : json(
            { user: { id: 'u1', wallet: WALLET, handle: 'rugradar', roles: [] }, tier: 'none' },
            200,
            opts.meDelay,
          );
    if (path.startsWith('/studio/') && opts.signedIn === false) return json(unauthorized, 401);
    if (path === '/studio/requirements') return json(REQ);
    if (path === '/studio/overview') return json(OVERVIEW, 200, overviewDelay);
    if (path === '/studio/payouts')
      return json({ total: { lamports: '0', usdCents: null }, payouts: [] });
    if (path === '/listings') return json([]);
    return route.fallback();
  });
  return { calls, slowOverview: (ms: number) => (overviewDelay = ms) };
}

test('studio reads start in parallel with the session check, with no connect flash', async ({
  page,
}) => {
  const { calls } = await stub(page, { meDelay: 1_200 });
  await page.goto('/studio');
  await expect(page.getByTestId('studio')).toBeVisible();
  // While /me is still pending the studio frame is shown, not the connect screen.
  await expect(page.getByText('Connect a wallet to open the studio.')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'RugRadar' })).toBeVisible();
  const me = calls.find((c) => c.path === '/me')!;
  const overview = calls.find((c) => c.path === '/studio/overview')!;
  expect(overview.at).toBeLessThan(me.done ?? Infinity);
  // Exactly one read of each: the session arriving does not trigger a second round.
  await page.waitForTimeout(300);
  expect(calls.filter((c) => c.path === '/studio/overview')).toHaveLength(1);
});

test('coming back to the studio renders the last data at once, then refreshes', async ({
  page,
}) => {
  const { calls, slowOverview } = await stub(page);
  await page.goto('/studio');
  await expect(page.getByText('Speed Pack').filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Explore' }).first().click();
  await expect(page).toHaveURL(/\/$/);
  slowOverview(3_000);
  const before = calls.filter((c) => c.path === '/studio/overview').length;
  await page.getByRole('link', { name: 'Studio' }).first().click();
  // Shown from the cache well before the slow refresh answers.
  await expect(page.getByText('Speed Pack').filter({ visible: true }).first()).toBeVisible({
    timeout: 1_000,
  });
  await expect(page.getByRole('heading', { level: 1, name: 'RugRadar' })).toBeVisible({
    timeout: 1_000,
  });
  await expect
    .poll(() => calls.filter((c) => c.path === '/studio/overview').length)
    .toBe(before + 1);
});

test('signed out: the connect screen still appears once the session check answers', async ({
  page,
}) => {
  await stub(page, { signedIn: false, meDelay: 300 });
  await page.goto('/studio');
  await expect(page.getByText('Connect a wallet to open the studio.')).toBeVisible();
});
