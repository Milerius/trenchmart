import { describe, expect, it } from 'vitest';
import { mediaResponse, mediaVariantKey } from './content';
import type { Deps } from './logic';

const ID = 'a3f1c2d4-1111-4222-8333-444455556666';
const KEY = 'media/abc.webp';

function depsWith(objects: Record<string, Uint8Array>, isPublic = true): Deps {
  const row = {
    id: ID,
    r2_key: KEY,
    mime: 'image/webp',
    sha256: 'abc',
    creator_id: 'owner',
    live: { mediaIds: isPublic ? [ID] : [] },
  };
  return {
    sql: (async () => [row]) as unknown as Deps['sql'],
    blob: { get: async (key: string) => objects[key] ?? null } as unknown as Deps['blob'],
  } as Deps;
}

describe('listing image widths (?w=)', () => {
  it('names a variant next to the original', () => {
    expect(mediaVariantKey(KEY, 480)).toBe('media/abc@w480.webp');
    expect(mediaVariantKey('media/x.png', 960)).toBe('media/x@w960.webp');
  });

  it('serves the narrower copy when it exists, with its own etag', async () => {
    const deps = depsWith({
      [KEY]: new Uint8Array(100),
      'media/abc@w480.webp': new Uint8Array(10),
    });
    const res = await mediaResponse(deps, ID, null, 480);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('10');
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('etag')).toBe('"abc-w480"');
  });

  it('redirects to the original when the copy is missing (never caches it under ?w=)', async () => {
    const res = await mediaResponse(depsWith({ [KEY]: new Uint8Array(100) }), ID, null, 960);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(ID);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('ignores widths it does not make, and keeps drafts private', async () => {
    const res = await mediaResponse(depsWith({ [KEY]: new Uint8Array(100) }), ID, null, 333);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('100');
    const draft = await mediaResponse(depsWith({ [KEY]: new Uint8Array(1) }, false), ID, null, 480);
    expect(draft.status).toBe(404);
  });
});
