import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT, snapshotSpec } from '../scripts/openapi';
import { ROUTES, scopeOf } from './openapi';

describe('OpenAPI spec', () => {
  it('matches the snapshot shipped with the SDK (run: pnpm --filter @trenchmart/api openapi)', () => {
    const shipped = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    expect(shipped).toEqual(JSON.parse(JSON.stringify(snapshotSpec())));
  });

  it('is OpenAPI 3.1 with unique operation ids and a scope on every operation', () => {
    const spec = snapshotSpec() as any;
    expect(spec.openapi).toBe('3.1.0');
    const ids = new Set<string>();
    for (const route of ROUTES) {
      const op = spec.paths[route.path][route.method];
      expect(ids.has(op.operationId)).toBe(false);
      ids.add(op.operationId);
      expect(op['x-scope']).toBe(scopeOf(route));
    }
    expect(scopeOf(ROUTES.find((r) => r.path === '/orders' && r.method === 'post')!)).toBe('trade');
    expect(scopeOf(ROUTES.find((r) => r.path === '/studio/listings' && r.method === 'post')!)).toBe('sell');
    expect(scopeOf(ROUTES.find((r) => r.path === '/studio/profile' && r.method === 'put')!)).toBe('profile');
    expect(scopeOf(ROUTES.find((r) => r.path === '/orders/{id}/review' && r.method === 'post')!)).toBe('review');
    expect(scopeOf(ROUTES.find((r) => r.path === '/listings' && r.method === 'get')!)).toBe('none');
  });
});
