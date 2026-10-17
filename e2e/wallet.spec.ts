import { createRequire } from 'node:module';
import { expect, test, devices, type Page } from '@playwright/test';
import { NO_WALLET_MESSAGE } from '../apps/web/src/lib/wallet-detect';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

const ADDRESS = 'F6rqzj5ZMBcCF1rADveqE4cKRShC4ddzVgaPhCJ5zpD7';

function walletAlert(page: Page) {
  return page.locator('[data-testid=nav] p[role=alert]');
}

async function mockSignIn(page: Page, address: string) {
  let signedIn = false;
  await page.route('**/api/v1/me', (route) => {
    if (!signedIn) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'user-1', wallet: address, handle: null, roles: ['buyer'] },
        tier: 'none',
      }),
    });
  });
  await page.route('**/api/v1/auth/nonce', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: `Sign in to TrenchMart\n${address}` }),
    }),
  );
  await page.route('**/api/v1/auth/verify', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { wallet?: string };
    expect(body.wallet).toBe(address);
    signedIn = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

function installStandardWallet(options: { address: string; delayMs: number }) {
  const account = {
    address: options.address,
    publicKey: new Uint8Array(32),
    chains: ['solana:devnet', 'solana:mainnet'],
    features: ['solana:signMessage', 'solana:signTransaction', 'standard:connect'],
  };
  const wallet = {
    version: '1.0.0',
    name: 'Phantom',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    chains: ['solana:devnet', 'solana:mainnet'],
    accounts: [] as (typeof account)[],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          wallet.accounts = [account];
          return { accounts: [account] };
        },
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs: { message: Uint8Array }[]) =>
          inputs.map((input) => ({
            signedMessage: input.message,
            signature: new Uint8Array(64).fill(9),
          })),
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy'],
        signTransaction: async (...inputs: { transaction: Uint8Array; chain?: string }[]) =>
          inputs.map((input) => {
            if (input.chain && input.chain.includes('mainnet')) throw new Error('mainnet refused');
            return { signedTransaction: input.transaction };
          }),
      },
    },
  };
  window.addEventListener('wallet-standard:app-ready', (event) => {
    const register = () => {
      const api = (event as CustomEvent<{ register: (wallet: unknown) => void }>).detail;
      api.register(wallet);
    };
    if (options.delayMs > 0) window.setTimeout(register, options.delayMs);
    else register();
  });
}

test('does not install the test adapter and explains a missing wallet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
  const installed = await page.evaluate(
    () =>
      (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ ??
      null,
  );
  expect(installed).toBeNull();
  await page.getByTestId('connect').click();
  await expect(walletAlert(page)).toHaveText(NO_WALLET_MESSAGE, { timeout: 5_000 });
});

test('connects a Wallet Standard wallet that registers when the app is ready', async ({ page }) => {
  await page.addInitScript(installStandardWallet, { address: ADDRESS, delayMs: 0 });
  await mockSignIn(page, ADDRESS);
  await page.goto('/');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
  await expect(walletAlert(page)).toHaveCount(0);
});

test('connects a Wallet Standard wallet that registers after the page loads', async ({ page }) => {
  await page.addInitScript(installStandardWallet, { address: ADDRESS, delayMs: 400 });
  await mockSignIn(page, ADDRESS);
  await page.goto('/');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
});

test('connects a legacy Phantom provider that is injected after load', async ({ page }) => {
  await page.addInitScript((address) => {
    window.setTimeout(() => {
      const provider = {
        isPhantom: true,
        connect: async () => ({ publicKey: { toString: () => address } }),
        signMessage: async () => ({ signature: new Uint8Array(64).fill(4) }),
        signTransaction: async (tx: { serialize: () => Uint8Array }) => tx,
      };
      (window as unknown as { phantom?: { solana: typeof provider } }).phantom = {
        solana: provider,
      };
      window.dispatchEvent(new Event('phantom#initialized'));
    }, 300);
  }, ADDRESS);
  await mockSignIn(page, ADDRESS);
  await page.goto('/');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
});

test('signs in with the explicit test adapter when a test sets it', async ({ page }) => {
  const pair = nacl.sign.keyPair();
  const secret = bs58.encode(pair.secretKey);
  const address = bs58.encode(pair.publicKey);
  await page.addInitScript((value) => {
    (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ = value;
  }, secret);
  await mockSignIn(page, address);
  await page.goto('/');
  await page.getByTestId('connect').click();
  const label = `${address.slice(0, 4)}…${address.slice(-4)}`;
  await expect(page.getByTestId('connect')).toHaveText(label);
});

const iphone = devices['iPhone 13'];

test.describe('mobile', () => {
  test.use({
    userAgent: iphone.userAgent,
    viewport: iphone.viewport,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
  });

  test('offers a Phantom deeplink when no wallet is injected', async ({ page }) => {
    await page.route('https://phantom.app/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>phantom</p>' }),
    );
    await page.goto('/');
    const link = page.getByTestId('connect');
    await expect(link).toHaveText('Open in Phantom');
    await link.click();
    await expect(page).toHaveURL(/https:\/\/phantom\.app\/ul\/browse\//);
    const opened = new URL(page.url());
    const target = decodeURIComponent(opened.pathname.replace(/^\/ul\/browse\//, ''));
    expect(target.startsWith('http://127.0.0.1:3000')).toBe(true);
    expect(opened.searchParams.get('ref')).toBe('http://127.0.0.1:3000');
    expect(opened.search).not.toContain('mainnet');
  });

  test('uses an injected Wallet Standard wallet instead of the deeplink', async ({ page }) => {
    await page.addInitScript(installStandardWallet, { address: ADDRESS, delayMs: 0 });
    await mockSignIn(page, ADDRESS);
    await page.goto('/');
    await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
  });
});
