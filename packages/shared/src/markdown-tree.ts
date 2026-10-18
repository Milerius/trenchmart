/**
 * The sanitized Markdown tree and the URL checks it relies on. No parser here, so the web can
 * render a tree parsed on the server without shipping micromark to the browser.
 */

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
