/**
 * Captures the README screenshots from the real running app.
 *
 *   pnpm db:seed
 *   pnpm --filter @trenchmart/api start   # API on :8787
 *   pnpm --filter @trenchmart/web dev     # web on :3000
 *   pnpm screenshots
 *
 * It writes demo fixtures into the local database (a buyer with Trencher-tier
 * $TRENCH, three orders in different escrow states, creator payouts) and signs
 * in through the app's test wallet hook. Tier thresholds are set to demo values
 * while it runs and restored afterwards. `pnpm db:seed` resets everything.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createSql } from '@trenchmart/db';
import { quote } from '@trenchmart/shared';

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const OUT_DIR = process.env.SCREENSHOT_DIR ?? 'docs/screenshots';
const QUALITY = 0.86;
const HOUR = 3_600_000;
const DEMO_LISTING_SLUG = 'pulse-volume-heatmap';
const DEMO_THRESHOLDS = { scout: '1000000000', trencher: '10000000000', og: '100000000000' };

const sql = createSql(DATABASE_URL);

function demoKey(label: string): nacl.SignKeyPair {
  const seed = createHash('sha256').update(`trenchmart-screenshots:${label}`).digest();
  return nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
}

const buyer = demoKey('buyer');
const creator = demoKey('creator');
const buyerWallet = bs58.encode(buyer.publicKey);
const creatorWallet = bs58.encode(creator.publicKey);

async function prepare(): Promise<() => Promise<void>> {
  const [thresholds] = await sql<{ value: unknown }[]>`
    select value from config where key = 'tier_thresholds'
  `;
  await sql`
    update config set value = ${sql.json(DEMO_THRESHOLDS)} where key = 'tier_thresholds'
  `;
  const restore = async () => {
    if (thresholds) {
      await sql`update config set value = ${sql.json(thresholds.value as never)} where key = 'tier_thresholds'`;
    }
  };

  await removeDemoListings();

  const [seller] = await sql<{ id: string }[]>`
    select id from users where handle = 'rugradar' or wallet = ${creatorWallet} limit 1
  `;
  if (!seller) throw new Error('Seed data is missing. Run `pnpm db:seed` first.');
  await sql`update users set wallet = ${creatorWallet} where id = ${seller.id}`;

  await sql`
    insert into users (wallet, roles, handle)
    values (${buyerWallet}, ${sql.array(['buyer'])}::user_role[], 'trencher_demo')
    on conflict (wallet) do nothing
  `;
  const [buyerRow] = await sql<
    { id: string }[]
  >`select id from users where wallet = ${buyerWallet}`;
  if (!buyerRow) throw new Error('buyer insert failed');

  await sql`delete from token_balances where wallet = ${buyerWallet}`;
  await sql`
    insert into token_balances (wallet, amount, ts, source)
    values (${buyerWallet}, ${'25000000000'}, ${new Date(Date.now() - 96 * HOUR)}, 'snapshot')
  `;

  const old = await sql<{ id: string }[]>`select id from orders where buyer_id = ${buyerRow.id}`;
  const oldIds = old.map((row) => row.id);
  if (oldIds.length) {
    await sql`delete from disputes where order_id in ${sql(oldIds)}`;
    await sql`delete from licenses where order_id in ${sql(oldIds)}`;
    await sql`delete from downloads where order_id in ${sql(oldIds)}`;
    await sql`delete from payouts where order_id in ${sql(oldIds)}`;
    await sql`delete from listing_reviews where order_id in ${sql(oldIds)}`;
    await sql`delete from orders where id in ${sql(oldIds)}`;
  }

  const now = Date.now();
  const orders: [string, string, number, number | null, number | null][] = [
    ['bundle-detector-overlay', 'paid', -6, 42, null],
    ['migration-sniper-presets', 'disputed', -20, 28, null],
    ['120-early-wallets-q4', 'released', -74, -26, -26],
  ];
  for (const [slug, status, paidH, escrowH, releasedH] of orders) {
    const [listing] = await sql<{ id: string; live_version_id: string; price: string }[]>`
      select id, live_version_id, price::text as price from listings where slug = ${slug}
    `;
    if (!listing) throw new Error(`missing listing ${slug}`);
    const priced = quote(BigInt(listing.price), 500, 6000);
    const [order] = await sql<{ id: string }[]>`
      insert into orders (
        buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
        tier_at_purchase, memo, status, tx_sig, paid_at, escrow_until, released_at, expires_at,
        disputed_from
      ) values (
        ${buyerRow.id}, ${listing.id}, ${listing.live_version_id}, ${priced.price}, 500, 6000,
        ${priced.fee}, ${priced.rebate}, ${priced.total}, 'trencher', ${`shot-${randomUUID()}`},
        ${status}::order_status, ${bs58.encode(nacl.randomBytes(64))}, ${new Date(now + paidH * HOUR)},
        ${escrowH === null ? null : new Date(now + escrowH * HOUR)},
        ${releasedH === null ? null : new Date(now + releasedH * HOUR)},
        ${new Date(now + paidH * HOUR + 20 * 60_000)},
        ${status === 'disputed' ? 'paid' : null}
      ) returning id
    `;
    await sql`insert into licenses (order_id, wallet) values (${order!.id}, ${buyerWallet})`;
    if (status === 'disputed') {
      await sql`
        insert into disputes (order_id, opened_by, reason, details)
        values (${order!.id}, ${buyerRow.id}, 'not_as_described', 'Presets do not include the migration filter shown on the listing.')
      `.catch(() => undefined);
    }
  }

  await sql`delete from payouts where recipient = ${creatorWallet} and batch_id = 'screenshots'`;
  const payouts: [string, string, number][] = [
    ['1200000000', 'sent', -70],
    ['1200000000', 'sent', -50],
    ['1200000000', 'proposed', -6],
    ['1200000000', 'pending', -1],
  ];
  for (const [amount, status, hours] of payouts) {
    await sql`
      insert into payouts (recipient, bucket, amount, status, batch_id, created_at)
      values (${creatorWallet}, 'creator', ${amount}, ${status}::payout_status, 'screenshots', ${new Date(now + hours * HOUR)})
    `;
  }
  return restore;
}

async function removeDemoListings() {
  const listings = await sql<{ id: string }[]>`
    select id from listings where slug like ${`${DEMO_LISTING_SLUG}%`}
  `;
  const ids = listings.map((row) => row.id);
  if (!ids.length) return;
  const versions = await sql<
    { id: string }[]
  >`select id from versions where listing_id in ${sql(ids)}`;
  const vids = versions.map((row) => row.id);
  await sql`update listings set live_version_id = null where id in ${sql(ids)}`;
  if (vids.length) {
    for (const table of ['ai_reviews', 'sandbox_jobs', 'scans', 'downloads']) {
      await sql`delete from ${sql(table)} where version_id in ${sql(vids)}`;
    }
    await sql`delete from versions where id in ${sql(vids)}`;
  }
  for (const table of ['listing_media', 'listing_reviews', 'reports']) {
    await sql`delete from ${sql(table)} where listing_id in ${sql(ids)}`;
  }
  await sql`delete from listings where id in ${sql(ids)}`;
}

async function context(
  browser: Browser,
  options: { mobile?: boolean; secret?: Uint8Array } = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: options.mobile ?? false,
    hasTouch: options.mobile ?? false,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    baseURL: BASE_URL,
  });
  await ctx.addInitScript(
    (secret) => {
      if (secret) window.__TRENCHMART_E2E_SECRET__ = secret;
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    },
    options.secret ? bs58.encode(options.secret) : '',
  );
  return ctx;
}

async function signIn(page: Page, tierText?: RegExp) {
  await page.goto('/');
  await page.getByTestId('connect').click();
  await page
    .getByTestId('connect')
    .filter({ hasText: /^\S{4}…\S{4}$/ })
    .waitFor({ timeout: 15_000 });
  if (tierText) await page.getByTestId('tier-pill').first().filter({ hasText: tierText }).waitFor();
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function save(page: Page, name: string, clip?: { y: number; height: number }) {
  await settle(page);
  const viewport = page.viewportSize()!;
  const png = await page.screenshot({
    fullPage: !!clip,
    clip: clip ? { x: 0, y: clip.y, width: viewport.width, height: clip.height } : undefined,
  });
  const webp = await page.evaluate(
    async ({ data, quality }) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      const out = await canvas.convertToBlob({ type: 'image/webp', quality });
      const bytes = new Uint8Array(await out.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { data: png.toString('base64'), quality: QUALITY },
  );
  const file = join(OUT_DIR, `${name}.webp`);
  await writeFile(file, Buffer.from(webp, 'base64'));
  console.log(`saved ${file}`);
}

const DEMO_SCRIPT = (stamp: string) => `// ==UserScript==
// @name         Pulse Volume Heatmap
// @namespace    trenchmart
// @version      1.0.0
// @description  Colours Axiom Pulse rows by 5-minute volume. Reads the page only.
// @match        https://axiom.trade/*
// @grant        none
// ==/UserScript==
// build ${stamp}
(function () {
  'use strict';
  const root = globalThis.document;
  if (!root) return;
  const shade = (volume) => (volume > 50000 ? '#C6F43233' : volume > 10000 ? '#F5A52422' : '');
  for (const row of root.querySelectorAll('[data-pulse-row]')) {
    row.style.background = shade(Number(row.getAttribute('data-volume') || 0));
  }
})();
`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const restore = await prepare();
  const browser = await chromium.launch();
  try {
    const guest = await context(browser);
    const page = await guest.newPage();
    await page.goto('/');
    await page.getByTestId('listing-card').first().waitFor();
    await save(page, '01-landing', { y: 0, height: 1000 });
    await page.goto('/l/bundle-detector-overlay');
    await page.getByTestId('fee-breakdown').waitFor();
    await save(page, '02-listing', { y: 0, height: 1000 });
    await guest.close();

    const buyerCtx = await context(browser, { secret: buyer.secretKey });
    const buyerPage = await buyerCtx.newPage();
    await signIn(buyerPage, /Trencher/);
    await buyerPage.goto('/l/bundle-detector-overlay');
    const fees = buyerPage.getByTestId('fee-breakdown');
    await fees.filter({ hasText: 'Trencher discount' }).waitFor();
    await fees.getByText('Where the fee goes').click();
    await save(buyerPage, '03-checkout-fee-breakdown', { y: 0, height: 1000 });
    await buyerPage.goto('/me/purchases');
    await buyerPage.getByTestId('escrow-timeline').first().waitFor();
    await save(buyerPage, '04-escrow-status', { y: 0, height: 1000 });
    await buyerCtx.close();

    const creatorCtx = await context(browser, { secret: creator.secretKey });
    const creatorPage = await creatorCtx.newPage();
    await signIn(creatorPage);
    await creatorPage.goto('/studio/listings/new');
    await creatorPage.getByLabel('Title').fill('Pulse Volume Heatmap');
    await creatorPage.getByLabel('Summary').fill('Colours Axiom Pulse rows by 5-minute volume');
    await creatorPage
      .getByLabel('Description')
      .fill(
        'Colours Axiom Pulse rows by 5-minute volume. Reads the page only: no wallet access, no network calls.',
      );
    await creatorPage.getByLabel('Terminals').fill('Axiom');
    await creatorPage.getByLabel('Price (SOL)').fill('0.75');
    await creatorPage.locator('input[type=file]').setInputFiles({
      name: 'pulse-volume-heatmap.user.js',
      mimeType: 'text/javascript',
      buffer: Buffer.from(DEMO_SCRIPT(new Date().toISOString())),
    });
    await creatorPage.getByRole('button', { name: 'Create and start review' }).click();
    await creatorPage.getByTestId('review-outcome').waitFor({ timeout: 120_000 });
    await save(creatorPage, '06-live-ai-review', { y: 0, height: 1000 });
    await creatorPage.goto('/studio');
    await creatorPage.getByTestId('dashboard').filter({ hasText: 'SENT' }).waitFor();
    await save(creatorPage, '05-creator-dashboard', { y: 0, height: 1000 });
    await creatorCtx.close();

    const mobile = await context(browser, { mobile: true, secret: buyer.secretKey });
    const phone = await mobile.newPage();
    await signIn(phone);
    await phone.goto('/l/bundle-detector-overlay#checkout');
    await phone.getByTestId('fee-breakdown').filter({ hasText: 'Trencher discount' }).waitFor();
    await phone.locator('#checkout').scrollIntoViewIfNeeded();
    await save(phone, '07-mobile-checkout');
    await mobile.close();
  } finally {
    await browser.close();
    await restore();
    await sql.end();
  }
}

await main();
