import { defineCloudflareConfig, getCloudflareContext } from '@opennextjs/cloudflare';
import memoryQueue from '@opennextjs/cloudflare/overrides/queue/memory-queue';
import {
  type AssetsLike,
  createCacheApiIncrementalCache,
  workersDefaultCache,
} from './src/lib/isr-cache';

// ISR pages (listing pages) and revalidating server fetches are kept in the Workers Cache API
// (free; no KV or R2 binding). Pages prerendered at build fall back to the build's cache files
// in static assets (scripts/seed-static-cache.ts). The in-memory queue de-duplicates
// background revalidations.
export default defineCloudflareConfig({
  incrementalCache: () =>
    createCacheApiIncrementalCache(workersDefaultCache, {
      assets: () => {
        try {
          return (getCloudflareContext().env as { ASSETS?: AssetsLike }).ASSETS ?? null;
        } catch {
          return null;
        }
      },
      builtAt: () =>
        (globalThis as { __BUILD_TIMESTAMP_MS__?: number }).__BUILD_TIMESTAMP_MS__ ?? Date.now(),
    }) as never,
  queue: memoryQueue,
});
