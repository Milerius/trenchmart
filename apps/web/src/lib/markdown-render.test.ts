import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../components/markdown';

const html = (source: string, links = true) =>
  renderToStaticMarkup(createElement(Markdown, { source, links }));

// The payloads below are classic XSS vectors. Whatever the seller writes, the rendered
// markup must contain no script element, no event handler attribute and no script URL.
const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
  '[x](javascript:alert(1))',
  '[x](&#106;avascript:alert(1))',
  '<javascript:alert(1)>',
  '![x](javascript:alert(1))',
  '![x](https://evil.example/track.png)',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '<style>body{display:none}</style>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '"><img src=x onerror=alert(1)>',
  '```\n</code></pre><script>alert(1)</script>\n```',
  '[x](https://example.com "\\" onmouseover=\\"alert(1)")',
];

describe('Markdown component', () => {
  it.each(PAYLOADS)('renders %s inert', (payload) => {
    const out = html(`Intro\n\n${payload}\n\nOutro`);
    expect(out).not.toMatch(/<script|<iframe|<svg|<math|<style|<object|<embed/i);
    // Text is escaped (&lt;img ...&gt;), so only real tags start with "<".
    expect(out).not.toMatch(/<[^>]*\son[a-z]+=/i);
    expect(out).not.toMatch(/(href|src)="\s*(javascript|data|vbscript):/i);
    expect(out).not.toContain('evil.example/track.png"');
  });

  it('adds rel noopener nofollow and a new tab to external links only', () => {
    const out = html('[a](https://tampermonkey.net) [b](/l/x)');
    expect(out).toMatch(
      /<a href="https:\/\/tampermonkey.net\/"[^>]*target="_blank" rel="noopener noreferrer nofollow ugc">/,
    );
    expect(out).toMatch(/<a href="\/l\/x" class="[^"]*">/);
  });

  it('renders our media and replaces hotlinked images with a notice', () => {
    const out = html(
      '![a](/api/v1/media/a3f1c2d4-1111-4222-8333-444455556666) ![b](https://evil.example/b.png)',
    );
    expect(out).toContain('src="/api/v1/media/a3f1c2d4-1111-4222-8333-444455556666"');
    expect(out).toMatch(/referrerPolicy="no-referrer"/i);
    expect(out).toContain('External image removed (evil.example)');
  });

  it('drops links entirely when links are off (version changelogs)', () => {
    const out = html('see [site](https://example.com)', false);
    expect(out).not.toContain('<a ');
    expect(out).toContain('site');
  });
});
