/**
 * OpenNext incremental cache on the Workers Cache API (free, no KV/R2 binding needed).
 *
 * Stores ISR pages and `fetch(..., { next: { revalidate } })` results per Cloudflare colo.
 * Entries are only ever written by server renders that read the public, cookie-less API
 * (lib/server-api.ts), so no viewer-specific data can land here. A miss simply re-renders,
 * so eviction or a cold colo only costs one render.
 */

type Entry = { value: unknown; lastModified: number };

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
};

// Keep entries a day: Next decides staleness from lastModified + revalidate and serves
// stale-while-revalidate, so the store must outlive the revalidate window.
const TTL_SECONDS = 86_400;
const ORIGIN = 'https://trenchmart.fun/__tm-isr-cache';

export function cacheKey(key: string, cacheType = 'cache', buildId = ''): Request {
  return new Request(
    `${ORIGIN}/${encodeURIComponent(buildId)}/${encodeURIComponent(cacheType)}/${encodeURIComponent(key)}`,
  );
}

export function createCacheApiIncrementalCache(
  getCache: () => CacheLike | null,
  buildId: () => string = () => process.env.OPEN_NEXT_BUILD_ID ?? '',
  now: () => number = Date.now,
) {
  return {
    name: 'tm-cache-api-incremental-cache',
    async get(key: string, cacheType?: string) {
      const cache = getCache();
      if (!cache) return null;
      try {
        const hit = await cache.match(cacheKey(key, cacheType, buildId()));
        if (!hit) return null;
        return (await hit.json()) as Entry as never;
      } catch {
        return null;
      }
    },
    async set(key: string, value: unknown, cacheType?: string) {
      const cache = getCache();
      if (!cache) return;
      const body = JSON.stringify({ value, lastModified: now() } satisfies Entry);
      try {
        await cache.put(
          cacheKey(key, cacheType, buildId()),
          new Response(body, {
            headers: {
              'content-type': 'application/json',
              'cache-control': `public, max-age=${TTL_SECONDS}`,
            },
          }),
        );
      } catch {
        // A failed write only means the next request renders again.
      }
    },
    async delete(key: string) {
      const cache = getCache();
      if (!cache) return;
      await cache.delete(cacheKey(key, 'cache', buildId())).catch(() => false);
    },
  };
}

export function workersDefaultCache(): CacheLike | null {
  const store = (globalThis as { caches?: { default?: CacheLike } }).caches;
  return store?.default ?? null;
}
