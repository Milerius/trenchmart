import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The listing page ships to every phone that opens a listing. These shared modules build zod
// schemas at import time, which bundlers cannot drop, so the page must use the zod-free ones.
const ZOD_MODULES = ['listing-kinds', 'schemas', 'social-schemas', 'profile-schema', 'featuring'];
const root = join(__dirname, '..');
const shared = join(root, '../../../packages/shared/src');

describe('listing page imports', () => {
  it('listing view imports no zod-bearing shared module', () => {
    const source = readFileSync(join(root, 'app/l/[slug]/listing-view.tsx'), 'utf8');
    for (const mod of ZOD_MODULES) {
      expect(source).not.toMatch(new RegExp(`@trenchmart/shared/${mod}['"]`));
    }
  });

  it('listing-kinds-display stays free of zod', () => {
    const source = readFileSync(join(shared, 'listing-kinds-display.ts'), 'utf8');
    expect(source).not.toMatch(/from 'zod'/);
    expect(source).not.toMatch(/from '\.\/(listing-kinds|schemas)'/);
  });
});
