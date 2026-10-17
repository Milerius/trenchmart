/**
 * Wallet discovery for the browser.
 *
 * Phantom, Solflare, and Backpack register through the Wallet Standard when the
 * page dispatches `wallet-standard:app-ready`. They may never set `window.solana`,
 * and a one-time read at module load runs before that event. Call `getWallets()`
 * from a click or a mount effect, then use `discoverWallet`.
 */

export const DEVNET_CHAIN = 'solana:devnet';
export const NO_WALLET_MESSAGE = 'No wallet. Install Phantom, or run the test adapter.';
export const DISCOVERY_TIMEOUT_MS = 1500;

export type StandardAccount = {
  address: string;
  chains: readonly string[];
  features: readonly string[];
};

export type StandardWallet = {
  name: string;
  chains: readonly string[];
  accounts: readonly StandardAccount[];
  features: Record<string, unknown>;
};

export type WalletList = {
  get(): readonly StandardWallet[];
  on(event: 'register' | 'unregister', listener: () => void): () => void;
};

export type LegacyProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
  signTransaction: (tx: {
    serialize: () => Uint8Array;
  }) => Promise<{ serialize: () => Uint8Array }>;
};

export type InjectedScope = {
  phantom?: { solana?: unknown };
  solana?: unknown;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export type Signer = {
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
};

export type WalletDiscovery =
  | { kind: 'standard'; wallet: StandardWallet }
  | { kind: 'legacy'; provider: LegacyProvider }
  | { kind: 'deeplink'; url: string }
  | { kind: 'none' };

type SignMessageMethod = (
  ...inputs: readonly { account: StandardAccount; message: Uint8Array }[]
) => Promise<readonly { signature: Uint8Array }[]>;

type SignTransactionMethod = (
  ...inputs: readonly { account: StandardAccount; transaction: Uint8Array; chain?: string }[]
) => Promise<readonly { signedTransaction: Uint8Array }[]>;

type ConnectMethod = (input?: {
  silent?: boolean;
}) => Promise<{ accounts: readonly StandardAccount[] }>;

function featureMethod<T>(feature: unknown, key: string): T | null {
  if (!feature || typeof feature !== 'object') return null;
  const value = (feature as Record<string, unknown>)[key];
  return typeof value === 'function' ? (value as T) : null;
}

export function isUsableSolanaWallet(wallet: StandardWallet): boolean {
  const solana = wallet.chains.some((chain) => chain.startsWith('solana:'));
  if (!solana) return false;
  return Boolean(
    featureMethod(wallet.features['standard:connect'], 'connect') &&
    featureMethod(wallet.features['solana:signMessage'], 'signMessage') &&
    featureMethod(wallet.features['solana:signTransaction'], 'signTransaction'),
  );
}

/** Phantom first, then any other usable Solana wallet. */
export function pickSolanaWallet(wallets: readonly StandardWallet[]): StandardWallet | null {
  const usable = wallets.filter(isUsableSolanaWallet);
  return usable.find((wallet) => /phantom/i.test(wallet.name)) ?? usable[0] ?? null;
}

function isLegacyProvider(value: unknown): value is LegacyProvider {
  if (!value || typeof value !== 'object') return false;
  const provider = value as Partial<LegacyProvider>;
  return (
    typeof provider.connect === 'function' &&
    typeof provider.signMessage === 'function' &&
    typeof provider.signTransaction === 'function'
  );
}

/**
 * Read the injected provider at call time.
 * `window.phantom.solana` wins when another extension owns `window.solana`.
 */
export function readInjectedProvider(
  scope: InjectedScope | null | undefined,
): LegacyProvider | null {
  if (!scope) return null;
  if (isLegacyProvider(scope.phantom?.solana)) return scope.phantom.solana;
  if (isLegacyProvider(scope.solana)) return scope.solana;
  return null;
}

export function isLikelyMobile(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** Open the current page inside Phantom's in-app browser, where the provider exists. */
export function phantomBrowseUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('Refusing to open a Phantom deeplink for this page');
  }
  if (loopback && url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Refusing to open a Phantom deeplink for this page');
  }
  return `https://phantom.app/ul/browse/${encodeURIComponent(url.href)}?ref=${encodeURIComponent(url.origin)}`;
}

