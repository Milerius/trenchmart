/**
 * Live connect + sign-in test for one browser wallet extension against a deployed TrenchMart
 * (default https://trenchmart.fun). Devnet only. Used by e2e/{trust,backpack,solflare}-live.spec.ts.
 * It does not run in the normal e2e job: it needs WALLET_LIVE=1, an unpacked extension and a
 * throwaway key. See playwright.wallets.config.ts for the command.
 *
 * Keys are typed into the wallet's own import form and never logged or screenshotted.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

export const SITE = (process.env.E2E_SITE_URL ?? 'https://trenchmart.fun').replace(/\/$/, '');
const OUT_ROOT = process.env.E2E_OUT_DIR ?? path.resolve('test-results/wallets-live');
// Throwaway unlock password for the temporary browser profile.
const PASSWORD = `Tm-${randomBytes(12).toString('hex')}-E2e!`;

export type WalletName = 'trust' | 'backpack' | 'solflare';

export type WalletDriver = {
  name: WalletName;
  /** Wallet Standard name the site sees. */
  standardName: string;
  /** Import the throwaway key and set a password. */
  onboard(ctx: BrowserContext, extId: string, shot: Shot): Promise<void>;
  /** Point the wallet at devnet where it can. Returns a note when it cannot. */
  useDevnet(ctx: BrowserContext, extId: string, shot: Shot): Promise<string | null>;
  /** Approve one connect or sign-in request shown in the wallet popup. Returns its kind. */
  approve(popup: Page): Promise<'connect' | 'sign-in' | 'other'>;
};

export type Shot = (page: Page, name: string) => Promise<void>;

function expand(file: string): string {
  return file.replace(/^~/, os.homedir());
}

/** Base58 secret key of the throwaway keypair (JSON byte array or base58 file). */
export function secretKey(envName: string, fallback: string): string {
  const text = fs.readFileSync(expand(process.env[envName] ?? fallback), 'utf8').trim();
  return text.startsWith('[') ? bs58.encode(Uint8Array.from(JSON.parse(text) as number[])) : text;
}

export function publicKeyOf(envName: string, fallback: string): string {
  const text = fs.readFileSync(expand(process.env[envName] ?? fallback), 'utf8').trim();
  if (!text.startsWith('[')) throw new Error(`${envName} must be a JSON byte array keypair`);
  return bs58.encode(Uint8Array.from((JSON.parse(text) as number[]).slice(32, 64)));
}

export function readText(envName: string, fallback: string): string {
  return fs.readFileSync(expand(process.env[envName] ?? fallback), 'utf8').trim();
}

export const password = () => PASSWORD;

export async function waitForPage(
  ctx: BrowserContext,
  match: (url: string) => boolean,
  timeout = 15_000,
): Promise<Page | null> {
  return (
    ctx.pages().find((p) => !p.isClosed() && match(p.url())) ??
    (await ctx
      .waitForEvent('page', { predicate: (p) => match(p.url()), timeout })
      .catch(() => null))
  );
}

/** First visible element of a locator, for wallets that keep earlier screens in the DOM. */
export function visible(page: Page, selector: string) {
  return page.locator(selector).filter({ visible: true }).first();
}

