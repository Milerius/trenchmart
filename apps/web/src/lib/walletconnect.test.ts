import {
  compileUnsignedTransferMemo,
  randomKeypair,
  signLegacyTransaction,
  toBase64,
} from '@trenchmart/chain';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SOLANA_DEVNET_CAIP,
  SOLANA_MAINNET_CAIP,
  WALLETCONNECT_PROJECT_ID,
  createWalletConnectProvider,
  devnetConnectParams,
  parseSessionAddress,
  signWalletConnectMessage,
  signWalletConnectTransaction,
  signedTransactionFromResult,
  startWalletConnect,
  walletConnectProjectId,
  type WcProviderLike,
} from './walletconnect';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
});

describe('walletConnectProjectId', () => {
  it('uses the committed Reown project when nothing is set', () => {
    expect(walletConnectProjectId()).toBe(WALLETCONNECT_PROJECT_ID);
    expect(WALLETCONNECT_PROJECT_ID).toBe('9e9aab84f03d9799c7a3dc4ee77fa93b');
  });

  it('hides the row for an empty or placeholder override', () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = '';
    expect(walletConnectProjectId()).toBe('');
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = '${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}';
    expect(walletConnectProjectId()).toBe('');
    vi.stubGlobal('window', { __TRENCHMART_WC_PROJECT_ID__: '' });
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = WALLETCONNECT_PROJECT_ID;
    expect(walletConnectProjectId()).toBe('');
  });

  it('lets the page override win over the env', () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = 'from-env';
    vi.stubGlobal('window', { __TRENCHMART_WC_PROJECT_ID__: 'from-window' });
    expect(walletConnectProjectId()).toBe('from-window');
  });
});

describe('devnet pairing', () => {
  it('asks only for the Solana devnet CAIP chain', () => {
    const params = devnetConnectParams();
    expect(params.optionalNamespaces?.solana?.chains).toEqual([SOLANA_DEVNET_CAIP]);
    expect(params.namespaces).toBeUndefined();
    expect(JSON.stringify(params)).not.toContain(SOLANA_MAINNET_CAIP);
    expect(JSON.stringify(params)).not.toContain('mainnet');
    expect(SOLANA_DEVNET_CAIP).not.toBe('solana:devnet');
  });

  it('returns the wc: uri before the phone approves, and refuses a mainnet account', async () => {
    let resolveSession: (value: {
      topic: string;
      namespaces: { solana: { accounts: string[] } };
    }) => void = () => {};
    const calls: unknown[] = [];
    const provider: WcProviderLike = {
      on(event, listener) {
        if (event === 'display_uri') listener('wc:topic@2?relay-protocol=irn&symKey=aa');
      },
      connect(opts) {
        calls.push(opts);
        return new Promise((resolve) => {
          resolveSession = resolve;
        });
      },
      async request() {
        throw new Error('not used');
      },
    };
    const started = startWalletConnect(provider);
    await expect(started.uri).resolves.toMatch(/^wc:/);
    expect(calls).toEqual([devnetConnectParams()]);
    resolveSession({
      topic: 'topic',
      namespaces: { solana: { accounts: [`${SOLANA_MAINNET_CAIP}:MainnetAddr`] } },
    });
    await expect(started.session).rejects.toThrow(/Devnet/);
  });

  it('reads a devnet account', () => {
    expect(parseSessionAddress([`${SOLANA_DEVNET_CAIP}:DevnetAddr`])).toBe('DevnetAddr');
    expect(() => parseSessionAddress([])).toThrow(/Devnet/);
  });
});

describe('WalletConnect signing', () => {
  const session = { topic: 'topic', address: 'DevnetAddr' };

  it('sends solana_signMessage on devnet and decodes the signature', async () => {
    const seen: { method?: string; chain?: string; params?: object }[] = [];
    const provider: WcProviderLike = {
      on() {},
      async connect() {
        return undefined;
      },
      async request(args, chain) {
        seen.push({ method: args.method, chain, params: args.params });
        return { signature: bs58.encode(new Uint8Array(64).fill(4)) };
      },
    };
    const message = new TextEncoder().encode('Sign in to TrenchMart');
    const signature = await signWalletConnectMessage(provider, session, message);
    expect(signature).toEqual(new Uint8Array(64).fill(4));
    expect(seen[0]).toMatchObject({
      method: 'solana_signMessage',
      chain: SOLANA_DEVNET_CAIP,
      params: { pubkey: 'DevnetAddr', message: bs58.encode(message) },
    });
  });

  it('splices a signature into the unsigned transaction the same way a local signer does', () => {
    const payer = randomKeypair();
    const dest = randomKeypair();
    const unsigned = compileUnsignedTransferMemo({
      from: payer.publicKey,
      to: dest.publicKey,
      lamports: 1n,
      memo: 'tm:test',
      recentBlockhash: bs58.encode(nacl.randomBytes(32)),
    });
    const signed = signLegacyTransaction(unsigned, payer.secretKey);
    const signature = signed.slice(1, 65);
    expect(signedTransactionFromResult(unsigned, { signature: bs58.encode(signature) })).toEqual(
      signed,
    );
    expect(signedTransactionFromResult(unsigned, { transaction: toBase64(signed) })).toEqual(
      signed,
    );
  });

  it('asks solana_signTransaction for the unsigned bytes on devnet', async () => {
    const seen: { method?: string; chain?: string; params?: { transaction?: string } }[] = [];
    const provider: WcProviderLike = {
      on() {},
      async connect() {
        return undefined;
      },
      async request(args, chain) {
        seen.push({
          method: args.method,
          chain,
          params: args.params as { transaction?: string },
        });
        return bs58.encode(new Uint8Array(64).fill(8));
      },
    };
    const unsigned = new Uint8Array([1, ...new Uint8Array(64), 9]);
    const signed = await signWalletConnectTransaction(provider, session, unsigned);
    expect(signed[0]).toBe(1);
    expect(signed.slice(1, 65)).toEqual(new Uint8Array(64).fill(8));
    expect(seen[0]?.method).toBe('solana_signTransaction');
    expect(seen[0]?.chain).toBe(SOLANA_DEVNET_CAIP);
    expect(seen[0]?.params?.transaction).toBe(toBase64(unsigned));
    expect(seen[0]?.chain).not.toBe(SOLANA_MAINNET_CAIP);
  });
});

describe('mocked relay', () => {
  it('pairs and signs without loading UniversalProvider', async () => {
    const pair = nacl.sign.keyPair();
    vi.stubGlobal('window', {
      __TRENCHMART_WC_MOCK__: {
        uri: 'wc:mock-topic@2?relay-protocol=irn&symKey=aa',
        address: bs58.encode(pair.publicKey),
        secret: bs58.encode(pair.secretKey),
      },
    });
    const provider = await createWalletConnectProvider(WALLETCONNECT_PROJECT_ID);
    const started = startWalletConnect(provider);
    await expect(started.uri).resolves.toBe('wc:mock-topic@2?relay-protocol=irn&symKey=aa');
    window.__TRENCHMART_WC_APPROVE__?.();
    const session = await started.session;
    expect(session.address).toBe(bs58.encode(pair.publicKey));
    const message = new TextEncoder().encode('Sign in to TrenchMart');
    const signature = await signWalletConnectMessage(provider, session, message);
    expect(nacl.sign.detached.verify(message, signature, pair.publicKey)).toBe(true);
  });
});
