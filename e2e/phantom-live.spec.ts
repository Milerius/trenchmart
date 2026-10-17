/**
 * Live end-to-end test against a deployed TrenchMart (default https://trenchmart.fun) with the
 * real Phantom extension. Devnet only. It does not run in the normal e2e job: it needs
 * PHANTOM_LIVE=1, an unpacked Phantom extension, and devnet keypairs.
 *
 *   PHANTOM_LIVE=1 PHANTOM_EXT_DIR=/path/to/phantom/unpacked \
 *   E2E_BUYER_KEYPAIR=~/.config/trenchmart/e2e/buyer.json \
 *   E2E_CREATOR_KEYPAIR=~/.config/trenchmart/e2e/creator.json \
 *   E2E_LISTING_FILE=./listing.user.js \
 *   xvfb-run -a pnpm exec playwright test -c playwright.phantom.config.ts
 *
 * A keypair can also be given as E2E_BUYER_SECRET / E2E_CREATOR_SECRET: a JSON byte array or a
 * base58 secret key. Keys are only typed into Phantom's import form, never logged.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

const SITE = (process.env.E2E_SITE_URL ?? 'https://trenchmart.fun').replace(/\/$/, '');
const EXT_DIR = process.env.PHANTOM_EXT_DIR ?? '';
const EXT_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const OUT = process.env.E2E_OUT_DIR ?? path.resolve('test-results/phantom-live');
const RPC = process.env.E2E_RPC_URL ?? 'https://api.devnet.solana.com';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
// Throwaway Phantom unlock password for the temporary profile (zxcvbn rejects weak ones).
const PASSWORD = `Tm-${randomBytes(12).toString('hex')}-e2e!`;
const LISTING = {
  title: process.env.E2E_LISTING_TITLE ?? 'Trojan Trenches Intel (Animal + Reuse + OG + Bag Guard)',
  summary:
    process.env.E2E_LISTING_SUMMARY ??
    'Labels unnamed-animal coins, shows reuse history, finds the OG and guards your bags on Trojan.',
  description:
    process.env.E2E_LISTING_DESCRIPTION ??
    [
      'Tampermonkey userscript for trojan.com trenches.',
      '- Unnamed-animal labels: flags coins named after a bare animal.',
      '- Reuse history: shows when a name, image or migrated history was used before.',
      '- OG finder: points to the original coin a copy is riding on.',
      '- "Copy is moving" alerts when a copy of a coin you watch starts pumping.',
      '- Bag Guard: warns when a coin you hold looks like a reused copy.',
    ].join('\n'),
  category: process.env.E2E_LISTING_CATEGORY ?? 'userscript',
  terminals: process.env.E2E_LISTING_TERMINALS ?? 'Trojan',
  priceSol: process.env.E2E_LISTING_PRICE_SOL ?? '0.1',
  file: process.env.E2E_LISTING_FILE ?? '',
};

test.skip(!process.env.PHANTOM_LIVE, 'set PHANTOM_LIVE=1 to run the live Phantom suite');
test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

type Issue = { step: string; kind: string; detail: string };
const issues: Issue[] = [];
const results: { step: string; status: 'pass' | 'fail' | 'skip'; note?: string }[] = [];
let currentStep = 'setup';

function secretFor(role: 'buyer' | 'creator'): Uint8Array {
  const upper = role.toUpperCase();
  const raw =
    process.env[`E2E_${upper}_SECRET`] ??
    fs.readFileSync(
      (process.env[`E2E_${upper}_KEYPAIR`] ?? `~/.config/trenchmart/e2e/${role}.json`).replace(
        /^~/,
        os.homedir(),
      ),
      'utf8',
    );
  const text = raw.trim();
  return text.startsWith('[') ? Uint8Array.from(JSON.parse(text) as number[]) : bs58.decode(text);
}

function pubkeyOf(secret: Uint8Array): string {
  return bs58.encode(secret.slice(32, 64));
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

async function balanceSol(pubkey: string): Promise<number | null> {
  try {
    const r = await rpc<{ value: number }>('getBalance', [pubkey, { commitment: 'confirmed' }]);
    return r.value / 1e9;
  } catch {
    return null;
  }
}

function watch(page: Page) {
  page.on('console', (m) => {
    if (m.type() === 'error')
      issues.push({ step: currentStep, kind: 'console', detail: m.text().slice(0, 500) });
  });
  page.on('pageerror', (e) =>
    issues.push({ step: currentStep, kind: 'pageerror', detail: e.message.slice(0, 500) }),
  );
  page.on('requestfailed', (r) =>
    issues.push({
      step: currentStep,
      kind: 'requestfailed',
      detail: `${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`,
    }),
  );
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/api/v1/me'))
      issues.push({
        step: currentStep,
        kind: `http ${r.status()}`,
        detail: `${r.request().method()} ${r.url()}`,
      });
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }).catch(() => {});
}

async function step(name: string, fn: () => Promise<void>) {
  currentStep = name;
  await test.step(name, async () => {
    try {
      await fn();
      results.push({ step: name, status: 'pass' });
    } catch (err) {
      const note = (err instanceof Error ? err.message.split('\n')[0] : String(err)) ?? '';
      results.push({ step: name, status: note.startsWith('SKIP:') ? 'skip' : 'fail', note });
      if (!note.startsWith('SKIP:')) throw err;
    }
  });
}

async function launchPhantom(role: 'buyer' | 'creator'): Promise<BrowserContext> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `phantom-${role}-`));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: process.env.E2E_HEADLESS === '1',
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker', { timeout: 30_000 });
  return ctx;
}

async function onboard(ctx: BrowserContext, role: 'buyer' | 'creator') {
  const page =
    ctx.pages().find((p) => p.url().includes('onboarding')) ??
    (await ctx
      .waitForEvent('page', { predicate: (p) => p.url().includes('onboarding'), timeout: 15_000 })
      .catch(() => null)) ??
    (await ctx.newPage());
  if (!page.url().includes('onboarding'))
    await page.goto(`chrome-extension://${EXT_ID}/onboarding.html`);
  await page.getByText('I already have a wallet').click();
  await page.getByText('Import Private Key').click();
  await page.getByPlaceholder('Name').fill(`e2e-${role}`);
  await page.getByPlaceholder('Private key').fill(bs58.encode(secretFor(role)));
  await page.getByTestId('onboarding-form-submit-button').click();
  await page.getByTestId('onboarding-form-password-input').fill(PASSWORD);
  await page.getByTestId('onboarding-form-confirm-password-input').fill(PASSWORD);
  const terms = page.getByTestId('onboarding-form-terms-of-service-checkbox');
  await terms.click();
  await expect(page.getByTestId('onboarding-form-submit-button')).toBeEnabled();
  await page.getByTestId('onboarding-form-submit-button').click();
  // The wallet exists once Phantom asks for an optional username; skip that step.
  try {
    await page.getByPlaceholder('username').waitFor({ timeout: 45_000 });
  } catch (err) {
    await shot(page, `${role}-00-phantom-onboarding-stuck`);
    throw err;
  }
  await shot(page, `${role}-00-phantom-imported`);
  await page.close();
}

async function useDevnet(ctx: BrowserContext, role: string) {
  const page = await ctx.newPage();
  try {
    await switchToDevnet(page, role);
  } catch (err) {
    await shot(page, `${role}-01-phantom-devnet-stuck`);
    throw err;
  } finally {
    await page.close();
  }
}

async function openDeveloperSettings(page: Page) {
  await page.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await unlockIfNeeded(page);
  await page.getByTestId('settings-menu-open-button').click();
  await page.getByTestId('sidebar_menu-button-settings').click();
  await page.getByText('Developer Settings').click();
  await page.getByTestId('toggleTestNetwork').waitFor();
}

async function switchToDevnet(page: Page, role: string) {
  await page.setViewportSize({ width: 400, height: 640 });
  await openDeveloperSettings(page);
  const devnetRow = page.locator('button', { hasText: /^Solana Devnet$/ });
  if (!(await devnetRow.count())) {
    // Turning Testnet Mode on sends the popup back to the home screen.
    await page.getByTestId('toggleTestNetwork').click();
    await page.waitForTimeout(1500);
    await openDeveloperSettings(page);
  }
  const checkbox = devnetRow.getByRole('checkbox');
  if ((await checkbox.getAttribute('aria-checked')) !== 'true') await devnetRow.click();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  await shot(page, `${role}-01-phantom-devnet`);
}

async function unlockIfNeeded(page: Page) {
  await page.waitForLoadState().catch(() => {});
  await page.waitForTimeout(1500);
  if (await page.getByTestId('unlock-form-submit-button').count()) {
    await page.locator('input[type=password]').fill(PASSWORD);
    await page.getByTestId('unlock-form-submit-button').click();
    await page.waitForTimeout(2000);
  }
}

/** Approves Phantom notification popups until none shows up for `idleMs`. Returns popup texts. */
async function approvePhantom(
  ctx: BrowserContext,
  trigger: () => Promise<void>,
  tag: string,
  opts: { max?: number; idleMs?: number } = {},
): Promise<string[]> {
  const seen: string[] = [];
  const isPopup = (p: Page) => p.url().includes('notification.html');
  let next = ctx.waitForEvent('page', { predicate: isPopup, timeout: 20_000 }).catch(() => null);
  await trigger();
  for (let i = 0; i < (opts.max ?? 4); i++) {
    const popup = ctx.pages().find((p) => isPopup(p) && !p.isClosed()) ?? (await next);
    if (!popup) break;
    next = ctx
      .waitForEvent('page', { predicate: isPopup, timeout: opts.idleMs ?? 8_000 })
      .catch(() => null);
    await unlockIfNeeded(popup);
    const primary = popup.getByTestId('primary-button');
    await primary.waitFor({ timeout: 20_000 }).catch(() => {});
    // Phantom keeps the confirm button disabled while it simulates a transaction.
    await popup.waitForTimeout(2500);
    const text = (await popup.evaluate(() => document.body.innerText).catch(() => '')).replace(
      /\s+/g,
      ' ',
    );
    seen.push(text.slice(0, 600));
    await shot(popup, `${tag}-phantom-${i}`);
    if (!(await primary.count())) break;
    if (await primary.isDisabled()) {
      issues.push({ step: currentStep, kind: 'phantom', detail: `confirm disabled: ${text}` });
      await popup
        .getByTestId('secondary-button')
        .click()
        .catch(() => {});
      break;
    }
    await primary.click();
    await popup.waitForEvent('close', { timeout: 15_000 }).catch(() => {});
  }
  return seen;
}

