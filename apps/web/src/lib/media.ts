/**
 * Responsive listing images. The API stores each upload at up to 1600 px and narrower WebP
 * copies for `?w=480`, `?w=960` and `?w=1200` (apps/api content.ts MEDIA_WIDTHS); a width without a copy
 * redirects to the original, so these URLs are always valid.
 */
const MEDIA = /^\/api\/v1\/media\/[0-9a-f-]{36}$/i;

/** Cards: one column on phones, two from 640 px, three from 1024 px (container max ~1200 px). */
export const CARD_SIZES = '(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw';
/** The listing page's main image spans the content column. */
export const HERO_SIZES = '(min-width: 1024px) 800px, 100vw';

export function mediaSrcSet(url: string): string | undefined {
  if (!MEDIA.test(url)) return undefined;
  return `${url}?w=480 480w, ${url}?w=960 960w, ${url}?w=1200 1200w, ${url} 1600w`;
}

/** A small copy for thumbnails (strip, lightbox rail). */
export function mediaThumb(url: string): string {
  return MEDIA.test(url) ? `${url}?w=480` : url;
}
