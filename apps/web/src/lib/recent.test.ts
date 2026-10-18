import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetReads, recentRead, rememberRead } from './recent';

describe('recent reads', () => {
  afterEach(() => {
    forgetReads();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps nothing on the server, where a module map would be shared across visitors', () => {
    rememberRead('stats', { listings: 1 });
    expect(recentRead('stats')).toBeUndefined();
  });

  it('returns the last answer in the browser, and forgets it after 10 minutes', () => {
    vi.stubGlobal('window', {});
    vi.useFakeTimers();
    expect(rememberRead('stats', { listings: 2 })).toEqual({ listings: 2 });
    expect(recentRead('stats')).toEqual({ listings: 2 });
    expect(recentRead('home-listings|All|walletA')).toBeUndefined();
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(recentRead('stats')).toBeUndefined();
  });

  it('holds at most 50 entries, dropping the oldest', () => {
    vi.stubGlobal('window', {});
    for (let i = 0; i < 51; i++) rememberRead(`k${i}`, i);
    expect(recentRead('k0')).toBeUndefined();
    expect(recentRead('k50')).toBe(50);
  });
});
