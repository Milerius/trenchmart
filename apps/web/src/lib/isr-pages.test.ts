import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Listing and creator pages are served from the ISR cache, so its server render must only ever use
// the cookie-less public API (never cookies(), headers() or the user-facing api()).
describe.each(['../app/l/[slug]/page.tsx', '../app/u/[handle]/page.tsx'])('ISR page %s', (file) => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');

  it('revalidates every minute', () => {
    expect(source).toMatch(/export const revalidate = 60;/);
  });

  it('reads only public, cookie-less data on the server', () => {
    expect(source).toContain("from '@/lib/server-api'");
    expect(source).not.toMatch(/next\/headers|cookies\(|headers\(|from '@\/lib\/api'/);
  });
});

describe('server-api', () => {
  it('server-api never forwards cookies or authorization', () => {
    const api = readFileSync(new URL('./server-api.ts', import.meta.url), 'utf8');
    expect(api).toContain("headers: { accept: 'application/json' }");
    expect(api).not.toMatch(/cookie:|authorization:|credentials:/i);
  });
});
