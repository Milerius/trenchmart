import { describe, expect, it } from 'vitest';
import { cachedSolUsd } from './price';

describe('cached SOL/USD', () => {
  it('uses a fresh quote, then the cache, then the last price when the source fails', async () => {
    let calls = 0;
    const fetchUsd = async () => {
      calls += 1;
      return 150.25;
    };
    const first = await cachedSolUsd({ nowMs: 1_000, cache: null, fetchUsd });
    expect(first.source).toBe('live');
    expect(first.centsPerSol).toBe(15_025n);
    const second = await cachedSolUsd({ nowMs: 2_000, cache: first.cache, fetchUsd });
    expect(second.source).toBe('cache');
    expect(calls).toBe(1);
    const failed = await cachedSolUsd({
      nowMs: 90_000,
      cache: first.cache,
      fetchUsd: async () => {
        throw new Error('down');
      },
    });
    expect(failed.source).toBe('cache');
    expect(failed.centsPerSol).toBe(15_025n);
    const empty = await cachedSolUsd({ nowMs: 1, cache: null, fetchUsd: async () => null });
    expect(empty.source).toBe('unavailable');
    const override = await cachedSolUsd({ nowMs: 1, cache: null, override: '10', fetchUsd });
    expect(override.source).toBe('override');
    expect(override.centsPerSol).toBe(1_000n);
  });
});