async function connectAndSignIn(ctx: BrowserContext, page: Page, role: string) {
  const button = page.getByTestId('connect');
  await expect(button).toHaveText(/Connect wallet/);
  const popups = await approvePhantom(ctx, () => button.click(), `${role}-connect`);
  await expect(page.getByTestId('connect')).toHaveText(/…/, { timeout: 30_000 });
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me', { credentials: 'include' });
    return { status: r.status, body: await r.json() };
  });
  expect(me.status, `GET /me after sign-in: ${JSON.stringify(me.body)}`).toBe(200);
  return popups;
}

async function wallets(page: Page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const found: { name: string; chains: readonly string[] }[] = [];
        const api = {
          register: (...ws: { name: string; chains: readonly string[] }[]) => {
            found.push(...ws.map((w) => ({ name: w.name, chains: w.chains })));
            return () => {};
          },
        };
        window.addEventListener('wallet-standard:register-wallet', (e) =>
          (e as CustomEvent).detail(api),
        );
        window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
        const w = window as unknown as {
          solana?: { isPhantom?: boolean };
          phantom?: { solana?: unknown };
        };
        setTimeout(
          () =>
            resolve({
              solana: !!w.solana,
              isPhantom: !!w.solana?.isPhantom,
              phantomSolana: !!w.phantom?.solana,
              standard: found,
            }),
          500,
        );
      }),
  );
}

