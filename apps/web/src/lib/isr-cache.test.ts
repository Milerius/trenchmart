import { describe, expect, it } from 'vitest';
import { cacheKey, createCacheApiIncrementalCache } from './isr-cache';

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
});
