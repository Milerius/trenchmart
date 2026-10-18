import { describe, expect, it } from 'vitest';
import {
  supplementReasonText,
  updateBanner,
  updatePolicyText,
  updatesStatus,
  type OrderUpdates,
} from './updates';
import { ensureVerificationFee, paySupplement } from './studio';

const base: OrderUpdates = {
  purchased: { id: 'v1', semver: '1.0.0' },
  current: { id: 'v1', semver: '1.0.0' },
  latest: { id: 'v2', semver: '1.1.0', changelog: 'New filter' },
  latestEntitled: { id: 'v2', semver: '1.1.0' },
  updateAvailable: true,
  entitledToLatest: true,
  changes: [{ semver: '1.1.0', changelog: 'New filter' }],
  updatesUntil: '2026-11-17T00:00:00.000Z',
  forever: false,
  active: true,
  updatePrice: '100000000',
  renewTotal: '105000000',
  periodDays: 30,
  versions: [],
};

describe('purchases update banner', () => {
  it('says the update is included while updates are active', () => {
    expect(updateBanner(base)).toEqual({ kind: 'included', from: '1.0.0', to: '1.1.0' });
  });
  it('asks for a renewal once the latest version is outside the entitlement', () => {
    expect(updateBanner({ ...base, entitledToLatest: false, active: false })).toEqual({
      kind: 'renew',
      from: '1.0.0',
      to: '1.1.0',
      price: '105000000',
    });
  });
  it('shows nothing when the buyer already has the latest', () => {
    expect(updateBanner({ ...base, updateAvailable: false })).toEqual({ kind: 'none' });
    expect(updateBanner(null)).toEqual({ kind: 'none' });
  });
  it('states the window', () => {
    const now = Date.parse('2026-11-01T00:00:00Z');
    expect(updatesStatus(base, now)).toBe('Updates included until 2026-11-17');
    expect(updatesStatus(base, Date.parse('2026-12-01T00:00:00Z'))).toBe(
      'Updates ended 2026-11-17',
    );
    expect(updatesStatus({ ...base, forever: true }, now)).toBe('Free updates forever');
    expect(updatesStatus({ ...base, updatesUntil: null }, now)).toBe('Updates not included');
  });
  it('describes the listing policy', () => {
    expect(updatePolicyText('100000000', 30)).toBe('Free updates for 30 days, then 0.10 SOL/month');
    expect(updatePolicyText('0', 30)).toBe('Free updates forever');
    expect(updatePolicyText(null, 30)).toBe('Free updates forever');
    expect(supplementReasonText(['listing_update_limit'])).toContain('free update today');
    expect(supplementReasonText(['creator_upload_limit'], 7)).toContain('your 7 free uploads');
    expect(supplementReasonText(['creator_upload_limit'])).not.toMatch(/\d/);
  });
});

describe('supplement payments', () => {
  it('signs, sends and records a supplement, retrying while the tx is not visible', async () => {
    const calls: string[] = [];
    let first = true;
    const api = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (first) {
        first = false;
        throw Object.assign(new Error('nf'), { code: 'TX_NOT_FOUND' });
      }
      return {} as T;
    };
    const paid = await paySupplement({
      api,
      supplementId: 's1',
      tx: { txBase64: 'AA' },
      signAndSend: async () => 'sig',
      retry: { sleep: async () => undefined },
    });
    expect(paid).toBe(true);
    expect(calls).toEqual(['/supplements/s1/submitted', '/supplements/s1/submitted']);
    expect(
      await paySupplement({ api, supplementId: 's1', tx: null, signAndSend: async () => 'x' }),
    ).toBe(false);
  });
  it('settles an open upload supplement before review resumes', async () => {
    const calls: string[] = [];
    const api = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (path.endsWith('/fee-tx'))
        return {
          paid: true,
          feeTx: null,
          supplement: { id: 's9', paid: false, tx: { txBase64: 'AA' } },
        } as T;
      return {} as T;
    };
    expect(
      await ensureVerificationFee({ api, versionId: 'v1', signAndSend: async () => 'sig' }),
    ).toBe(true);
    expect(calls).toEqual(['/studio/versions/v1/fee-tx', '/supplements/s9/submitted']);
  });
});
