import { describe, expect, it, vi } from 'vitest';
import {
  DEVNET_CHAIN,
  discoverWallet,
  isLikelyMobile,
  isUsableSolanaWallet,
  phantomBrowseUrl,
  pickSolanaWallet,
  readInjectedProvider,
  signerFromStandardWallet,
  type InjectedScope,
  type StandardAccount,
  type StandardWallet,
  type WalletList,
} from './wallet-detect';

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
