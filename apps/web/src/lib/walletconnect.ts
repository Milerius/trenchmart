import { fromBase64, toBase64 } from '@trenchmart/chain';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

/**
 * Public Reown project id (cloud.reown.com). The allowed origin is https://trenchmart.fun.
 * An explicit empty or ${...} value hides WalletConnect. An unset env var uses this default.
 */
export const WALLETCONNECT_PROJECT_ID = '9e9aab84f03d9799c7a3dc4ee77fa93b';

/**
 * WalletConnect CAIP-2 for Solana devnet: the first 32 chars of the devnet genesis hash.
 * Wallet Standard calls the same cluster `solana:devnet`. A `wc:` proposal has to use this
 * CAIP id. Mainnet (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) is refused.
 */
export const SOLANA_DEVNET_CAIP = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const SOLANA_MAINNET_CAIP = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export const SOLANA_SIGN_METHODS = ['solana_signMessage', 'solana_signTransaction'] as const;

export type SolanaNamespace = {
  chains: string[];
  methods: string[];
  events: string[];
};

export type WalletConnectConnectParams = {
  namespaces?: { solana?: SolanaNamespace };
  optionalNamespaces?: { solana?: SolanaNamespace };
};

export type WalletConnectSession = {
  topic: string;
  address: string;
};

export type WcProviderLike = {
  on(event: 'display_uri', listener: (uri: string) => void): void;
  connect(
    opts: WalletConnectConnectParams,
  ): Promise<{ topic?: string; namespaces?: { solana?: { accounts?: string[] } } } | undefined>;
  request(args: { method: string; params?: object }, chain?: string): Promise<unknown>;
};

export type WalletConnectMock = {
  uri: string;
  address: string;
  secret?: string;
};

declare global {
  interface Window {
    /** Set by tests. When present, even as '', it overrides the env and the default. */
    __TRENCHMART_WC_PROJECT_ID__?: string;
    /** Set by tests. Skips UniversalProvider so the relay is never contacted. */
    __TRENCHMART_WC_MOCK__?: WalletConnectMock;
    /** Set while a mock pairing is waiting. Call it to approve the session. */
    __TRENCHMART_WC_APPROVE__?: () => void;
  }
}

/** Empty string disables the row. Null means the value was never set. */
export function normalizeProjectId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = value.trim();
  if (!raw || raw.includes('${')) return '';
  return raw;
}

export function walletConnectProjectId(): string {
  if (typeof window !== 'undefined' && '__TRENCHMART_WC_PROJECT_ID__' in window) {
    return normalizeProjectId(window.__TRENCHMART_WC_PROJECT_ID__) ?? '';
  }
  const fromEnv = normalizeProjectId(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);
  if (fromEnv === '') return '';
  if (fromEnv) return fromEnv;
  return WALLETCONNECT_PROJECT_ID;
}

/** Devnet only, as an optional namespace so wallets accept the proposal. */
export function devnetConnectParams(): WalletConnectConnectParams {
  return {
    optionalNamespaces: {
      solana: {
        chains: [SOLANA_DEVNET_CAIP],
        methods: [...SOLANA_SIGN_METHODS],
        events: [],
      },
    },
  };
}

export function assertDevnetNamespaces(params: WalletConnectConnectParams): void {
  const chains = [
    ...(params.namespaces?.solana?.chains ?? []),
    ...(params.optionalNamespaces?.solana?.chains ?? []),
  ];
  if (chains.length !== 1 || chains[0] !== SOLANA_DEVNET_CAIP) {
    throw new Error('Refusing to sign outside devnet');
  }
  const encoded = JSON.stringify(params);
  if (encoded.includes(SOLANA_MAINNET_CAIP) || encoded.includes('mainnet')) {
    throw new Error('Refusing to sign outside devnet');
  }
}

export function parseSessionAddress(accounts: readonly string[]): string {
  const devnet = accounts.find((account) => account.startsWith(`${SOLANA_DEVNET_CAIP}:`));
  if (devnet) {
    const address = devnet.slice(SOLANA_DEVNET_CAIP.length + 1);
    if (!address) throw new Error('WalletConnect returned no account');
    return address;
  }
  throw new Error('Switch your wallet to Devnet to continue.');
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((err: unknown) => void) | undefined;
  let settled = false;
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      res(value);
    };
    reject = (err) => {
      if (settled) return;
      settled = true;
      rej(err instanceof Error ? err : new Error('WalletConnect did not return a pairing code'));
    };
  });
  return {
    promise,
    resolve: resolve as (value: T) => void,
    reject: reject as (err: unknown) => void,
  };
}

/**
 * Ask for a Solana devnet session. The `wc:` URI is available before the phone approves,
 * so the picker can show the QR while `session` is still pending.
 */
export function startWalletConnect(provider: WcProviderLike): {
  uri: Promise<string>;
  session: Promise<WalletConnectSession>;
} {
  const params = devnetConnectParams();
  assertDevnetNamespaces(params);
  const uriReady = deferred<string>();
  provider.on('display_uri', (uri) => {
    if (typeof uri === 'string' && uri.startsWith('wc:')) uriReady.resolve(uri);
    else uriReady.reject(new Error('WalletConnect did not return a pairing code'));
  });
  const session = provider.connect(params).then(
    (settled) => ({
      topic: settled?.topic ?? '',
      address: parseSessionAddress(settled?.namespaces?.solana?.accounts ?? []),
    }),
    (err: unknown) => {
      uriReady.reject(err);
      throw err;
    },
  );
  // The picker may stop after the URI fails. Keep the session rejection observed.
  void session.catch(() => undefined);
  return { uri: uriReady.promise, session };
}