/** The site's header label for a signed-in wallet. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function liveWalletTest(
  driver: WalletDriver,
  opts: { extDirEnv: string; address: () => string },
) {
  const extDir = process.env[opts.extDirEnv] ?? '';
  const out = path.join(OUT_ROOT, driver.name);

  test.describe(`${driver.name} (live)`, () => {
    test.skip(!process.env.WALLET_LIVE, 'set WALLET_LIVE=1 to run the live wallet suite');
    test.skip(!extDir, `set ${opts.extDirEnv} to the unpacked ${driver.name} extension`);
    test.setTimeout(6 * 60_000);

    test(`${driver.name}: connect wallet and sign in on ${SITE}`, async () => {
      fs.mkdirSync(out, { recursive: true });
      const consoleLog = fs.createWriteStream(path.join(out, 'console.log'));
      const networkLog = fs.createWriteStream(path.join(out, 'network.log'));
      let n = 0;
      const shot: Shot = async (page, name) => {
        n += 1;
        await page
          .screenshot({ path: path.join(out, `${String(n).padStart(2, '0')}-${name}.png`) })
          .catch(() => {});
      };
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), `wallet-${driver.name}-`));
      const ctx = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: process.env.E2E_HEADLESS === '1',
        viewport: { width: 1280, height: 900 },
        args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
      });
      const log = (page: Page) => {
        page.on('console', (m) =>
          consoleLog.write(`${new Date().toISOString()} [${m.type()}] ${m.text().slice(0, 800)}\n`),
        );
        page.on('pageerror', (e) =>
          consoleLog.write(`${new Date().toISOString()} [pageerror] ${e.message}\n`),
        );
        page.on('response', async (r) => {
          if (!r.url().startsWith(SITE)) return;
          const body = r.url().includes('/api/v1/')
            ? (await r.text().catch(() => '')).slice(0, 400)
            : '';
          networkLog.write(
            `${new Date().toISOString()} ${r.status()} ${r.request().method()} ${r.url()} ${body}\n`,
          );
        });
        page.on('requestfailed', (r) =>
          networkLog.write(`${new Date().toISOString()} FAILED ${r.method()} ${r.url()}\n`),
        );
      };
      try {
        const worker =
          ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 30_000 }));
        const extId = new URL(worker.url()).host;
        const address = opts.address();
        await test.step('import the throwaway key', () => driver.onboard(ctx, extId, shot));
        const devnetNote = await test.step('switch the wallet to devnet', () =>
          driver.useDevnet(ctx, extId, shot));
        if (devnetNote) test.info().annotations.push({ type: 'devnet', description: devnetNote });
        // Some wallets (Trust) route a dApp request into an already open wallet tab.
        for (const p of ctx.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();

        const page = await ctx.newPage();
        log(page);
        await page.goto(SITE);
        const button = page.getByTestId('connect');
        await expect(button).toHaveText(/Connect wallet/);
        const names = await page.evaluate(
          () =>
            new Promise<string[]>((resolve) => {
              const found: string[] = [];
              const api = {
                register: (...ws: { name: string; chains: readonly string[] }[]) => {
                  for (const w of ws)
                    if (w.chains.some((c) => c.startsWith('solana:'))) found.push(w.name);
                  return () => {};
                },
              };
              window.addEventListener('wallet-standard:register-wallet', (e) =>
                (e as CustomEvent).detail(api),
              );
              window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
              setTimeout(() => resolve(found), 500);
            }),
        );
        expect(names, 'the wallet registers through the Wallet Standard').toContain(
          driver.standardName,
        );
        await shot(page, 'site-before-connect');

        const prompts: string[] = [];
        let verifyStatus = 0;
        await test.step('connect, approve the wallet prompts, sign in', async () => {
          const verify = page.waitForResponse(
            (r) => r.url().endsWith('/api/v1/auth/verify') && r.request().method() === 'POST',
            { timeout: 180_000 },
          );
          let verified = false;
          void verify.then(() => (verified = true)).catch(() => {});
          await button.click();
          const isPopup = (url: string) => url.startsWith(`chrome-extension://${extId}/`);
          while (!verified && prompts.length < 4) {
            const popup = await waitForPage(ctx, isPopup, 20_000);
            if (!popup) break;
            await popup.waitForLoadState().catch(() => {});
            const kind = await driver.approve(popup);
            prompts.push(kind);
            await shot(popup, `wallet-${kind}-approved`).catch(() => {});
            await Promise.race([
              popup.waitForEvent('close', { timeout: 8_000 }).catch(() => {}),
              verify.catch(() => {}),
            ]);
            if (!popup.isClosed() && !verified) await popup.waitForTimeout(1_500);
          }
          const res = await verify;
          verifyStatus = res.status();
        });
        expect(verifyStatus, 'POST /api/v1/auth/verify').toBe(200);
        await expect(button).toHaveText(shortAddress(address), { timeout: 30_000 });
        await shot(page, 'site-signed-in');
        const me = await page.evaluate(async () => {
          const r = await fetch('/api/v1/me', { credentials: 'include' });
          return {
            status: r.status,
            wallet: ((await r.json()) as { user?: { wallet?: string } }).user?.wallet,
          };
        });
        expect(me).toEqual({ status: 200, wallet: address });
        // One connect approval and one sign-in approval; a second sign-in prompt is a regression.
        expect(
          prompts.filter((p) => p === 'sign-in').length,
          `prompts: ${prompts.join(', ')}`,
        ).toBe(1);
        fs.writeFileSync(
          path.join(out, 'result.json'),
          JSON.stringify(
            { wallet: driver.name, address, prompts, verifyStatus, me, devnetNote },
            null,
            2,
          ),
        );
      } finally {
        await ctx.close();
        consoleLog.end();
        networkLog.end();
      }
    });
  });
}
