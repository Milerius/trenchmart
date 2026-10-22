import { describe, expect, it, vi } from 'vitest';
import {
  DEVNET_CHAIN,
  discoverWallet,
  isLikelyMobile,
  isUsableSolanaWallet,
  mobileBrowseUrl,
  phantomBrowseUrl,
  pickSolanaWallet,
  readInjectedProvider,
  signerFromStandardWallet,
  signInKeepsMessage,
  signSignInMessage,
  siwsInputFromMessage,
  walletErrorMessage,
  withTimeout,
  type Signer,
  type InjectedScope,
  type StandardAccount,
  type StandardWallet,
  type WalletList,
} from './wallet-detect';

// signerFromStandardWallet marks <html data-cluster-mismatch> (the amber banner); node has no DOM.
const htmlAttrs = new Map<string, boolean>();
vi.stubGlobal('document', {
  documentElement: { toggleAttribute: (name: string, on: boolean) => htmlAttrs.set(name, on) },
});

const account = (address: string, chains: readonly string[]): StandardAccount => ({
  address,
  chains,
  features: ['solana:signMessage', 'solana:signTransaction'],
});

function wallet(
  name: string,
  chains: readonly string[] = [DEVNET_CHAIN],
): StandardWallet & {
  connect: ReturnType<typeof vi.fn>;
  signMessage: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
} {
  const connect = vi.fn(async () => ({
    accounts: [account('DevnetWallet111111111111111111111111111111', chains)],
  }));
  const signMessage = vi.fn(async (...inputs: { message: Uint8Array }[]) =>
    inputs.map((input) => ({
      signature: new Uint8Array(64).fill(1),
      signedMessage: input.message,
    })),
  );
  const signTransaction = vi.fn(async (...inputs: { transaction: Uint8Array; chain?: string }[]) =>
    inputs.map((input) => ({ signedTransaction: input.transaction })),
  );
  return {
    name,
    chains,
    accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect },
      'solana:signMessage': { version: '1.0.0', signMessage },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy'],
        signTransaction,
      },
    },
    connect,
    signMessage,
    signTransaction,
  };
}

