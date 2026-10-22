import type { BrowserContext } from '@playwright/test';

/**
 * Shared Wallet Standard mock wallet and stateful auth-API mock for E2E specs
 * (moved out of wallet-auth.spec.ts so other specs can render a connected header).
 */

export type MockWalletControl = {
  switchTo(address: string | null): void;
  reject: boolean;
  signDelayMs: number;
  signCount: number;
};

declare global {
  interface Window {
    __mockWallet: MockWalletControl;
  }
}

/** A Wallet Standard wallet: connect (silent once trusted), events, signMessage, disconnect. */
export function installMockWallet(initial: string) {
  const trusted = () => sessionStorage.getItem('mock-wallet-trusted') === '1';
  const accountFor = (address: string) => ({
    address,
    publicKey: new Uint8Array(32),
    chains: ['solana:devnet'],
    features: ['solana:signMessage', 'solana:signTransaction'],
  });
  let active = accountFor(sessionStorage.getItem('mock-wallet-address') ?? initial);
  const listeners = new Set<(props: { accounts: unknown[] }) => void>();
  const control = {
    reject: false,
    signDelayMs: 0,
    signCount: 0,
    switchTo(address: string | null) {
      if (address) {
        active = accountFor(address);
        sessionStorage.setItem('mock-wallet-address', address);
      }
      wallet.accounts = address ? [active] : [];
      for (const listener of listeners) listener({ accounts: wallet.accounts });
    },
  };
  const wallet = {
    version: '1.0.0',
    name: 'Phantom',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    chains: ['solana:devnet'],
    accounts: [] as ReturnType<typeof accountFor>[],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async (input?: { silent?: boolean }) => {
          if (input?.silent && !trusted()) return { accounts: [] };
          sessionStorage.setItem('mock-wallet-trusted', '1');
          wallet.accounts = [active];
          return { accounts: wallet.accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          sessionStorage.removeItem('mock-wallet-trusted');
          wallet.accounts = [];
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (_event: string, listener: (props: { accounts: unknown[] }) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs: { message: Uint8Array }[]) => {
          control.signCount += 1;
          await new Promise((r) => setTimeout(r, control.signDelayMs));
          if (control.reject)
            throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          return inputs.map((input) => ({
            signedMessage: input.message,
            signature: new Uint8Array(64).fill(7),
          }));
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy'],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          inputs.map((input) => ({ signedTransaction: input.transaction })),
      },
    },
  };
  (window as unknown as { __mockWallet: typeof control }).__mockWallet = control;
  window.addEventListener('wallet-standard:app-ready', (event) => {
    (event as CustomEvent<{ register: (w: unknown) => void }>).detail.register(wallet);
  });
}

/** The API's auth surface, shared by every tab in the context (like one cookie jar). */
export class MockAuth {
  wallet: string | null = null;
  expired = false;
  meDelayMs = 0;
  calls = { nonce: 0, verify: 0, logout: 0, refresh: 0, me: 0 };
  refreshAfter = '2999-01-01T00:00:00.000Z';

  async install(context: BrowserContext) {
    const json = (body: unknown, status = 200) => ({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    const user = () => ({
      id: `user-${this.wallet}`,
      wallet: this.wallet,
      handle: null,
      roles: ['buyer'],
    });
    const session = () => ({
      expiresAt: '2999-02-01T00:00:00.000Z',
      refreshAfter: this.refreshAfter,
    });
    await context.route('**/api/v1/me', async (route) => {
      this.calls.me += 1;
      if (this.meDelayMs) await new Promise((r) => setTimeout(r, this.meDelayMs));
      if (!this.wallet || this.expired)
        return route.fulfill(
          json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401),
        );
      return route.fulfill(json({ user: user(), tier: 'none', session: session() }));
    });
    await context.route('**/api/v1/auth/nonce', (route) => {
      this.calls.nonce += 1;
      const { wallet } = JSON.parse(route.request().postData() ?? '{}') as { wallet: string };
      return route.fulfill(
        json({ nonce: 'n', message: `trenchmart.fun wants you to sign in:\n${wallet}` }),
      );
    });
    await context.route('**/api/v1/auth/verify', (route) => {
      this.calls.verify += 1;
      const { wallet } = JSON.parse(route.request().postData() ?? '{}') as { wallet: string };
      this.wallet = wallet;
      this.expired = false;
      return route.fulfill(json({ user: user(), session: session() }));
    });
    await context.route('**/api/v1/auth/refresh', (route) => {
      this.calls.refresh += 1;
      return route.fulfill(json({ user: user(), session: session() }));
    });
    await context.route('**/api/v1/auth/logout', (route) => {
      this.calls.logout += 1;
      this.wallet = null;
      return route.fulfill({ status: 204, body: '' });
    });
  }
}
