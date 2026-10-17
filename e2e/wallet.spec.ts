import { createRequire } from 'node:module';
import { expect, test, devices, type Page } from '@playwright/test';
import { LAST_WALLET_KEY } from '../apps/web/src/lib/wallet-catalog';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl') as typeof import('tweetnacl');
const bs58 = require('bs58').default as { encode: (bytes: Uint8Array) => string };

const ADDRESS = 'F6rqzj5ZMBcCF1rADveqE4cKRShC4ddzVgaPhCJ5zpD7';

function walletAlert(page: Page) {
  return page.locator('[data-testid=nav] p[role=alert]');
}

async function chooseInstalled(page: Page, id: string) {
  await page.getByTestId('connect').click();
  const row = page.getByTestId(`wallet-option-${id}`);
  await expect(row).toHaveAttribute('data-installed', 'true');
  await row.click();
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

test('opens the wallet picker and keeps every wallet when none is installed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
  const installed = await page.evaluate(
    () =>
      (window as unknown as { __TRENCHMART_E2E_SECRET__?: string }).__TRENCHMART_E2E_SECRET__ ??
      null,
  );
  expect(installed).toBeNull();
  await page.getByTestId('connect').click();
  const modal = page.getByTestId('connect-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('data-state', 'list');
  await expect(modal.getByRole('heading', { name: 'Select your wallet' })).toBeVisible();
  const order = [
    'phantom',
    'walletconnect',
    'solflare',
    'trust',
    'glow',
    'coinbase',
    'backpack',
    'open-phantom',
    'open-solflare',
    'open-trust',
    'open-backpack',
  ];
  const rows = modal.locator('[data-wallet]');
  await expect(rows).toHaveCount(11);
  await expect(rows).toHaveText([
    /Phantom/,
    /WalletConnect/,
    /Solflare/,
    /Trust/,
    /Glow/,
    /Coinbase/,
    /Backpack/,
    /Open in Phantom/,
    /Open in Solflare/,
    /Open in Trust/,
    /Open in Backpack/,
  ]);
  for (const id of order) {
    await expect(modal.locator(`[data-wallet=${id}]`)).toHaveAttribute('data-installed', 'false');
  }
  const phantom = modal.getByTestId('wallet-option-phantom');
  await expect(phantom).toContainText('Popular');
  await expect(phantom).toHaveAttribute('href', 'https://phantom.com/download');
  const openPhantom = await modal.getByTestId('wallet-option-open-phantom').getAttribute('href');
  expect(openPhantom).toContain('https://phantom.app/ul/browse/');
  expect(decodeURIComponent(openPhantom ?? '')).toContain('http://127.0.0.1:3000');
  expect(openPhantom).not.toContain('mainnet');
  await expect(modal.getByTestId('wallet-option-open-solflare')).toHaveAttribute(
    'href',
    /solflare\.com\/ul\/v1\/browse\//,
  );
  await expect(modal.getByTestId('wallet-option-open-trust')).toHaveAttribute(
    'href',
    /link\.trustwallet\.com\/open_url\?coin_id=501/,
  );
  await expect(modal.getByTestId('wallet-option-open-backpack')).toHaveAttribute(
    'href',
    /backpack\.app\/ul\/v1\/browse\//,
  );
  await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
  await expect(walletAlert(page)).toHaveCount(0);
  await modal.getByTestId('wallet-search').fill('glow');
  await expect(modal.locator('[data-wallet]')).toHaveCount(1);
  await expect(modal.getByTestId('wallet-option-glow')).toBeVisible();
  await modal.getByTestId('wallet-search').fill('');
  await modal.getByTestId('wallet-help').click();
  await expect(modal).toContainText('nothing moves and nothing is approved');
  await modal.getByTestId('wallet-back').click();
  await expect(modal).toHaveAttribute('data-state', 'list');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('connects a Wallet Standard wallet that registers when the app is ready', async ({ page }) => {
  await page.addInitScript(installStandardWallet, { address: ADDRESS, delayMs: 0 });
  await mockSignIn(page, ADDRESS);
  await page.goto('/');
  await chooseInstalled(page, 'phantom');
  await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
  await expect(page.getByTestId('connect-modal')).toHaveCount(0);
  await expect(walletAlert(page)).toHaveCount(0);
  const remembered = await page.evaluate((key) => localStorage.getItem(key), LAST_WALLET_KEY);
  expect(remembered).toBe('phantom');
});

test('connects a Wallet Standard wallet that registers after the page loads', async ({ page }) => {
  await page.addInitScript(installStandardWallet, { address: ADDRESS, delayMs: 400 });
  await mockSignIn(page, ADDRESS);
  await page.goto('/');
  await page.getByTestId('connect').click();
  const phantom = page.getByTestId('wallet-option-phantom');
  await expect(phantom).toHaveAttribute('data-installed', 'true');
  await phantom.click();
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
  const phantom = page.getByTestId('wallet-option-phantom');
  await expect(phantom).toHaveAttribute('data-installed', 'true');
  await phantom.click();
  await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
});

test('does not auto-pick when more than one wallet is installed', async ({ page }) => {
  const solflare = 'So1flare1111111111111111111111111111111111';
  await page.addInitScript(
    ({ phantom, solflareAddress }) => {
      window.addEventListener('wallet-standard:app-ready', (event) => {
        const api = (event as CustomEvent<{ register: (wallet: unknown) => void }>).detail;
        for (const entry of [
          { name: 'Solflare', address: solflareAddress },
          { name: 'Phantom', address: phantom },
        ]) {
          const account = {
            address: entry.address,
            publicKey: new Uint8Array(32),
            chains: ['solana:devnet'],
            features: ['solana:signMessage', 'solana:signTransaction'],
          };
          const wallet = {
            version: '1.0.0',
            name: entry.name,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
            chains: ['solana:devnet'],
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
                    signature: new Uint8Array(64).fill(3),
                  })),
              },
              'solana:signTransaction': {
                version: '1.0.0',
                supportedTransactionVersions: ['legacy'],
                signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
                  inputs.map((input) => ({ signedTransaction: input.transaction })),
              },
            },
          };
          api.register(wallet);
        }
      });
    },
    { phantom: ADDRESS, solflareAddress: solflare },
  );
  await mockSignIn(page, solflare);
  await page.addInitScript((key) => localStorage.setItem(key, 'solflare'), LAST_WALLET_KEY);
  await page.goto('/');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
  const rows = page.getByTestId('connect-modal').locator('[data-wallet]');
  await expect(rows.nth(0)).toHaveAttribute('data-wallet', 'solflare');
  await expect(rows.nth(1)).toHaveAttribute('data-wallet', 'phantom');
  await page.getByTestId('wallet-option-solflare').click();
  await expect(page.getByTestId('connect')).toHaveText('So1f…1111');
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