export function assertDevnetChain(chain: string): void {
  if (chain !== DEVNET_CHAIN) throw new Error('Refusing to sign outside devnet');
}

function pickAccount(accounts: readonly StandardAccount[]): StandardAccount | null {
  return accounts.find((account) => account.chains.includes(DEVNET_CHAIN)) ?? accounts[0] ?? null;
}

export async function signerFromStandardWallet(
  wallet: StandardWallet,
  options: { silent?: boolean } = {},
): Promise<Signer> {
  assertDevnetChain(DEVNET_CHAIN);
  const connect = featureMethod<ConnectMethod>(wallet.features['standard:connect'], 'connect');
  const signMessage = featureMethod<SignMessageMethod>(
    wallet.features['solana:signMessage'],
    'signMessage',
  );
  const signTransaction = featureMethod<SignTransactionMethod>(
    wallet.features['solana:signTransaction'],
    'signTransaction',
  );
  if (!connect || !signMessage || !signTransaction) {
    throw new Error(`${wallet.name} cannot sign on Solana`);
  }

  let accounts = wallet.accounts;
  const connected = await connect(options.silent ? { silent: true } : undefined);
  if (connected.accounts.length) accounts = connected.accounts;
  if (!accounts.length && options.silent) {
    const prompted = await connect();
    if (prompted.accounts.length) accounts = prompted.accounts;
  }
  const account = pickAccount(accounts);
  if (!account) throw new Error(`${wallet.name} did not return an account`);

  return {
    address: account.address,
    async signMessage(message: Uint8Array) {
      const [out] = await signMessage({ account, message });
      if (!out?.signature) throw new Error(`${wallet.name} returned no signature`);
      return out.signature;
    },
    async signTransaction(transaction: Uint8Array) {
      const [out] = await signTransaction({
        account,
        transaction,
        chain: DEVNET_CHAIN,
      });
      if (!out?.signedTransaction) throw new Error(`${wallet.name} returned no transaction`);
      return out.signedTransaction;
    },
  };
}

export async function signerFromLegacyProvider(provider: LegacyProvider): Promise<Signer> {
  const connected = await provider.connect();
  const address = connected.publicKey.toString();
  return {
    address,
    async signMessage(message: Uint8Array) {
      const signed = await provider.signMessage(message, 'utf8');
      return signed.signature;
    },
    async signTransaction(transaction: Uint8Array) {
      const signed = await provider.signTransaction({ serialize: () => transaction });
      return signed.serialize();
    },
  };
}

function classify(input: {
  standard: WalletList;
  injected: InjectedScope;
}): WalletDiscovery | { kind: 'pending' } {
  const wallet = pickSolanaWallet(input.standard.get());
  if (wallet) return { kind: 'standard', wallet };
  const provider = readInjectedProvider(input.injected);
  if (provider) return { kind: 'legacy', provider };
  return { kind: 'pending' };
}

/**
 * Resolve a wallet without snapshotting an empty provider at import time.
 * A wallet that registers after this call starts is still picked up.
 * On a phone with nothing injected, return Phantom's browse deeplink.
 */
export function discoverWallet(input: {
  standard: WalletList;
  injected: InjectedScope;
  timeoutMs: number;
  mobile: boolean;
  pageUrl: string;
}): Promise<WalletDiscovery> {
  const immediate = classify(input);
  if (immediate.kind !== 'pending') return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WalletDiscovery) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      off();
      input.injected.removeEventListener?.('phantom#initialized', onReady);
      resolve(result);
    };
    const consider = () => {
      const next = classify(input);
      if (next.kind !== 'pending') finish(next);
    };
    const onReady = () => consider();
    const off = input.standard.on('register', consider);
    input.injected.addEventListener?.('phantom#initialized', onReady);
    const poll = setInterval(consider, 50);
    const timer = setTimeout(() => {
      const next = classify(input);
      if (next.kind !== 'pending') finish(next);
      else if (input.mobile) finish({ kind: 'deeplink', url: phantomBrowseUrl(input.pageUrl) });
      else finish({ kind: 'none' });
    }, input.timeoutMs);
  });
}
