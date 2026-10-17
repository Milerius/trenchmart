import { describe, expect, it } from 'vitest';
import { cachedSolUsd, fetchSolUsd, SOL_USD_SOURCES } from './price';

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

describe('SOL/USD sources', () => {
  const bodies: Record<string, unknown> = {
    coingecko: { solana: { usd: 104.2 } },
    coinbase: { data: { amount: '104.21', base: 'SOL', currency: 'USD' } },
    kraken: { error: [], result: { SOLUSD: { c: ['104.20000', '0.5'] } } },
    jupiter: { So11111111111111111111111111111111111111112: { usdPrice: 104.19 } },
  };
  function fake(statuses: Record<string, number | 'throw' | unknown>) {
    const seen: { name: string; ua: string | null }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      const source = SOL_USD_SOURCES.find((s) => s.url === url)!;
      seen.push({ name: source.name, ua: new Headers(init?.headers).get('user-agent') });
      const status = statuses[source.name] ?? 200;
      if (status === 'throw') throw new Error('network');
      if (typeof status === 'object') return Response.json(status);
      return Response.json(bodies[source.name], { status: status as number });
    }) as typeof fetch;
    return { impl, seen };
  }

  it('reads each source format', async () => {
    for (const source of SOL_USD_SOURCES) {
      expect(source.read(bodies[source.name]), source.name).toBeTruthy();
    }
  });

  it('sends a User-Agent and stops at the first good answer', async () => {
    const { impl, seen } = fake({});
    expect(await fetchSolUsd(impl)).toBe(104.2);
    expect(seen).toEqual([{ name: 'coingecko', ua: expect.stringContaining('trenchmart') }]);
  });

  it('falls back when CoinGecko is blocked or rate limited from a Worker', async () => {
    const blocked = fake({ coingecko: 429 });
    expect(await fetchSolUsd(blocked.impl)).toBe(104.21);
    const down = fake({
      coingecko: 403,
      coinbase: 'throw',
      kraken: { error: ['EGeneral'], result: {} },
    });
    expect(await fetchSolUsd(down.impl)).toBe(104.19);
    expect(down.seen.map((s) => s.name)).toEqual(['coingecko', 'coinbase', 'kraken', 'jupiter']);
  });

  it('ignores insane prices and returns null when every source fails', async () => {
    const zero = fake({
      coingecko: { solana: { usd: 0 } },
      coinbase: 500,
      kraken: 500,
      jupiter: 500,
    });
    expect(await fetchSolUsd(zero.impl)).toBeNull();
    const none = fake({ coingecko: 'throw', coinbase: 'throw', kraken: 'throw', jupiter: 'throw' });
    expect(await fetchSolUsd(none.impl)).toBeNull();
  });

  it('stops trying sources once the shared time budget is spent', async () => {
    let clock = 0;
    const tried: string[] = [];
    const slow = (async (url: string) => {
      tried.push(url);
      clock += 2600; // each source stalls until its own timeout
      throw new Error('timeout');
    }) as unknown as typeof fetch;
    expect(await fetchSolUsd(slow, () => clock)).toBeNull();
    expect(tried).toHaveLength(2);
  });
});
