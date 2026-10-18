// After `opennextjs-cloudflare build`: copy the build's prerendered cache entries into the
// Workers static assets directory (cdn-cgi/ is only readable by the worker), so prerendered
// pages are served from assets on the first request in a colo instead of rendered again.
// Read by createCacheApiIncrementalCache (src/lib/isr-cache.ts). Same layout as OpenNext's
// static-assets incremental cache.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const from = join(root, '.open-next/cache');
const to = join(root, '.open-next/assets/cdn-cgi/_next_cache');
if (!existsSync(from)) {
  console.error(`${from} not found: run opennextjs-cloudflare build first`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (src) => !src.includes('/__fetch') });
console.log(`seeded prerendered pages into ${to}`);