function list(initial: StandardWallet[] = []): WalletList & { push(wallet: StandardWallet): void } {
  const wallets = [...initial];
  const listeners = new Set<() => void>();
  return {
    get: () => wallets,
    on: (_event, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(next: StandardWallet) {
      wallets.push(next);
      for (const listener of listeners) listener();
    },
  };
}

function scope(initial: InjectedScope = {}): InjectedScope & {
  emit(type: string): void;
  setPhantom(provider: InjectedScope['solana']): void;
} {
  const listeners = new Map<string, Set<() => void>>();
  const target: InjectedScope & {
    emit(type: string): void;
    setPhantom(provider: InjectedScope['solana']): void;
  } = {
    ...initial,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    setPhantom(provider) {
      target.phantom = { solana: provider };
    },
  };
  return target;
}

describe('pickSolanaWallet', () => {
  it('ignores non-solana wallets and prefers Phantom', () => {
    const evm = wallet('MetaMask', ['eip155:1']);
    const backpack = wallet('Backpack');
    const phantom = wallet('Phantom');
    expect(isUsableSolanaWallet(evm)).toBe(false);
    expect(pickSolanaWallet([evm, backpack, phantom])).toBe(phantom);
    expect(pickSolanaWallet([evm, backpack])?.name).toBe('Backpack');
    expect(pickSolanaWallet([evm])).toBeNull();
  });

  it('keeps a Phantom that also advertises mainnet, without selecting mainnet', () => {
    const phantom = wallet('Phantom', ['solana:mainnet', DEVNET_CHAIN]);
    expect(pickSolanaWallet([phantom])?.name).toBe('Phantom');
  });
});

describe('readInjectedProvider', () => {
  it('does not treat a missing provider as installed', () => {
    expect(readInjectedProvider(undefined)).toBeNull();
    expect(readInjectedProvider({})).toBeNull();
    expect(readInjectedProvider({ solana: { connect: true } })).toBeNull();
  });

  it('prefers window.phantom.solana over a foreign window.solana', () => {
    const phantom = {
      connect: vi.fn(),
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
    };
    const other = {
      connect: vi.fn(),
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
    };
    expect(readInjectedProvider({ phantom: { solana: phantom }, solana: other })).toBe(phantom);
  });
});

describe('discoverWallet', () => {
  it('returns a wallet that registers after discovery starts', async () => {
    const api = list();
    const pending = discoverWallet({
      standard: api,
      injected: scope(),
      timeoutMs: 1_000,
      mobile: false,
      pageUrl: 'https://trenchmart.fun/',
    });
    const phantom = wallet('Phantom');
    api.push(phantom);
    await expect(pending).resolves.toEqual({ kind: 'standard', wallet: phantom });
  });

  it('does not keep the empty list it saw at the start', async () => {
    vi.useFakeTimers();
    try {
      const wallets: StandardWallet[] = [];
      const pending = discoverWallet({
        standard: { get: () => wallets, on: () => () => {} },
        injected: scope(),
        timeoutMs: 500,
        mobile: false,
        pageUrl: 'https://trenchmart.fun/',
      });
      wallets.push(wallet('Phantom'));
      await vi.advanceTimersByTimeAsync(500);
      await expect(pending).resolves.toMatchObject({
        kind: 'standard',
        wallet: { name: 'Phantom' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a legacy provider that appears after the click', async () => {
    vi.useFakeTimers();
    try {
      const injected = scope();
      const pending = discoverWallet({
        standard: list(),
        injected,
        timeoutMs: 1_000,
        mobile: false,
        pageUrl: 'https://trenchmart.fun/',
      });
      injected.setPhantom({
        connect: vi.fn(),
        signMessage: vi.fn(),
        signTransaction: vi.fn(),
      });
      injected.emit('phantom#initialized');
      await vi.advanceTimersByTimeAsync(0);
      await expect(pending).resolves.toMatchObject({ kind: 'legacy' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('deeplinks on mobile and reports no wallet on desktop', async () => {
    vi.useFakeTimers();
    try {
      const mobile = discoverWallet({
        standard: list(),
        injected: scope(),
        timeoutMs: 400,
        mobile: true,
        pageUrl: 'https://trenchmart.fun/studio',
      });
      const desktop = discoverWallet({
        standard: list(),
        injected: scope(),
        timeoutMs: 400,
        mobile: false,
        pageUrl: 'https://trenchmart.fun/studio',
      });
      await vi.advanceTimersByTimeAsync(400);
      await expect(mobile).resolves.toEqual({
        kind: 'deeplink',
        url: phantomBrowseUrl('https://trenchmart.fun/studio'),
      });
      await expect(desktop).resolves.toEqual({ kind: 'none' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('phantomBrowseUrl', () => {
  it('encodes the page and keeps the link on devnet-safe https', () => {
    expect(phantomBrowseUrl('https://trenchmart.fun/sell?q=1')).toBe(
      'https://phantom.app/ul/browse/https%3A%2F%2Ftrenchmart.fun%2Fsell%3Fq%3D1?ref=https%3A%2F%2Ftrenchmart.fun',
    );
    expect(phantomBrowseUrl('http://127.0.0.1:3000/')).toContain('127.0.0.1');
    expect(() => phantomBrowseUrl('http://evil.example/')).toThrow(/deeplink/);
    expect(() => phantomBrowseUrl('javascript:alert(1)')).toThrow();
  });
});

describe('mobileBrowseUrl', () => {
  const page = 'https://trenchmart.fun/sell?q=1';

  it('builds Solflare, Trust, and Backpack links next to Phantom', () => {
    expect(mobileBrowseUrl('phantom', page)).toBe(phantomBrowseUrl(page));
    expect(mobileBrowseUrl('solflare', page)).toBe(
      'https://solflare.com/ul/v1/browse/https%3A%2F%2Ftrenchmart.fun%2Fsell%3Fq%3D1?ref=https%3A%2F%2Ftrenchmart.fun',
    );
    expect(mobileBrowseUrl('backpack', page)).toBe(
      'https://backpack.app/ul/v1/browse/https%3A%2F%2Ftrenchmart.fun%2Fsell%3Fq%3D1?ref=https%3A%2F%2Ftrenchmart.fun',
    );
    expect(mobileBrowseUrl('trust', page)).toBe(
      'https://link.trustwallet.com/open_url?coin_id=501&url=https%3A%2F%2Ftrenchmart.fun%2Fsell%3Fq%3D1',
    );
    for (const wallet of ['phantom', 'solflare', 'trust', 'backpack'] as const) {
      expect(mobileBrowseUrl(wallet, page)).not.toContain('mainnet');
    }
    expect(() => mobileBrowseUrl('solflare', 'http://evil.example/')).toThrow(/deeplink/);
  });
});

describe('isLikelyMobile', () => {
  it('detects phones and iPadOS without treating desktop Chrome as mobile', () => {
    expect(isLikelyMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isLikelyMobile('Mozilla/5.0 (Linux; Android 14)')).toBe(true);
    expect(isLikelyMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(
      isLikelyMobile(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0',
      ),
    ).toBe(false);
  });
});

describe('signerFromStandardWallet', () => {
  it('connects and signs the transaction for devnet', async () => {
    const phantom = wallet('Phantom', ['solana:mainnet', DEVNET_CHAIN]);
    const devnet = account('Devnet11111111111111111111111111111111111111', [DEVNET_CHAIN]);
    const mainnet = account('Mainnet1111111111111111111111111111111111111', ['solana:mainnet']);
    phantom.connect.mockResolvedValue({ accounts: [mainnet, devnet] });
    const signer = await signerFromStandardWallet(phantom);
    expect(signer.address).toBe(devnet.address);
    const signature = await signer.signMessage(new Uint8Array([1]));
    expect(signature).toHaveLength(64);
    const signed = await signer.signTransaction(new Uint8Array([9, 9]));
    expect(Array.from(signed)).toEqual([9, 9]);
    expect(phantom.signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ account: devnet, chain: DEVNET_CHAIN }),
    );
    expect(JSON.stringify(phantom.signTransaction.mock.calls)).not.toContain('solana:mainnet');
  });

  it('refuses to sign a transaction when the account is only on another cluster', async () => {
    const phantom = wallet('Phantom', ['solana:mainnet']);
    const mainnet = account('Mainnet1111111111111111111111111111111111111', ['solana:mainnet']);
    phantom.connect.mockResolvedValue({ accounts: [mainnet] });
    const signer = await signerFromStandardWallet(phantom);
    expect(htmlAttrs.get('data-cluster-mismatch')).toBe(true);
    await expect(signer.signTransaction(new Uint8Array([9]))).rejects.toThrow(/Devnet/);
    expect(phantom.signTransaction).not.toHaveBeenCalled();
  });

  it('prompts when a silent connect returns no accounts', async () => {
    const phantom = wallet('Phantom');
    phantom.connect.mockResolvedValueOnce({ accounts: [] }).mockResolvedValueOnce({
      accounts: [account('Prompted111111111111111111111111111111111111', [DEVNET_CHAIN])],
    });
    const signer = await signerFromStandardWallet(phantom, { silent: true });
    expect(signer.address).toContain('Prompted');
    expect(phantom.connect).toHaveBeenNthCalledWith(1, { silent: true });
    expect(phantom.connect).toHaveBeenNthCalledWith(2);
  });
});

// The exact text /api/v1/auth/nonce returns (packages/shared buildSiwsMessage).
const ADDRESS = '9Ww4nhGfPEE3WTzirx1hNYBtU2u7VFP6Zj3rC5QvkYsH';
const SIWS = [
  `trenchmart.fun wants you to sign in with your Solana account:`,
  ADDRESS,
  '',
  'Sign in to Trenchmart. This does not send a transaction.',
  '',
  'URI: https://trenchmart.fun',
  'Nonce: 413a72880d86e9918cee20a9b0100d66',
  'Issued At: 2026-10-17T09:14:06.766Z',
  'Expiration Time: 2026-10-17T09:24:06.766Z',
].join('\n');

/** Phantom 26.33's formatSolanaSignInMessage, copied from the extension's service worker. */
function phantomFormat(e: Record<string, string | undefined>): string {
  let text = `${e.domain} wants you to sign in with your Solana account:\n${e.address}`;
  if (e.statement) text += `\n\n${e.statement}`;
  const fields: string[] = [];
  if (e.uri) fields.push(`URI: ${e.uri}`);
  if (e.version) fields.push(`Version: ${e.version}`);
  if (e.chainId) fields.push(`Chain ID: ${e.chainId}`);
  if (e.nonce) fields.push(`Nonce: ${e.nonce}`);
  if (e.issuedAt) fields.push(`Issued At: ${e.issuedAt}`);
  if (e.expirationTime) fields.push(`Expiration Time: ${e.expirationTime}`);
  if (fields.length) text += `\n\n${fields.join('\n')}`;
  return text;
}

describe('siwsInputFromMessage', () => {
  it('reads every field so the wallet rebuilds the identical text', () => {
    const input = siwsInputFromMessage(SIWS);
    expect(input).toEqual({
      domain: 'trenchmart.fun',
      address: ADDRESS,
      statement: 'Sign in to Trenchmart. This does not send a transaction.',
      uri: 'https://trenchmart.fun',
      nonce: '413a72880d86e9918cee20a9b0100d66',
      issuedAt: '2026-10-17T09:14:06.766Z',
      expirationTime: '2026-10-17T09:24:06.766Z',
    });
    expect(phantomFormat(input!)).toBe(SIWS);
  });

  it('declines text it cannot round-trip', () => {
    expect(siwsInputFromMessage('hello')).toBeNull();
    expect(siwsInputFromMessage(`${SIWS}\nResources:\n- https://x`)).toBeNull();
    expect(siwsInputFromMessage(`d wants you to sign in with your Solana account:\n`)).toBeNull();
  });
});

function signerWith(overrides: Partial<Signer>): Signer & {
  signMessage: ReturnType<typeof vi.fn>;
} {
  return {
    address: ADDRESS,
    name: 'Phantom',
    signTransaction: async (tx) => tx,
    ...overrides,
    signMessage: vi.fn(async () => new Uint8Array(64).fill(7)),
  } as Signer & { signMessage: ReturnType<typeof vi.fn> };
}

describe('signSignInMessage', () => {
  it('uses solana:signIn and returns its signature when the bytes match the server message', async () => {
    // Regression: plain signMessage of the SIWS text failed in Phantom with "Unexpected error"
    // before /auth/verify was ever called.
    const signIn = vi.fn(async (input) => ({
      address: input.address,
      signedMessage: new TextEncoder().encode(phantomFormat(input)),
      signature: new Uint8Array(64).fill(9),
    }));
    const signer = signerWith({ signIn });
    const signature = await signSignInMessage(signer, SIWS);
    expect(Array.from(signature)).toEqual(new Array(64).fill(9));
    expect(signer.signMessage).not.toHaveBeenCalled();
  });

  it('falls back to signMessage when the wallet signed different text or another account', async () => {
    const changed = signerWith({
      signIn: async (input) => ({
        address: input.address,
        signedMessage: new TextEncoder().encode(`${phantomFormat(input)}\nVersion: 1`),
        signature: new Uint8Array(64).fill(9),
      }),
    });
    expect(Array.from(await signSignInMessage(changed, SIWS))[0]).toBe(7);
    expect(changed.signMessage).toHaveBeenCalledWith(new TextEncoder().encode(SIWS));

    const other = signerWith({
      signIn: async (input) => ({
        address: 'Other1111111111111111111111111111111111111',
        signedMessage: new TextEncoder().encode(phantomFormat(input)),
        signature: new Uint8Array(64).fill(9),
      }),
    });
    expect(Array.from(await signSignInMessage(other, SIWS))[0]).toBe(7);
  });

  it('uses signMessage when the wallet has no signIn feature', async () => {
    const signer = signerWith({});
    await signSignInMessage(signer, SIWS);
    expect(signer.signMessage).toHaveBeenCalledTimes(1);
  });
});

describe('standard wallet signIn and account identity', () => {
  it("exposes solana:signIn and passes the wallet's own account instance to signMessage", async () => {
    const phantom = wallet('Phantom');
    const own = account(ADDRESS, [DEVNET_CHAIN]);
    const copy = { ...own };
    phantom.connect.mockResolvedValue({ accounts: [copy] });
    (phantom as unknown as { accounts: readonly StandardAccount[] }).accounts = [own];
    const signIn = vi.fn(async () => [
      { account: own, signedMessage: new Uint8Array([1]), signature: new Uint8Array(64) },
    ]);
    phantom.features['solana:signIn'] = { version: '1.0.0', signIn };
    const signer = await signerFromStandardWallet(phantom);
    expect(signer.name).toBe('Phantom');
    const out = await signer.signIn!({ domain: 'trenchmart.fun', address: ADDRESS });
    expect(out.address).toBe(ADDRESS);
    await signer.signMessage(new Uint8Array([1]));
    expect(phantom.signMessage.mock.calls[0]?.[0].account).toBe(own);
  });
});

/** What Trust Wallet 26.41 signs for a signIn input: the SIWS text plus Version and Chain ID. */
function trustFormat(input: Parameters<typeof phantomFormat>[0]): string {
  return phantomFormat(input).replace(`\nNonce: `, `\nVersion: 1\nChain ID: mainnet\nNonce: `);
}

describe('wallets whose signIn changes the message', () => {
  it('knows Trust adds fields and the other Solana wallets do not', () => {
    expect(signInKeepsMessage('Trust')).toBe(false);
    expect(signInKeepsMessage('Trust Wallet')).toBe(false);
    for (const name of ['Phantom', 'Backpack', 'Solflare', 'Trustless']) {
      expect(signInKeepsMessage(name)).toBe(true);
    }
  });

  it('asks Trust to sign once, with signMessage, instead of signIn plus a fallback prompt', async () => {
    // Regression: Trust's signIn result never matched the nonce message (it adds Version and
    // Chain ID), so connecting showed two sign-in prompts before /auth/verify.
    const trust = wallet('Trust', ['solana:mainnet']);
    const own = account(ADDRESS, ['solana:mainnet']);
    trust.connect.mockResolvedValue({ accounts: [own] });
    const signIn = vi.fn(async (input: Parameters<typeof phantomFormat>[0]) => [
      {
        account: own,
        signedMessage: new TextEncoder().encode(trustFormat(input)),
        signature: new Uint8Array(64).fill(9),
      },
    ]);
    trust.features['solana:signIn'] = { version: '1.0.0', signIn };
    const signer = await signerFromStandardWallet(trust);
    expect(signer.signIn).toBeUndefined();
    await signSignInMessage(signer, SIWS);
    expect(signIn).not.toHaveBeenCalled();
    expect(trust.signMessage).toHaveBeenCalledTimes(1);
    expect(trust.signMessage.mock.calls[0]?.[0].message).toEqual(new TextEncoder().encode(SIWS));
  });

  it('keeps signIn for Backpack and Solflare, which rebuild the exact text', async () => {
    for (const name of ['Backpack', 'Solflare']) {
      const w = wallet(name);
      const own = account(ADDRESS, [DEVNET_CHAIN]);
      w.connect.mockResolvedValue({ accounts: [own] });
      const signIn = vi.fn(async (input: Parameters<typeof phantomFormat>[0]) => [
        {
          account: own,
          signedMessage: new TextEncoder().encode(phantomFormat(input)),
          signature: new Uint8Array(64).fill(9),
        },
      ]);
      w.features['solana:signIn'] = { version: '1.0.0', signIn };
      const signer = await signerFromStandardWallet(w);
      const signature = await signSignInMessage(signer, SIWS);
      expect(Array.from(signature)).toEqual(new Array(64).fill(9));
      expect(signIn).toHaveBeenCalledTimes(1);
      expect(w.signMessage).not.toHaveBeenCalled();
    }
  });
});

describe('walletErrorMessage', () => {
  it('keeps the wallet name and code so the real failure is visible', () => {
    const err = Object.assign(new Error('Unexpected error'), { code: -32603 });
    expect(walletErrorMessage(err, 'Phantom')).toBe('Phantom: Unexpected error (code -32603)');
    expect(walletErrorMessage(new Error('Phantom cannot sign'), 'Phantom')).toBe(
      'Phantom cannot sign',
    );
    expect(walletErrorMessage({ message: 'User rejected the request.', code: 4001 })).toBe(
      'User rejected the request. (code 4001)',
    );
    expect(walletErrorMessage(undefined)).toBe('sign-in failed');
  });
});

describe('withTimeout', () => {
  it('rejects a wallet call that never settles', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => undefined), 1000, 'no answer');
    const check = expect(pending).rejects.toThrow('no answer');
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    vi.useRealTimers();
    await expect(withTimeout(Promise.resolve(3), 1000, 'x')).resolves.toBe(3);
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
});
