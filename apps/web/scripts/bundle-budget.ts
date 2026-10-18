// Bundle-size guard (CI): gzip size of the JS each prerendered page loads on first visit.
// Run after `next build` (pnpm --filter @trenchmart/web budget). Fails when a page goes over its budget, so a heavy import
// (wallet SDKs, zod, crypto) sneaking into the shared bundle is caught in review.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const app = join(root, '.next/server/app');
const KB = 1024;

// Budgets in gzip KB. The baseline before the perf pass was ~240 KB per page.
export const BUDGETS: Record<string, number> = {
  '/': 180,
  '/search': 175,
  '/studio': 185,
  '/me/purchases': 190,
  '/verify': 190,
  '/creators': 175,
  '/sell': 175,
  '/c/userscript': 175,
};

function htmlFor(route: string): string | null {
  const file = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
  const path = join(app, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function scriptsIn(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g) ?? []) {
    if (/\bnoModule\b|\bnomodule\b/i.test(tag)) continue; // legacy polyfills: modern browsers skip them
    out.add(tag.match(/src="([^"]+)"/)![1]!);
  }
  return [...out];
}

let failed = false;
const rows: string[] = [];
for (const [route, budget] of Object.entries(BUDGETS)) {
  const html = htmlFor(route);
  if (!html) {
    console.error(`missing prerendered HTML for ${route} (run next build first)`);
    failed = true;
    continue;
  }
  let bytes = 0;
  for (const src of scriptsIn(html)) {
    if (!src.startsWith('/_next/')) continue;
    bytes += gzipSync(readFileSync(join(root, '.next', src.slice('/_next/'.length)))).length;
  }
  const kb = bytes / KB;
  const ok = kb <= budget;
  if (!ok) failed = true;
  rows.push(
    `${ok ? 'ok  ' : 'OVER'} ${route.padEnd(14)} ${kb.toFixed(1).padStart(6)} KB / ${budget} KB`,
  );
}
console.log(rows.join('\n'));
if (failed) {
  console.error(
    '\nJS budget exceeded. Lazy-load the new dependency or raise the budget with a reason.',
  );
  process.exit(1);
}
