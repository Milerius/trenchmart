import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// React Bits is MIT + Commons Clause: every copied file must keep the copyright notice.
const dir = new URL('.', import.meta.url).pathname;
const files = readdirSync(dir).filter((name) => name.endsWith('.tsx'));
const notices = readFileSync(join(dir, '../../../../../THIRD_PARTY_NOTICES.md'), 'utf8');

describe('React Bits licence notice', () => {
  it('has at least one vendored component', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    it(`${name} carries the copyright notice`, () => {
      const head = readFileSync(join(dir, name), 'utf8').slice(0, 600);
      expect(head).toContain('React Bits (https://reactbits.dev)');
      expect(head).toContain('Copyright (c) 2026 David Haz');
      expect(head).toContain('MIT + Commons Clause License Condition v1.0');
      expect(head).toContain('THIRD_PARTY_NOTICES.md');
    });
  }

  it('THIRD_PARTY_NOTICES.md has the full React Bits licence', () => {
    expect(notices).toContain('MIT + Commons Clause License Condition v1.0');
    expect(notices).toContain('Commons Clause Restriction');
    expect(notices).toContain('Copyright (c) 2026 David Haz');
  });
});
