import type { Nodes, Root, RootContent, PhrasingContent, Definition } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

/**
 * Listing Markdown (README, How to use, requirements) is parsed to a small, already
 * sanitized tree. The web renders that tree as React elements: no HTML string is ever
 * injected, raw HTML in the source is shown as text, links are limited to http(s),
 * mailto and same-site paths, and images only load from our own media route.
 */

export const MARKDOWN_MAX_CHARS = 60_000;
const MAX_DEPTH = 12;

export type SafeInline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: SafeInline[] }
  | { t: 'link'; href: string; external: boolean; c: SafeInline[] }
  | { t: 'img'; src: string; alt: string }
  | { t: 'img-blocked'; alt: string; host: string }
  | { t: 'br' };

export type SafeBlock =
  | { t: 'h'; depth: 1 | 2 | 3 | 4 | 5 | 6; c: SafeInline[] }
  | { t: 'p'; c: SafeInline[] }
  | {
      t: 'list';
      ordered: boolean;
      start: number;
      items: { checked: boolean | null; c: SafeBlock[] }[];
    }
  | { t: 'pre'; lang: string; v: string }
  | { t: 'quote'; c: SafeBlock[] }
  | { t: 'hr' }
  | {
      t: 'table';
      align: ('left' | 'right' | 'center' | null)[];
      head: SafeInline[][];
      rows: SafeInline[][][];
    };

const SITE = 'https://trenchmart.fun';
const MEDIA_PATH =
  /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_HOSTS = new Set(['trenchmart.fun', 'api.trenchmart.fun']);

/** Our media route (seller uploads served from R2), relative or on our own hosts only. */
export function isMediaUrl(src: string): boolean {
  const value = src.trim();
  if (MEDIA_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      MEDIA_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      MEDIA_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function mediaIdOf(src: string): string | null {
  if (!isMediaUrl(src)) return null;
  const match = /([0-9a-f-]{36})$/i.exec(src.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** A link target that is safe to put in href, or null. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  // Browsers ignore tabs, newlines and leading control characters inside a scheme
  // ("java\tscript:"); strip them before deciding.
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u0020\u007f-\u009f]+/g, '');
  if (!value) return null;
  if (value.startsWith('#')) return { href: value, external: false };
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) {
    return { href: value, external: false };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'mailto:') return { href: url.href, external: true };
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null; // https://phantom.app@evil.example
  const internal = url.origin === SITE;
  return { href: url.href, external: !internal };
}