test('opens the picker when localStorage itself throws', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('connect-modal')).toBeVisible();
  await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
});

test('does not remember a wallet when sign-in fails', async ({ page }) => {
  await page.addInitScript(installStandardWallet, { address: ADDRESS, delayMs: 0 });
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }),
    }),
  );
  await page.route('**/api/v1/auth/nonce', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: `Sign in to TrenchMart\n${ADDRESS}` }),
    }),
  );
  await page.route('**/api/v1/auth/verify', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'bad signature' } }),
    }),
  );
  await page.goto('/');
  await chooseInstalled(page, 'phantom');
  await expect(page.getByTestId('connect-modal')).toContainText('bad signature');
  await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
  const remembered = await page.evaluate((key) => localStorage.getItem(key), LAST_WALLET_KEY);
  expect(remembered).toBeNull();
});

test('hides WalletConnect when the project id is cleared', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __TRENCHMART_WC_PROJECT_ID__?: string }).__TRENCHMART_WC_PROJECT_ID__ =
      '';
  });
  await page.goto('/');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('wallet-option-walletconnect')).toHaveCount(0);
  await expect(page.getByTestId('wallet-option-open-phantom')).toBeVisible();
});

test('signs in through a mocked WalletConnect relay', async ({ page }) => {
  const hits: string[] = [];
  await page.addInitScript((address) => {
    const scope = window as unknown as {
      __TRENCHMART_WC_MOCK__?: { uri: string; address: string };
    };
    scope.__TRENCHMART_WC_MOCK__ = {
      uri: 'wc:mock-topic@2?relay-protocol=irn&symKey=aa',
      address,
    };
  }, ADDRESS);
  await page.route(/walletconnect\.(com|org)|web3modal\.org|reown\.com/, (route) => {
    hits.push(route.request().url());
    return route.abort();
  });
  await mockSignIn(page, ADDRESS);
  await page.goto('/');
  await page.getByTestId('connect').click();
  await page.getByTestId('wallet-option-walletconnect').click();
  const qr = page.getByTestId('wallet-qr');
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('data-pairing', 'wc');
  await expect(page.getByTestId('wallet-deeplink-phantom')).toBeVisible();
  await expect(page.getByTestId('wallet-deeplink-solflare')).toHaveAttribute(
    'href',
    /solflare\.com\/ul\/v1\/browse\//,
  );
  await expect(page.getByTestId('wallet-deeplink-trust')).toHaveAttribute(
    'href',
    /link\.trustwallet\.com\/open_url\?coin_id=501/,
  );
  await expect(page.getByTestId('wallet-deeplink-backpack')).toHaveAttribute(
    'href',
    /backpack\.app\/ul\/v1\/browse\//,
  );
  expect(hits).toEqual([]);
  await page.evaluate(() => {
    (window as unknown as { __TRENCHMART_WC_APPROVE__?: () => void }).__TRENCHMART_WC_APPROVE__?.();
  });
  await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
  expect(hits).toEqual([]);
  const remembered = await page.evaluate((key) => localStorage.getItem(key), LAST_WALLET_KEY);
  expect(remembered).toBe('walletconnect');
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

  test('opens TrenchMart in Phantom, Solflare, Trust, or Backpack', async ({ page }) => {
    await page.route('https://phantom.app/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>phantom</p>' }),
    );
    await page.goto('/');
    await expect(page.getByTestId('connect')).toHaveText('Connect wallet');
    await page.getByTestId('connect').click();
    const link = page.getByTestId('wallet-option-open-phantom');
    await expect(link).toHaveText(/Open in Phantom/);
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
    await chooseInstalled(page, 'phantom');
    await expect(page.getByTestId('connect')).toHaveText('F6rq…zpD7');
    expect(page.url()).not.toContain('phantom.app');
  });
});
