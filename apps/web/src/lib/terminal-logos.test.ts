import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TERMINALS } from '@trenchmart/shared';
import { TerminalPicker } from '../components/wizard';
import { TERMINAL_TILES } from './wizard';

// The wizard's terminal cards show each terminal's own logo, bundled under apps/web/public.
const PUBLIC = join(__dirname, '../../public');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('terminal logos', () => {
  it('every listed terminal has a tile with a local logo', () => {
    expect(TERMINAL_TILES.map((t) => t.name)).toEqual([...TERMINALS]);
    for (const tile of TERMINAL_TILES) {
      expect(tile.logo).toMatch(/^\/terminals\/[a-z]+\.(svg|png)$/);
    }
  });

  it('each logo file exists, is a real SVG or PNG, and stays small', () => {
    for (const tile of TERMINAL_TILES) {
      const path = join(PUBLIC, tile.logo);
      const bytes = readFileSync(path);
      expect(statSync(path).size).toBeLessThan(8 * 1024);
      if (tile.logo.endsWith('.png')) {
        expect(bytes.subarray(0, 8).equals(PNG)).toBe(true);
      } else {
        const svg = bytes.toString('utf8');
        expect(svg.startsWith('<svg')).toBe(true);
        // Bundled as a static image: no scripts and no external references.
        expect(svg).not.toMatch(/<script|href=|https?:\/\/(?!www\.w3\.org)/i);
      }
    }
  });

  it('the picker renders a logo image per terminal instead of a letter', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalPicker, {
        value: [],
        onChange: () => {},
        title: 'Which terminals does it run on?',
        sub: 'Buyers filter by terminal.',
      }),
    );
    for (const tile of TERMINAL_TILES) {
      expect(html).toContain(`src="${tile.logo}"`);
      expect(html).toContain(`data-testid="terminal-logo-${tile.name}"`);
    }
    expect(html).not.toMatch(/https?:\/\/[^"]*\.(svg|png|ico)/);
    expect(html).toContain('TrenchMart is not affiliated with these terminals');
  });
});
