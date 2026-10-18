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
      parseSpecs('wallet', {
        chain: 'solana',
        formats: ['csv'],
        walletCount: 0,
        cadence: 'weekly',
        columns: [],
      }).ok,
    ).toBe(false);
    expect(
      parseSpecs('wallet', {
        chain: 'base',
        formats: ['csv'],
        walletCount: 5,
        cadence: 'weekly',
        columns: [],
      }).ok,
    ).toBe(false);
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
        walletCount: 4120,
        cadence: 'weekly',
        columns: [],
      },
      ['Axiom', 'GMGN'],
    );
    expect(rows).toEqual([
      ['Chain', 'Solana'],
      ['Wallets', '4,120'],
      ['Formats', 'CSV, JSON'],
      ['Refresh', 'Weekly'],
      ['Imports into', 'Axiom, GMGN'],
    ]);
    expect(specRows('script', SCRIPT, ['Axiom'])).toContainEqual(['Keys and signing', 'Never']);
    expect(specRows(null, SCRIPT)).toEqual([]);
    expect(specRows('script', null)).toEqual([]);
  });
});