const state: {
  creatorBlocked?: string;
  slug?: string;
  listingId?: string;
  versionId?: string;
  orderId?: string;
} = {
  slug: process.env.E2E_LISTING_SLUG,
};

test.beforeAll(async () => {
  expect(EXT_DIR, 'PHANTOM_EXT_DIR must point to the unpacked Phantom extension').not.toBe('');
  fs.mkdirSync(OUT, { recursive: true });
  const genesis = await rpc<string>('getGenesisHash').catch(() => null);
  if (genesis && genesis !== DEVNET_GENESIS) throw new Error(`E2E_RPC_URL is not devnet`);
});

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, issues }, null, 2));
});

test('creator lists a file and gets an AI review', async () => {
  test.skip(!LISTING.file, 'set E2E_LISTING_FILE to run the creator flow');
  const secret = secretFor('creator');
  const ctx = await launchPhantom('creator');
  try {
    await step('creator: import key into Phantom', () => onboard(ctx, 'creator'));
    await step('creator: switch Phantom to devnet', () => useDevnet(ctx, 'creator'));
    const page = await ctx.newPage();
    watch(page);
    await step('creator: connect and sign in', async () => {
      await page.goto(SITE);
      await connectAndSignIn(ctx, page, 'creator');
      await shot(page, 'creator-02-signed-in');
    });
    await step('creator: studio requirements, X handle and bond', async () => {
      await page.goto(`${SITE}/studio`);
      await expect(page.getByTestId('studio')).toBeVisible();
      const req = await page.evaluate(async () => {
        const r = await fetch('/api/v1/studio/requirements', { credentials: 'include' });
        return r.json();
      });
      await shot(page, 'creator-03-studio');
      if (!(req as { xLinked: boolean }).xLinked) {
        await page.getByLabel('X handle').fill(process.env.E2E_CREATOR_X ?? 'milerius');
        await page.getByRole('button', { name: 'Link X' }).click();
        await page.waitForTimeout(2000);
      }
      const { bondOk, bondRequired } = req as { bondOk: boolean; bondRequired: string };
      if (!bondOk) {
        const need = Number(bondRequired) / 1e9 + 0.3;
        const have = await balanceSol(pubkeyOf(secret));
        if (have !== null && have < need) {
          state.creatorBlocked = `creator has ${have} SOL; the ${LISTING.category} bond needs ${Number(bondRequired) / 1e9} SOL plus the verification fee`;
          throw new Error(`SKIP: ${state.creatorBlocked}`);
        }
        await page.getByLabel('Bond SOL').fill(String(Number(bondRequired) / 1e9));
        await approvePhantom(ctx, () => page.getByLabel('Bond SOL').press('Enter'), 'creator-bond');
        await expect(page.getByText(/bond/i).first()).toBeVisible();
        await page.waitForTimeout(5000);
      }
      await shot(page, 'creator-04-ready-to-sell');
    });
    await step('creator: create listing and upload file', async () => {
      if (state.creatorBlocked) throw new Error(`SKIP: ${state.creatorBlocked}`);
      await page.goto(`${SITE}/studio/listings/new`);
      await page.getByLabel('Title').fill(LISTING.title);
      await page.getByLabel('Summary').fill(LISTING.summary);
      await page.getByLabel('Description').fill(LISTING.description);
      await page.getByLabel('Category').selectOption(LISTING.category);
      await page.getByLabel('Terminals').fill(LISTING.terminals);
      await page.getByLabel('Price (SOL)').fill(LISTING.priceSol);
      await page.locator('input[type=file]').setInputFiles(LISTING.file);
      await shot(page, 'creator-05-new-listing-form');
      const created = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/studio/listings') && r.request().method() === 'POST',
      );
      await page.locator('form[data-testid=studio] button[type=submit]').click();
      const res = await created;
      if (!res.ok()) {
        await page.waitForTimeout(1000);
        await shot(page, 'creator-05b-create-listing-error');
        throw new Error(`POST /studio/listings ${res.status()}: ${await res.text()}`);
      }
      await page.waitForURL(/\/studio\/listings\/[^/]+\/versions\/[^/]+/, { timeout: 60_000 });
      const m = page.url().match(/listings\/([^/]+)\/versions\/([^/?]+)/);
      state.listingId = m?.[1];
      state.versionId = m?.[2];
    });
    await step('creator: AI review', async () => {
      if (state.creatorBlocked || !state.versionId) throw new Error('SKIP: no uploaded version');
      await expect(page.getByText(/Approved and live|Changes requested|Rejected/i)).toBeVisible({
        timeout: 5 * 60_000,
      });
      await shot(page, 'creator-06-ai-review');
      const v = await page.evaluate(async (id) => {
        const r = await fetch(`/api/v1/studio/versions/${id}`, { credentials: 'include' });
        return r.json();
      }, state.versionId);
      fs.writeFileSync(path.join(OUT, 'ai-review.json'), JSON.stringify(v, null, 2));
      const listings = await page.evaluate(async () => (await fetch('/api/v1/listings')).json());
      const found = (listings as { id: string; slug: string }[]).find(
        (l) => l.id === state.listingId,
      );
      state.slug ??= found?.slug;
      expect(found, 'listing is live after the review').toBeTruthy();
    });
  } finally {
    await ctx.close();
  }
});