export function decodeWalletConnectSignature(result: unknown): Uint8Array {
  const raw =
    typeof result === 'string'
      ? result
      : result && typeof result === 'object' && 'signature' in result
        ? (result as { signature: unknown }).signature
        : undefined;
  if (typeof raw !== 'string' || !raw) throw new Error('WalletConnect returned no signature');
  const bytes = bs58.decode(raw);
  if (bytes.length !== 64) throw new Error('WalletConnect returned no signature');
  return bytes;
}

function readCompact(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    const byte = bytes[cursor];
    if (byte === undefined) throw new Error('truncated compact-u16');
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 21) throw new Error('truncated compact-u16');
  }
  return { value, next: cursor };
}

/** Write a 64-byte signature into an unsigned legacy transaction (one signer). */
export function attachLegacySignature(tx: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error('WalletConnect returned no signature');
  const count = readCompact(tx, 0);
  if (count.value < 1 || tx.length < count.next + 64) {
    throw new Error('WalletConnect returned no signature');
  }
  const out = new Uint8Array(tx);
  out.set(signature, count.next);
  return out;
}

function decodeBlob(value: string): Uint8Array | null {
  const attempts: Uint8Array[] = [];
  try {
    attempts.push(fromBase64(value));
  } catch {
    /* not base64 */
  }
  try {
    attempts.push(bs58.decode(value));
  } catch {
    /* not base58 */
  }
  return attempts.find((bytes) => bytes.length > 64) ?? null;
}

export function signedTransactionFromResult(unsigned: Uint8Array, result: unknown): Uint8Array {
  if (result && typeof result === 'object' && 'transaction' in result) {
    const blob = (result as { transaction: unknown }).transaction;
    if (typeof blob === 'string') {
      const decoded = decodeBlob(blob);
      if (decoded) return decoded;
    }
  }
  return attachLegacySignature(unsigned, decodeWalletConnectSignature(result));
}

export async function signWalletConnectMessage(
  provider: WcProviderLike,
  session: WalletConnectSession,
  message: Uint8Array,
): Promise<Uint8Array> {
  const result = await provider.request(
    {
      method: 'solana_signMessage',
      params: { pubkey: session.address, message: bs58.encode(message) },
    },
    SOLANA_DEVNET_CAIP,
  );
  return decodeWalletConnectSignature(result);
}

export async function signWalletConnectTransaction(
  provider: WcProviderLike,
  session: WalletConnectSession,
  transaction: Uint8Array,
): Promise<Uint8Array> {
  const result = await provider.request(
    {
      method: 'solana_signTransaction',
      params: { transaction: toBase64(transaction) },
    },
    SOLANA_DEVNET_CAIP,
  );
  return signedTransactionFromResult(transaction, result);
}

export function mockWalletConnectProvider(mock: WalletConnectMock): WcProviderLike {
  let onUri: ((uri: string) => void) | undefined;
  return {
    on(event, listener) {
      if (event === 'display_uri') onUri = listener;
    },
    async connect(opts) {
      assertDevnetNamespaces(opts);
      onUri?.(mock.uri);
      await new Promise<void>((resolve) => {
        if (typeof window !== 'undefined') window.__TRENCHMART_WC_APPROVE__ = () => resolve();
      });
      return {
        topic: 'mock-topic',
        namespaces: {
          solana: { accounts: [`${SOLANA_DEVNET_CAIP}:${mock.address}`] },
        },
      };
    },
    async request(args, chain) {
      if (chain !== SOLANA_DEVNET_CAIP) throw new Error('Refusing to sign outside devnet');
      if (args.method === 'solana_signMessage') {
        const params = args.params as { message?: string } | undefined;
        if (mock.secret && params?.message) {
          const secret = bs58.decode(mock.secret);
          const message = bs58.decode(params.message);
          return { signature: bs58.encode(nacl.sign.detached(message, secret)) };
        }
        return { signature: bs58.encode(new Uint8Array(64).fill(7)) };
      }
      if (args.method === 'solana_signTransaction') {
        return { signature: bs58.encode(new Uint8Array(64).fill(8)) };
      }
      throw new Error(`WalletConnect cannot ${args.method}`);
    },
  };
}

/**
 * Real provider only when nothing mocked is installed. UniversalProvider.init talks to
 * the Reown relay, so tests must set `__TRENCHMART_WC_MOCK__` first.
 */
export async function createWalletConnectProvider(projectId: string): Promise<WcProviderLike> {
  if (!projectId || projectId.includes('${')) throw new Error('WalletConnect is not configured');
  const mock = typeof window !== 'undefined' ? window.__TRENCHMART_WC_MOCK__ : undefined;
  if (mock?.uri && mock.address) return mockWalletConnectProvider(mock);
  const { UniversalProvider } = await import('@walletconnect/universal-provider');
  const origin =
    typeof location !== 'undefined' && location.origin ? location.origin : 'https://trenchmart.fun';
  const provider = await UniversalProvider.init({
    projectId,
    metadata: {
      name: 'TrenchMart',
      description: 'Sign in to TrenchMart on Solana devnet.',
      url: origin,
      icons: [`${origin}/favicon.ico`],
    },
  });
  return {
    on(event, listener) {
      provider.on(event, listener);
    },
    connect(opts) {
      return provider.connect(opts);
    },
    request(args, chain) {
      return provider.request(args, chain);
    },
  };
}