function parse(md: string): Root {
  return fromMarkdown(md.slice(0, MARKDOWN_MAX_CHARS), {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

function plain(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) return (node.children as Nodes[]).map(plain).join('');
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  return '';
}

function hostOf(src: string): string {
  try {
    return new URL(src).hostname;
  } catch {
    return src.slice(0, 60);
  }
}

type Defs = Map<string, Definition>;

function inlines(nodes: PhrasingContent[], defs: Defs, depth: number): SafeInline[] {
  const out: SafeInline[] = [];
  for (const node of nodes) out.push(...inline(node, defs, depth + 1));
  return out;
}

function linkOf(url: string, children: SafeInline[]): SafeInline[] {
  const safe = safeHref(url);
  if (!safe) return children; // unsafe scheme: keep the words, drop the link
  return [{ t: 'link', href: safe.href, external: safe.external, c: children }];
}

function imageOf(url: string, alt: string): SafeInline {
  if (isMediaUrl(url)) return { t: 'img', src: url.trim(), alt };
  return { t: 'img-blocked', alt, host: hostOf(url) };
}

function inline(node: PhrasingContent, defs: Defs, depth: number): SafeInline[] {
  if (depth > MAX_DEPTH) return [{ t: 'text', v: plain(node) }];
  switch (node.type) {
    case 'text':
      return [{ t: 'text', v: node.value }];
    case 'inlineCode':
      return [{ t: 'code', v: node.value }];
    case 'html':
      return [{ t: 'text', v: node.value }];
    case 'break':
      return [{ t: 'br' }];
    case 'strong':
      return [{ t: 'strong', c: inlines(node.children, defs, depth) }];
    case 'emphasis':
      return [{ t: 'em', c: inlines(node.children, defs, depth) }];
    case 'delete':
      return [{ t: 'del', c: inlines(node.children, defs, depth) }];
    case 'link':
      return linkOf(node.url, inlines(node.children, defs, depth));
    case 'linkReference': {
      const def = defs.get(node.identifier);
      const children = inlines(node.children, defs, depth);
      return def ? linkOf(def.url, children) : [{ t: 'text', v: plain(node) }];
    }
    case 'image':
      return [imageOf(node.url, node.alt ?? '')];
    case 'imageReference': {
      const def = defs.get(node.identifier);
      return def ? [imageOf(def.url, node.alt ?? '')] : [{ t: 'text', v: node.alt ?? '' }];
    }
    default:
      return [{ t: 'text', v: plain(node as Nodes) }];
  }
}

function blocks(nodes: RootContent[], defs: Defs, depth: number): SafeBlock[] {
  const out: SafeBlock[] = [];
  for (const node of nodes) {
    const block = blockOf(node, defs, depth + 1);
    if (block) out.push(block);
  }
  return out;
}

function blockOf(node: RootContent, defs: Defs, depth: number): SafeBlock | null {
  if (depth > MAX_DEPTH) return { t: 'p', c: [{ t: 'text', v: plain(node) }] };
  switch (node.type) {
    case 'heading':
      return { t: 'h', depth: node.depth, c: inlines(node.children, defs, depth) };
    case 'paragraph':
      return { t: 'p', c: inlines(node.children, defs, depth) };
    case 'list':
      return {
        t: 'list',
        ordered: Boolean(node.ordered),
        start: node.start ?? 1,
        items: node.children.map((item) => ({
          checked: typeof item.checked === 'boolean' ? item.checked : null,
          c: blocks(item.children, defs, depth),
        })),
      };
    case 'code':
      return {
        t: 'pre',
        lang: (node.lang ?? '').replace(/[^\w+-]/g, '').slice(0, 20),
        v: node.value,
      };
    case 'blockquote':
      return { t: 'quote', c: blocks(node.children, defs, depth) };
    case 'thematicBreak':
      return { t: 'hr' };
    case 'html':
      // Raw HTML is never rendered. Show it as text so the reader sees what was written.
      return { t: 'pre', lang: 'html', v: node.value };
    case 'table': {
      const [head, ...rows] = node.children;
      const cells = (row: (typeof node.children)[number]) =>
        row.children.map((cell) => inlines(cell.children, defs, depth));
      return {
        t: 'table',
        align: (node.align ?? []).map((a) => a ?? null),
        head: head ? cells(head) : [],
        rows: rows.map(cells),
      };
    }
    case 'definition':
      return null;
    default: {
      const text = plain(node as Nodes);
      return text ? { t: 'p', c: [{ t: 'text', v: text }] } : null;
    }
  }
}

function definitions(root: Root): Defs {
  const defs: Defs = new Map();
  const walk = (node: Nodes) => {
    if (node.type === 'definition' && !defs.has(node.identifier)) defs.set(node.identifier, node);
    if ('children' in node) for (const child of node.children as Nodes[]) walk(child);
  };
  walk(root);
  return defs;
}

/** Parse listing Markdown into a sanitized block tree. */
export function safeMarkdown(md: string): SafeBlock[] {
  const root = parse(md);
  return blocks(root.children, definitions(root), 0);
}

export type MarkdownRefs = {
  links: { url: string; text: string }[];
  images: string[];
  html: string[];
};

/** Every link, image and raw HTML fragment in the source, before sanitizing, for moderation. */
export function markdownRefs(md: string): MarkdownRefs {
  const root = parse(md);
  const defs = definitions(root);
  const refs: MarkdownRefs = { links: [], images: [], html: [] };
  const walk = (node: Nodes) => {
    if (node.type === 'link') refs.links.push({ url: node.url, text: plain(node) });
    if (node.type === 'linkReference') {
      const def = defs.get(node.identifier);
      if (def) refs.links.push({ url: def.url, text: plain(node) });
    }
    if (node.type === 'image') refs.images.push(node.url);
    if (node.type === 'imageReference') {
      const def = defs.get(node.identifier);
      if (def) refs.images.push(def.url);
    }
    if (node.type === 'html') refs.html.push(node.value);
    if ('children' in node) for (const child of node.children as Nodes[]) walk(child);
  };
  walk(root);
  return refs;
}

/** Plain text of the Markdown (for search snippets and phishing heuristics). */
export function markdownText(md: string): string {
  const BLOCKS = new Set([
    'root',
    'list',
    'listItem',
    'blockquote',
    'table',
    'tableRow',
    'footnoteDefinition',
  ]);
  const text = (node: Nodes): string =>
    BLOCKS.has(node.type) && 'children' in node
      ? (node.children as Nodes[]).map(text).join('\n')
      : plain(node);
  return text(parse(md));
}
