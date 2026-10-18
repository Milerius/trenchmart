import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createSql } from '@trenchmart/db';

// /studio in a real browser against the real API and Postgres (no /api/v1 stubs), so a query
// the schema cannot answer shows up here. 2026-10-18: a brand-new creator (no listings, no X,
// no tier) got "Couldn't load the studio · Internal error" because /studio/overview 500'd.

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

const sql = createSql(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
);
const SHOTS = 'test-results/studio-overview';

test.afterAll(async () => {
  await sql.end();
});

/** A wallet that has never been seen: /auth/verify creates its user row. */
async function signInFresh(page: Page) {
  const pair = nacl.sign.keyPair();
  const wallet = bs58.encode(pair.publicKey);
  await page.goto('/');
  const { message } = await page.evaluate(async (wallet) => {
    const r = await fetch('/api/v1/auth/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    return (await r.json()) as { message: string };
  }, wallet);
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey),
  );
  const status = await page.evaluate(
    async ([wallet, signature]) =>
      (
        await fetch('/api/v1/auth/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet, signature }),
        })
      ).status,
    [wallet, signature],
  );
  expect(status).toBe(200);
  return wallet;
}

async function openStudio(page: Page) {
  const overview = page.waitForResponse((r) => r.url().includes('/api/v1/studio/overview'));
  await page.goto('/studio');
  const res = await overview;
  expect(res.status()).toBe(200);
  await expect(page.getByTestId('studio')).toBeVisible();
  await expect(page.getByText("Couldn't load the studio")).toHaveCount(0);
  return (await res.json()) as Record<string, any>;
}

test('studio: a brand-new creator with no listings gets the empty dashboard, not an error', async ({
  page,
}) => {
  const wallet = await signInFresh(page);
  const body = await openStudio(page);
  expect(body.creator).toMatchObject({ wallet, xHandle: null, xVerified: false });
  expect(body.listings).toEqual([]);
  expect(body.rating).toBeNull();
  await expect(page.getByText('No listings yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your first listing' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/empty-creator.png`, fullPage: true });
});

test('studio: a creator with a live listing, a sale and a review sees them', async ({ page }) => {
  const wallet = await signInFresh(page);
  const [creator] = await sql<{ id: string }[]>`select id from users where wallet = ${wallet}`;
  const [buyer] = await sql<{ id: string }[]>`
    insert into users (wallet) values (${bs58.encode(nacl.sign.keyPair().publicKey)}) returning id
  `;
  const listingId = randomUUID();
  const versionId = randomUUID();
  const orderId = randomUUID();
  const slug = `studio-e2e-${listingId.slice(0, 8)}`;
  await sql`
    insert into listings (id, creator_id, slug, title, summary, description, category, price)
    values (${listingId}, ${creator!.id}, ${slug}, 'Studio E2E Sniper', 'Sum', 'Desc', 'userscript', ${1_000_000_000n})
  `;
  await sql`
    insert into versions (id, listing_id, semver, file_name, file_size, sha256, r2_key, status)
    values (${versionId}, ${listingId}, '1.2.0', 'pack.user.js', 5, ${'sha' + versionId}, 'blobs/x', 'live')
  `;
  await sql`update listings set live_version_id = ${versionId}, first_live_at = now() where id = ${listingId}`;
  await sql`
    insert into orders (
      id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
      tier_at_purchase, memo, status, paid_at, escrow_until, expires_at, released_at
    ) values (
      ${orderId}, ${buyer!.id}, ${listingId}, ${versionId}, ${1_000_000_000n}, 500, 0, 0, 0, ${1_000_000_000n},
      'none', ${'tm:' + orderId.slice(0, 8)}, 'released', now(), now(), now(), now()
    )
  `;
  await sql`
    insert into listing_reviews (listing_id, order_id, reviewer_id, version_id, rating, body)
    values (${listingId}, ${orderId}, ${buyer!.id}, ${versionId}, 4, 'Solid filters, fires on time.')
  `;

  const body = await openStudio(page);
  expect(body.sales.total30d).toBe(1);
  expect(body.rating).toMatchObject({ avg: 4, count: 1 });
  expect(body.listings).toHaveLength(1);
  expect(body.listings[0]).toMatchObject({
    slug,
    sales: 1,
    rating: { avg: 4, count: 1 },
    live: { semver: '1.2.0', status: 'live' },
  });
  await expect(page.getByText('No listings yet')).toHaveCount(0);
  await expect(
    page.getByTestId('studio-listing-row').filter({ hasText: 'Studio E2E Sniper' }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/creator-with-listings.png`, fullPage: true });
});
