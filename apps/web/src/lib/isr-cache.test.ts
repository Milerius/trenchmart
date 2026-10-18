import { describe, expect, it } from 'vitest';
import { cacheKey, createCacheApiIncrementalCache, staticAssetUrl } from './isr-cache';

function memoryCache() {
  const store = new Map<string, Response>();
  return {
    store,
    async match(request: Request) {
      return store.get(request.url)?.clone();
    },
    async put(request: Request, response: Response) {
      store.set(request.url, response);
    },
    async delete(request: Request) {
      return store.delete(request.url);
    },
  };
}

describe('Cache API incremental cache (ISR)', () => {
  it('round-trips an entry with its lastModified time', async () => {
    const mem = memoryCache();
    const cache = createCacheApiIncrementalCache(
      () => mem,
      () => 'b1',
      () => 1234,
    );
    await cache.set('/l/demo', { kind: 'APP_PAGE', html: '<p>x</p>' });
    expect(await cache.get('/l/demo')).toEqual({
      value: { kind: 'APP_PAGE', html: '<p>x</p>' },
      lastModified: 1234,
    });
  });

  it('keeps builds and cache types apart, and deletes', async () => {
    const mem = memoryCache();
    const a = createCacheApiIncrementalCache(
      () => mem,
      () => 'a',
    );
    const b = createCacheApiIncrementalCache(
      () => mem,
      () => 'b',
    );
    await a.set('/l/x', 1);
    expect(await b.get('/l/x')).toBeNull();
    expect(await a.get('/l/x', 'fetch')).toBeNull();
    await a.delete('/l/x');
    expect(await a.get('/l/x')).toBeNull();
  });

  it('stores entries long enough for stale-while-revalidate, never under a real page URL', async () => {
    const mem = memoryCache();
    await createCacheApiIncrementalCache(
      () => mem,
      () => 'b',
    ).set('/l/x', 1);
    const [url, res] = [...mem.store.entries()][0]!;
    expect(url).toContain('/__tm-isr-cache/');
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(cacheKey('/l/x', 'cache', 'b').url).toBe(url);
  });

  it('is a no-op without a cache (local dev / tests)', async () => {
    const cache = createCacheApiIncrementalCache(() => null);
    await cache.set('k', 1);
    expect(await cache.get('k')).toBeNull();
  });

  it('reports a fresh entry as just modified, so Next serves it as a HIT instead of STALE', async () => {
    const mem = memoryCache();
    let t = 1_000_000;
    const cache = createCacheApiIncrementalCache(() => mem, { buildId: () => 'b', now: () => t });
    await cache.set('/l/demo', { type: 'app', html: 'x', revalidate: 300 });
    t += 120_000; // 2 min later: inside the 5 min window
    expect(((await cache.get('/l/demo')) as { lastModified: number } | null)?.lastModified).toBe(t);
    t += 200_000; // past the window: the real time, so Next revalidates once
    expect(((await cache.get('/l/demo')) as { lastModified: number } | null)?.lastModified).toBe(
      1_000_000,
    );
  });

  it('leaves entries without a revalidate time alone', async () => {
    const mem = memoryCache();
    let t = 5_000;
    const cache = createCacheApiIncrementalCache(() => mem, { buildId: () => 'b', now: () => t });
    await cache.set('/x', { type: 'app', html: 'x' });
    t += 10;
    expect(((await cache.get('/x')) as { lastModified: number } | null)?.lastModified).toBe(5_000);
  });

  it('falls back to the build-time copy in static assets on a cold colo', async () => {
    const asked: string[] = [];
    const assets = {
      async fetch(url: Request | string) {
        const u = typeof url === 'string' ? url : url.url;
        asked.push(u);
        return u.endsWith('/index.cache')
          ? new Response(JSON.stringify({ type: 'app', html: 'home' }))
          : new Response('nope', { status: 404 });
      },
    };
    const cache = createCacheApiIncrementalCache(() => memoryCache(), {
      buildId: () => 'B1',
      now: () => 9_000,
      assets: () => assets,
      builtAt: () => 7_000,
    });
    expect(await cache.get('/index')).toEqual({
      value: { type: 'app', html: 'home' },
      lastModified: 7_000,
    });
    expect(asked[0]).toBe(staticAssetUrl('/index', 'B1'));
    expect(await cache.get('/missing')).toBeNull();
    // Fetch-cache entries never come from the build copy.
    expect(await cache.get('/index', 'fetch')).toBeNull();
  });
});
