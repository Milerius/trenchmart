/**
 * OpenNext incremental cache on the Workers Cache API (free, no KV/R2 binding needed).
 *
 * Stores ISR pages and `fetch(..., { next: { revalidate } })` results per Cloudflare colo.
 * Entries are only ever written by server renders that read the public, cookie-less API
 * (lib/server-api.ts), so no viewer-specific data can land here. A miss simply re-renders,
 * so eviction or a cold colo only costs one render.
 *
 * Two details make it behave like a real ISR store on Workers:
 *  - Freshness is decided here from the entry's own `revalidate`. Next only knows a lifetime
 *    for paths in the prerender manifest or rendered by the same isolate; for a listing page
 *    first rendered elsewhere it assumes 1 s, so every request came back STALE and re-rendered
 *    in the background. A fresh entry is reported as modified "now"; a stale one keeps its
 *    real time, so Next serves it and revalidates once.
 *  - Pages prerendered at build (home, studio, verify, category pages...) are read from the
 *    build's own cache files in Workers static assets when the colo has no copy yet, instead of
 *    being rendered again on the first request after each deploy. `scripts/seed-static-cache.ts`
 *    copies them into the assets directory after `opennextjs-cloudflare build`.
 */

type Entry = { value: unknown; lastModified: number };

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
};

/** The Workers static assets binding (only `fetch` is used). */
export type AssetsLike = { fetch(request: Request | string): Promise<Response> };

// Keep entries a day: Next decides staleness from lastModified + revalidate and serves
// stale-while-revalidate, so the store must outlive the revalidate window.
const TTL_SECONDS = 86_400;
const ORIGIN = 'https://trenchmart.fun/__tm-isr-cache';
/** Same layout as OpenNext's static-assets incremental cache (only the worker can read cdn-cgi). */
export const STATIC_CACHE_DIR = 'cdn-cgi/_next_cache';

export function cacheKey(key: string, cacheType = 'cache', buildId = ''): Request {
  return new Request(
    `${ORIGIN}/${encodeURIComponent(buildId)}/${encodeURIComponent(cacheType)}/${encodeURIComponent(key)}`,
  );
}

export function staticAssetUrl(key: string, buildId: string): string {
  const path = `${STATIC_CACHE_DIR}/${buildId}/${key}.cache`.replace(/\/+/g, '/');
  return `http://assets.local/${path}`;
}

function revalidateOf(value: unknown): number | null {
  const r = (value as { revalidate?: unknown } | null)?.revalidate;
  return typeof r === 'number' && r > 0 ? r : null;
}

type Options = {
  buildId?: () => string;
  now?: () => number;
  /** Build-time prerendered entries (Workers static assets); null when unavailable. */
  assets?: () => AssetsLike | null;
  /** When the build ran (lastModified for prerendered entries). */
  builtAt?: () => number;
};

export function createCacheApiIncrementalCache(
  getCache: () => CacheLike | null,
  buildIdOrOptions: (() => string) | Options = {},
  nowArg?: () => number,
) {
  const opts: Options =
    typeof buildIdOrOptions === 'function'
      ? { buildId: buildIdOrOptions, now: nowArg }
      : buildIdOrOptions;
  const buildId = opts.buildId ?? (() => process.env.OPEN_NEXT_BUILD_ID ?? '');
  const now = opts.now ?? Date.now;
  const assets = opts.assets ?? (() => null);
  const builtAt = opts.builtAt ?? now;

  /** Next treats lastModified + its assumed lifetime as the stale point; see the header. */
  const withFreshness = (entry: Entry): Entry => {
    const revalidate = revalidateOf(entry.value);
    if (revalidate === null) return entry;
    const fresh = now() - entry.lastModified < revalidate * 1000;
    return fresh ? { value: entry.value, lastModified: now() } : entry;
  };

  const fromStaticAssets = async (key: string): Promise<Entry | null> => {
    const store = assets();
    if (!store) return null;
    try {
      const res = await store.fetch(staticAssetUrl(key, buildId()));
      if (!res.ok) {
        await res.body?.cancel();
        return null;
      }
      return { value: await res.json(), lastModified: builtAt() };
    } catch {
      return null;
    }
  };

  return {
    name: 'tm-cache-api-incremental-cache',
    async get(key: string, cacheType?: string) {
      const cache = getCache();
      let entry: Entry | null = null;
      if (cache) {
        try {
          const hit = await cache.match(cacheKey(key, cacheType, buildId()));
          if (hit) entry = (await hit.json()) as Entry;
        } catch {
          entry = null;
        }
      }
      if (!entry && (cacheType ?? 'cache') === 'cache') entry = await fromStaticAssets(key);
      return entry ? (withFreshness(entry) as never) : null;
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
