import { describe, expect, it } from 'vitest';
import { parseAppConfig } from './config';
import {
  compareSemver,
  defaultUpdatePrice,
  freeVerificationLeft,
  highestSemver,
  nextPatch,
  nextUtcDay,
  parseSemver,
  renewalMemo,
  renewalQuote,
  renewalWindow,
  supplementMemo,
  updatesActive,
  uploadSupplementReasons,
  utcDayStart,
  versionEntitled,
} from './versioning';
import { versionBody, verifyJsonBody, listingBody, listingPatch } from './schemas';

const DAY = 86_400_000;
const t0 = new Date('2026-10-01T12:00:00.000Z');
const at = (days: number) => new Date(t0.getTime() + days * DAY);

describe('semver helpers', () => {
  it('parses, compares and suggests a patch bump', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('1.2')).toBeNull();
    expect(compareSemver('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareSemver('bad', '1.0.0')).toBeLessThan(0);
    expect(nextPatch('1.4.0')).toBe('1.4.1');
    expect(nextPatch(null)).toBe('1.0.0');
    expect(nextPatch('nope')).toBe('1.0.0');
    expect(highestSemver(['1.0.0', '1.10.0', 'x', '1.9.0'])).toBe('1.10.0');
    expect(highestSemver([])).toBeNull();
  });
});

describe('daily limits (UTC)', () => {
  it('resets at midnight UTC', () => {
    expect(utcDayStart(new Date('2026-10-18T23:59:59.999Z')).toISOString()).toBe(
      '2026-10-18T00:00:00.000Z',
    );
    expect(nextUtcDay(new Date('2026-10-18T01:00:00Z')).toISOString()).toBe(
      '2026-10-19T00:00:00.000Z',
    );
  });

  const limits = { updatesPerListingPerDay: 1, uploadsPerCreatorPerDay: 5 };
  it('allows one free update per listing per day', () => {
    expect(
      uploadSupplementReasons({ isUpdate: true, updatesToday: 0, uploadsToday: 0, limits }),
    ).toEqual([]);
    expect(
      uploadSupplementReasons({ isUpdate: true, updatesToday: 1, uploadsToday: 1, limits }),
    ).toEqual(['listing_update_limit']);
  });
  it('allows five free uploads per creator per day, first versions included', () => {
    expect(
      uploadSupplementReasons({ isUpdate: false, updatesToday: 9, uploadsToday: 4, limits }),
    ).toEqual([]);
    expect(
      uploadSupplementReasons({ isUpdate: false, updatesToday: 0, uploadsToday: 5, limits }),
    ).toEqual(['creator_upload_limit']);
    expect(
      uploadSupplementReasons({ isUpdate: true, updatesToday: 1, uploadsToday: 5, limits }),
    ).toEqual(['listing_update_limit', 'creator_upload_limit']);
  });
  it('gives one free verification only if neither the wallet nor the network used it', () => {
    expect(freeVerificationLeft({ walletUsedToday: 0, ipUsedToday: 0, freePerDay: 1 })).toBe(true);
    expect(freeVerificationLeft({ walletUsedToday: 1, ipUsedToday: 0, freePerDay: 1 })).toBe(false);
    expect(freeVerificationLeft({ walletUsedToday: 0, ipUsedToday: 1, freePerDay: 1 })).toBe(false);
  });
});

