import { describe, expect, it } from 'vitest';
import {
  LAST_WALLET_KEY,
  buildWalletChoices,
  catalogIdFor,
  detectedIdFor,
  readLastWallet,
  safeWalletIcon,
  walletConnectQr,
  writeLastWallet,
} from './wallet-catalog';

describe('buildWalletChoices', () => {
  it('lists every catalog wallet when nothing is installed, Phantom first with Popular', () => {
    const rows = buildWalletChoices({ detected: [], query: '', lastUsedId: null });
    expect(rows.map((row) => row.name)).toEqual([
      'Phantom',
      'WalletConnect',
      'Solflare',
      'Trust',
      'Glow',
      'Coinbase',
      'Backpack',
    ]);
    expect(rows.every((row) => !row.installed)).toBe(true);
    expect(rows[0]).toMatchObject({
      id: 'phantom',
      popular: true,
      installUrl: 'https://phantom.com/download',
    });
    expect(rows[1]).toMatchObject({ id: 'walletconnect', kind: 'walletconnect', installUrl: null });
  });

  it('puts detected wallets first and does not drop the ones that are missing', () => {
    const rows = buildWalletChoices({
      detected: [
        { id: 'solflare', name: 'Solflare' },
        { id: 'backpack', name: 'Backpack', icon: 'data:image/png;base64,aaaa' },
      ],
      query: '',
      lastUsedId: null,
    });
    expect(rows.map((row) => row.id)).toEqual([
      'solflare',
      'backpack',
      'phantom',
      'walletconnect',
      'trust',
      'glow',
      'coinbase',
    ]);
    expect(rows.filter((row) => row.installed).map((row) => row.id)).toEqual([
      'solflare',
      'backpack',
    ]);
    expect(rows.find((row) => row.id === 'backpack')?.icon).toContain('data:image/png');
    expect(rows.find((row) => row.id === 'phantom')?.popular).toBe(true);
  });

  it('remembers the last wallet by sorting it ahead of the other installed ones', () => {
    const rows = buildWalletChoices({
      detected: [
        { id: 'phantom', name: 'Phantom' },
        { id: 'solflare', name: 'Solflare' },
      ],
      query: '',
      lastUsedId: 'solflare',
    });
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual(['solflare', 'phantom']);
    expect(rows[2]?.id).toBe('walletconnect');
    expect(rows[2]?.installed).toBe(false);
  });

  it('keeps a detected wallet that is not in the catalog', () => {
    const rows = buildWalletChoices({
      detected: [{ id: 'other:nightly', name: 'Nightly' }],
      query: '',
      lastUsedId: null,
    });
    expect(rows[0]).toMatchObject({ id: 'other:nightly', name: 'Nightly', installed: true });
    expect(rows).toHaveLength(8);
  });

  it('filters by the search box without forgetting installed-first order', () => {
    const rows = buildWalletChoices({
      detected: [{ id: 'solflare', name: 'Solflare' }],
      query: 'a',
      lastUsedId: null,
    });
    expect(rows.map((row) => row.name)).toEqual([
      'Solflare',
      'Phantom',
      'WalletConnect',
      'Coinbase',
      'Backpack',
    ]);
  });
});

describe('catalogIdFor', () => {
  it('recognises the wallets Roman listed', () => {
    expect(catalogIdFor('Phantom')).toBe('phantom');
    expect(catalogIdFor('Solflare')).toBe('solflare');
    expect(catalogIdFor('Trust Wallet')).toBe('trust');
    expect(catalogIdFor('Glow')).toBe('glow');
    expect(catalogIdFor('Coinbase Wallet')).toBe('coinbase');
    expect(catalogIdFor('Backpack')).toBe('backpack');
    expect(catalogIdFor('WalletConnect')).toBe('walletconnect');
    expect(catalogIdFor('Nightly')).toBeNull();
    expect(detectedIdFor('Nightly')).toBe('other:nightly');
  });
});

describe('safeWalletIcon', () => {
  it('keeps image data uris and https, and drops svg scripts', () => {
    expect(safeWalletIcon('data:image/png;base64,aaaa')).toBe('data:image/png;base64,aaaa');
    expect(safeWalletIcon('https://cdn.example/icon.png')).toBe('https://cdn.example/icon.png');
    expect(
      safeWalletIcon(
        'data:image/svg+xml,' + encodeURIComponent('<svg><script>alert(1)</script></svg>'),
      ),
    ).toBeNull();
    expect(safeWalletIcon('javascript:alert(1)')).toBeNull();
    expect(safeWalletIcon(undefined)).toBeNull();
  });
});

describe('last wallet storage', () => {
  it('reads and writes the id', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    };
    expect(readLastWallet(storage)).toBeNull();
    writeLastWallet(storage, 'backpack');
    expect(storage.getItem(LAST_WALLET_KEY)).toBe('backpack');
    expect(readLastWallet(storage)).toBe('backpack');
    expect(readLastWallet(null)).toBeNull();
  });
});

describe('walletConnectQr', () => {
  it('returns an svg for the mobile open link', () => {
    const svg = walletConnectQr('https://phantom.app/ul/browse/https%3A%2F%2Ftrenchmart.fun');
    expect(svg?.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<script');
  });
});
