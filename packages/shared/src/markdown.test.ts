import { describe, expect, it } from 'vitest';
import {
  isMediaUrl,
  markdownRefs,
  safeHref,
  safeMarkdown,
  type SafeBlock,
  type SafeInline,
} from './markdown';

const MEDIA = 'a3f1c2d4-1111-4222-8333-444455556666';

function inlinesOf(blocks: SafeBlock[]): SafeInline[] {
  const out: SafeInline[] = [];
  const walkInline = (nodes: SafeInline[]) => {
    for (const node of nodes) {
      out.push(node);
      if ('c' in node) walkInline(node.c);
    }
  };
  const walk = (list: SafeBlock[]) => {
    for (const block of list) {
      if (block.t === 'h' || block.t === 'p') walkInline(block.c);
      if (block.t === 'quote') walk(block.c);
      if (block.t === 'list') for (const item of block.items) walk(item.c);
      if (block.t === 'table')
        for (const cell of [...block.head, ...block.rows.flat()]) walkInline(cell);
    }
  };
  walk(blocks);
  return out;
}

const links = (md: string) =>
  inlinesOf(safeMarkdown(md)).filter((n) => n.t === 'link') as Extract<SafeInline, { t: 'link' }>[];
const images = (md: string) => inlinesOf(safeMarkdown(md)).filter((n) => n.t === 'img');

describe('safe markdown', () => {
  it('parses the usual README syntax', () => {
    const tree = safeMarkdown(
      '# Title\n\nSome **bold** and _em_ and `code`.\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n```js\nconsole.log(1)\n```\n\n> quote\n\n---',
    );
    expect(tree.map((b) => b.t)).toEqual(['h', 'p', 'list', 'table', 'pre', 'quote', 'hr']);
    const list = tree[2] as Extract<SafeBlock, { t: 'list' }>;
    expect(list.items.map((i) => i.checked)).toEqual([true, false]);
    expect((tree[3] as Extract<SafeBlock, { t: 'table' }>).align).toEqual([null, 'right']);
    expect(tree[4]).toEqual({ t: 'pre', lang: 'js', v: 'console.log(1)' });
  });

  it('never produces a javascript:, data: or vbscript: href', () => {
    const attacks = [
      '[x](javascript:alert(1))',
      '[x](JAVASCRIPT:alert(1))',
      '[x]( javascript:alert(1))',
      '[x](&#106;avascript:alert(1))',
      '[x](&#x6A;avascript&#58;alert(1))',
      '[x](javascript&colon;alert(1))',
      '<javascript:alert(1)>',
      '[x][r]\n\n[r]: javascript:alert(1)',
      '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      '[x](vbscript:msgbox(1))',
      '[x](file:///etc/passwd)',
      '[x](//evil.example/path)',
      '[x](/\\evil.example)',
      '[x](https://phantom.app@evil.example)',
    ];
    for (const md of attacks) {
      for (const link of links(md)) {
        expect(link.href, md).toMatch(/^(https?:\/\/[^@]+$|mailto:|\/[^/\\]|#)/);
        expect(link.href.toLowerCase(), md).not.toMatch(/script:|data:|file:/);
      }
    }
    expect(links('[x](javascript:alert(1))')).toEqual([]);
    expect(inlinesOf(safeMarkdown('[click me](javascript:alert(1))'))).toContainEqual({
      t: 'text',
      v: 'click me',
    });
  });

  it('keeps https, mailto, anchors and site paths, marking external ones', () => {
    expect(links('[a](https://tampermonkey.net)')[0]).toMatchObject({
      href: 'https://tampermonkey.net/',
      external: true,
    });
    expect(links('[a](https://trenchmart.fun/l/x)')[0]).toMatchObject({ external: false });
    expect(links('[a](/l/x)')[0]).toMatchObject({ href: '/l/x', external: false });
    expect(links('[a](#panel-security)')[0]).toMatchObject({ href: '#panel-security' });
    expect(links('[a](mailto:hi@example.com)')[0]).toMatchObject({ external: true });
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
  });

  it('shows raw HTML as text and never as markup', () => {
    const tree = safeMarkdown(
      '<script>alert(1)</script>\n\nHi <img src=x onerror=alert(1)> there <b>bold</b>',
    );
    expect(tree[0]).toEqual({ t: 'pre', lang: 'html', v: '<script>alert(1)</script>' });
    const texts = inlinesOf(tree)
      .filter((n) => n.t === 'text')
      .map((n) => (n as { v: string }).v)
      .join('');
    expect(texts).toContain('<img src=x onerror=alert(1)>');
    expect(JSON.stringify(tree)).not.toMatch(/"t":"(script|img)"/);
  });

  it('only loads images from our own media route', () => {
    expect(images(`![a](/api/v1/media/${MEDIA})`)).toHaveLength(1);
    expect(images(`![a](https://trenchmart.fun/api/v1/media/${MEDIA})`)).toHaveLength(1);
    expect(images(`![a](https://api.trenchmart.fun/api/v1/media/${MEDIA})`)).toHaveLength(1);
    for (const src of [
      'https://evil.example/a.png',
      `https://trenchmart.fun.evil.example/api/v1/media/${MEDIA}`,
      `https://trenchmart.fun@evil.example/api/v1/media/${MEDIA}`,
      `http://trenchmart.fun/api/v1/media/${MEDIA}`,
      `https://trenchmart.fun:8443/api/v1/media/${MEDIA}`,
      `https://trenchmart.fun/api/v1/media/${MEDIA}?x=1`,
      `/api/v1/media/${MEDIA}/../../files`,
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz4=',
    ]) {
      expect(isMediaUrl(src), src).toBe(false);
      expect(images(`![a](${src})`), src).toHaveLength(0);
    }
    expect(inlinesOf(safeMarkdown('![a](https://evil.example/a.png)'))).toContainEqual({
      t: 'img-blocked',
      alt: 'a',
      host: 'evil.example',
    });
  });

  it('caps size and nesting so a hostile README cannot hang the page', () => {
    const deep = '>'.repeat(500) + ' deep';
    expect(() => safeMarkdown(deep)).not.toThrow();
    const nested = Array.from({ length: 200 }, (_, i) => ' '.repeat(i * 2) + '- item').join('\n');
    expect(() => safeMarkdown(nested)).not.toThrow();
    expect(() => safeMarkdown('a'.repeat(200_000))).not.toThrow();
  });

  it('reports every reference for moderation, including the unsafe ones', () => {
    const refs = markdownRefs(
      '[a](javascript:x) ![b](https://evil.example/b.png) <iframe>\n\n[r][x]\n\n[x]: https://bit.ly/a',
    );
    expect(refs.links.map((l) => l.url)).toEqual(['javascript:x', 'https://bit.ly/a']);
    expect(refs.images).toEqual(['https://evil.example/b.png']);
    expect(refs.html).toEqual(['<iframe>']);
  });
});