describe('update entitlement', () => {
  const purchase = { startsAt: t0, endsAt: at(30) };
  const base = { purchasedVersionId: 'v1', forever: false, periods: [purchase] };

  it('always includes the purchased version', () => {
    expect(
      versionEntitled({ id: 'v1', liveAt: at(-10), supersededAt: at(1) }, { ...base, periods: [] }),
    ).toBe(true);
  });
  it('includes versions released during the free month, not after it', () => {
    expect(versionEntitled({ id: 'v2', liveAt: at(10), supersededAt: null }, base)).toBe(true);
    expect(versionEntitled({ id: 'v3', liveAt: at(31), supersededAt: null }, base)).toBe(false);
  });
  it('a renewal after a gap covers the version live at renewal, not the ones that came and went', () => {
    const renewal = { startsAt: at(60), endsAt: at(90) };
    const periods = [purchase, renewal];
    // Live from day 35 to day 40, entirely in the gap.
    expect(
      versionEntitled({ id: 'gap', liveAt: at(35), supersededAt: at(40) }, { ...base, periods }),
    ).toBe(false);
    // Live from day 40 and still live at renewal (day 60).
    expect(
      versionEntitled({ id: 'v4', liveAt: at(40), supersededAt: null }, { ...base, periods }),
    ).toBe(true);
    expect(
      versionEntitled({ id: 'v5', liveAt: at(80), supersededAt: null }, { ...base, periods }),
    ).toBe(true);
    expect(
      versionEntitled({ id: 'v6', liveAt: at(91), supersededAt: null }, { ...base, periods }),
    ).toBe(false);
  });
  it('free-forever listings include every version; unreviewed versions never', () => {
    expect(
      versionEntitled(
        { id: 'v9', liveAt: at(400), supersededAt: null },
        { ...base, forever: true },
      ),
    ).toBe(true);
    expect(versionEntitled({ id: 'v9', liveAt: null, supersededAt: null }, base)).toBe(false);
  });
  it('renews 30 days from max(now, current expiry)', () => {
    expect(renewalWindow(at(10), at(30), 30)).toEqual({ startsAt: at(30), endsAt: at(60) });
    expect(renewalWindow(at(45), at(30), 30)).toEqual({ startsAt: at(45), endsAt: at(75) });
    expect(renewalWindow(at(45), null, 30)).toEqual({ startsAt: at(45), endsAt: at(75) });
  });
  it('knows when updates are active', () => {
    expect(updatesActive({ forever: false, updatesUntil: at(30), now: at(29) })).toBe(true);
    expect(updatesActive({ forever: false, updatesUntil: at(30), now: at(31) })).toBe(false);
    expect(updatesActive({ forever: false, updatesUntil: null, now: at(1) })).toBe(false);
    expect(updatesActive({ forever: true, updatesUntil: null, now: at(1) })).toBe(true);
  });
  it('prices renewals like purchases: platform fee on top, tier rebate on the fee', () => {
    expect(defaultUpdatePrice(1_000_000_000n, 1000)).toBe(100_000_000n);
    expect(defaultUpdatePrice(0n, 1000)).toBe(0n);
    expect(defaultUpdatePrice(5n, 0)).toBe(0n);
    const q = renewalQuote(100_000_000n, 500, 2500);
    expect(q).toEqual({
      price: 100_000_000n,
      fee: 5_000_000n,
      rebate: 1_250_000n,
      total: 103_750_000n,
      netFee: 3_750_000n,
    });
  });
  it('has distinct memos for supplements and renewals', () => {
    const id = '12345678-aaaa-4bbb-8ccc-000000000000';
    expect(supplementMemo(id)).toBe('sup:12345678');
    expect(renewalMemo(id)).toBe('upd:12345678');
  });
});

describe('config and bodies', () => {
  it('defaults the new limits and supplements, and reads overrides', () => {
    const d = parseAppConfig({});
    expect(d.update_free_days).toBe(30);
    expect(d.update_period_days).toBe(30);
    expect(d.update_price_default_bps).toBe(1000);
    expect(d.update_limit_per_listing_day).toBe(1);
    expect(d.upload_limit_per_creator_day).toBe(5);
    expect(d.upload_supplement_lamports).toBe(50_000_000n);
    expect(d.verify_free_per_day).toBe(1);
    expect(d.verify_supplement_lamports).toBe(10_000_000n);
    const o = parseAppConfig({ upload_supplement_lamports: '70000000', verify_free_per_day: 3 });
    expect(o.upload_supplement_lamports).toBe(70_000_000n);
    expect(o.verify_free_per_day).toBe(3);
  });
  it('a listing PATCH only carries the fields sent', () => {
    expect(listingPatch.parse({ updatePriceLamports: '5' })).toEqual({ updatePriceLamports: '5' });
  });
  it('accepts the new optional fields', () => {
    expect(
      versionBody.parse({
        semver: '1.0.1',
        changelog: 'x',
        fileName: 'a.js',
        fileSize: 1,
        acceptSupplementLamports: '50000000',
      }).acceptSupplementLamports,
    ).toBe('50000000');
    expect(
      verifyJsonBody.safeParse({ fileName: 'a', contentBase64: 'eA==', supplementId: 'no' })
        .success,
    ).toBe(false);
    expect(
      listingBody.parse({
        title: 'Abc',
        summary: 'Abc',
        description: 'd',
        category: 'userscript',
        priceLamports: '1',
        updatePriceLamports: '0',
      }).updatePriceLamports,
    ).toBe('0');
  });
});
