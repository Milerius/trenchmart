import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE_DESCRIPTION, SITE_TITLE } from './site-meta';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('link preview metadata', () => {
  it('has no devnet wording', () => {
    expect(SITE_TITLE).not.toMatch(/devnet/i);
    expect(SITE_DESCRIPTION).not.toMatch(/devnet/i);
  });
  it('layout wires title/description into openGraph and twitter', () => {
    const layout = src('../app/layout.tsx');
    expect(layout).toMatch(/openGraph:\s*{\s*title: SITE_TITLE,\s*description: SITE_DESCRIPTION/);
    expect(layout).toMatch(/twitter:\s*{[^}]*title: SITE_TITLE, description: SITE_DESCRIPTION/);
  });
  it('listing titles have no devnet suffix', () => {
    expect(src('../app/l/[slug]/page.tsx')).not.toMatch(/TrenchMart \(Solana devnet\)/);
  });
});
