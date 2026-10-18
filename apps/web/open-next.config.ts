import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import memoryQueue from '@opennextjs/cloudflare/overrides/queue/memory-queue';
import { createCacheApiIncrementalCache, workersDefaultCache } from './src/lib/isr-cache';

// ISR pages (listing pages) and revalidating server fetches are kept in the Workers Cache API
// (free; no KV or R2 binding). The in-memory queue de-duplicates background revalidations.
export default defineCloudflareConfig({
  incrementalCache: () => createCacheApiIncrementalCache(workersDefaultCache) as never,
  queue: memoryQueue,
});
