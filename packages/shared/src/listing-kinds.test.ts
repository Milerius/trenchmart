import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './categories';
import { categoryForKind, LISTING_KINDS, parseSpecs, specRows } from './listing-kinds';
import { listingBody } from './schemas';

const base = {
  title: 'Bundle Detector',
  summary: 'Flags bundles',
  description: 'Does a thing',
  priceLamports: '1000000000',
};
const SCRIPT = {
  managers: ['Tampermonkey', 'Tampermonkey', 'Violentmonkey'],
  browsers: ['Chrome'],
  readsPage: true,
  network: 'hosts',
  hosts: ['API.Axiom.trade', 'gmgn.ai/defi'],
  tradeButtons: false,
  storage: 'local',
};

describe('listing kinds', () => {
  it('maps every kind to a real category', () => {
    const codes = new Set(CATEGORIES.map((c) => c.code));
    for (const kind of LISTING_KINDS) expect(codes.has(kind.category)).toBe(true);
    expect(categoryForKind('script')).toBe('userscript');
    expect(categoryForKind('wallet')).toBe('wallet_list');
    expect(categoryForKind('telegram')).toBe('alerts');
  });

  it('validates and normalises script specs', () => {
    const parsed = parseSpecs('script', SCRIPT);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.specs.managers).toEqual(['Tampermonkey', 'Violentmonkey']);
      expect(parsed.specs.hosts).toEqual(['api.axiom.trade', 'gmgn.ai/defi']);
    }
    expect(parseSpecs('script', { ...SCRIPT, hosts: ['xn--axom-0ra.trade'] }).ok).toBe(false);
    expect(parseSpecs('script', { ...SCRIPT, hosts: ['https://evil.com'] }).ok).toBe(false);
    expect(parseSpecs('script', { ...SCRIPT, managers: ['Evil'] }).ok).toBe(false);
    expect(parseSpecs('script', { ...SCRIPT, extra: 1 }).ok).toBe(false);
  });

  it('requires the essentials per kind', () => {
    expect(parseSpecs('bot', { bots: [], settings: [] })).toMatchObject({ ok: false });
    expect(
      parseSpecs('wallet', { chain: 'solana', formats: [], cadence: 'weekly', columns: [] }).ok,
    ).toBe(false);
    expect(
      parseSpecs('wallet', { chain: 'base', formats: ['csv'], cadence: 'weekly', columns: [] }).ok,
    ).toBe(false);
  });

  it('wallet specs carry no wallet count: the scan counts the file', () => {
    const wallet = { chain: 'solana', formats: ['csv'], cadence: 'weekly', columns: [] };
    expect(parseSpecs('wallet', wallet)).toEqual({ ok: true, specs: wallet });
    // An older client's typed count is dropped, never stored.
    expect(parseSpecs('wallet', { ...wallet, walletCount: 0 })).toEqual({
      ok: true,
      specs: wallet,
    });
    expect(parseSpecs('wallet', { ...wallet, walletCount: 412 })).toEqual({
      ok: true,
      specs: wallet,
    });
    expect(parseSpecs('wallet', { ...wallet, extra: 1 }).ok).toBe(false);
    expect(parseSpecs('other', { what: 'ab' }).ok).toBe(false);
    expect(parseSpecs('indicator', { platform: 'TradingView', language: 'Pine Script' }).ok).toBe(
      true,
    );
  });

  it('listingBody: kind must match the category and carry valid specs', () => {
    const ok = listingBody.parse({
      ...base,
      category: 'userscript',
      kind: 'script',
      specs: SCRIPT,
    });
    expect(ok.specs).toMatchObject({ hosts: ['api.axiom.trade', 'gmgn.ai/defi'] });
    expect(
      listingBody.safeParse({ ...base, category: 'filter', kind: 'script', specs: SCRIPT }).success,
    ).toBe(false);
    expect(
      listingBody.safeParse({ ...base, category: 'userscript', kind: 'script', specs: {} }).success,
    ).toBe(false);
    expect(listingBody.safeParse({ ...base, category: 'userscript', specs: SCRIPT }).success).toBe(
      false,
    );
    // Without a kind it is the legacy single-form body.
    expect(listingBody.safeParse({ ...base, category: 'userscript' }).success).toBe(true);
  });

  it('specRows: what buyers see, skipping empty answers', () => {
    const rows = specRows(
      'wallet',
      {
        chain: 'solana',
        formats: ['csv', 'json'],
        walletCount: 9999,
        cadence: 'weekly',
        columns: [],
      },
      ['Axiom', 'GMGN'],
      4120,
    );
    expect(rows).toEqual([
      ['Chain', 'Solana'],
      ['Wallets', '4,120 wallets, counted from the file'],
      ['Formats', 'CSV, JSON'],
      ['Refresh', 'Weekly'],
      ['Imports into', 'Axiom, GMGN'],
    ]);
    // A seller-typed count from an older listing is never shown; only the scan's count is.
    expect(
      specRows('wallet', { chain: 'solana', formats: ['csv'], walletCount: 9999 }).map(([k]) => k),
    ).not.toContain('Wallets');
    expect(specRows('script', SCRIPT, ['Axiom'])).toContainEqual(['Keys and signing', 'Never']);
    expect(specRows(null, SCRIPT)).toEqual([]);
    expect(specRows('script', null)).toEqual([]);
  });
});
