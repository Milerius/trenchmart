import { describe, expect, it } from 'vitest';
import { WALLET_CATALOG, buildWalletChoices, safeWalletIcon } from './wallet-catalog';
import { WALLET_LOGOS, bundledWalletLogo } from './wallet-logos';

describe('bundled wallet logos', () => {
  it('gives every catalog row, including deeplinks, its own official logo', () => {
    const seen = new Set<string>();
    for (const entry of WALLET_CATALOG) {
      const logo = bundledWalletLogo(entry.id);
      expect(logo, entry.id).toMatch(/^data:image\/(svg\+xml|png);base64,/);
      expect(safeWalletIcon(logo), entry.id).toBe(logo);
      expect(logo!.length, entry.id).toBeGreaterThan(400);
      if (!entry.id.startsWith('open-')) seen.add(logo!);
    }
    expect(seen.size).toBe(Object.keys(WALLET_LOGOS).length);
  });

  it('shares the logo between a wallet and its open-in row', () => {
    for (const id of ['phantom', 'solflare', 'trust', 'backpack']) {
      expect(bundledWalletLogo(`open-${id}`)).toBe(bundledWalletLogo(id));
    }
  });

  it('never hotlinks: every logo is an inline data URI', () => {
    for (const logo of Object.values(WALLET_LOGOS)) {
      expect(logo.startsWith('data:')).toBe(true);
      if (!logo.startsWith('data:image/svg')) continue;
      const svg = atob(logo.slice(logo.indexOf(',') + 1));
      expect(svg).not.toMatch(/href=["']https?:|url\(\s*["']?https?:|<image/i);
    }
  });

  it('has no bundled logo for wallets outside the catalog', () => {
    expect(bundledWalletLogo('other:mystery')).toBeNull();
    const rows = buildWalletChoices({
      detected: [{ id: 'other:mystery', name: 'Mystery' }],
      query: '',
      lastUsedId: null,
    });
    expect(rows.find((row) => row.id === 'other:mystery')?.icon).toBeNull();
  });
});