test('buyer connects, browses, buys into escrow, releases and downloads', async () => {
  const secret = secretFor('buyer');
  const ctx = await launchPhantom('buyer');
  try {
    await step('buyer: import key into Phantom', () => onboard(ctx, 'buyer'));
    await step('buyer: switch Phantom to devnet', () => useDevnet(ctx, 'buyer'));
    const page = await ctx.newPage();
    watch(page);
    await step('landing', async () => {
      await page.goto(SITE);
      await expect(page.getByTestId('nav')).toBeVisible();
      fs.writeFileSync(path.join(OUT, 'providers.json'), JSON.stringify(await wallets(page)));
      await shot(page, 'buyer-02-landing');
    });
    await step('buyer: connect wallet and sign in', async () => {
      await connectAndSignIn(ctx, page, 'buyer');
      await shot(page, 'buyer-03-signed-in');
    });
    await step('browse listings', async () => {
      await page.goto(`${SITE}/search`);
      await page.waitForTimeout(3000);
      await shot(page, 'buyer-04-browse');
      const cards = page.getByTestId('listing-card');
      if (!state.slug) {
        if (!(await cards.count())) throw new Error('SKIP: no live listings to browse');
        const href = await cards.first().locator('a').first().getAttribute('href');
        state.slug = href?.split('/l/')[1];
      }
    });
    await step('listing detail', async () => {
      if (!state.slug) throw new Error('SKIP: no listing');
      await page.goto(`${SITE}/l/${state.slug}`);
      await expect(page.getByTestId('checkout')).toBeVisible({ timeout: 30_000 });
      await shot(page, 'buyer-05-listing');
    });
    await step('buy into escrow', async () => {
      if (!state.slug) throw new Error('SKIP: no listing');
      const have = await balanceSol(pubkeyOf(secret));
      if (have !== null && have < 0.02) throw new Error(`SKIP: buyer has ${have} SOL on devnet`);
      await approvePhantom(ctx, () => page.getByTestId('buy').click(), 'buyer-buy');
      await expect(page.getByText(/Confirmed on devnet|in escrow/i).first()).toBeVisible({
        timeout: 120_000,
      });
      await shot(page, 'buyer-06-bought');
    });
    await step('release escrow and download', async () => {
      if (!state.slug) throw new Error('SKIP: no listing');
      await page.goto(`${SITE}/me/purchases`);
      await expect(page.getByTestId('dashboard')).toBeVisible();
      await shot(page, 'buyer-07-purchases');
      // A paid order downloads at once while the funds stay in escrow until the window ends.
      // A locked button means the order is disputed.
      const button = page.getByTestId('download-button').first();
      await expect(button).toBeVisible({ timeout: 30_000 });
      if ((await button.getAttribute('data-state')) === 'locked')
        throw new Error(`SKIP: download locked: ${await button.innerText()}`);
      const download = page.waitForEvent('download', { timeout: 60_000 });
      await button.click();
      const file = await download;
      const saved = path.join(OUT, file.suggestedFilename());
      await file.saveAs(saved);
      await shot(page, 'buyer-08-downloaded');
      if (LISTING.file) {
        const sha = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        expect(sha(saved), 'downloaded file matches the uploaded original').toBe(sha(LISTING.file));
      }
    });
  } finally {
    await ctx.close();
  }
});
