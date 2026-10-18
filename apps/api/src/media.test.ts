import { describe, expect, it } from 'vitest';
import { mediaResponse, mediaVariantKey, uploadImageVariant } from './content';
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
  it('keys copies by the image row (shared R2 objects never share copies)', () => {
    expect(mediaVariantKey(ID, 480)).toBe(`media/copies/${ID}/w480.webp`);
  });

  it('serves the narrower copy when it exists, with its own etag', async () => {
    const deps = depsWith({
      [KEY]: new Uint8Array(100),
      [`media/copies/${ID}/w480.webp`]: new Uint8Array(10),
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

/** A header-only lossless WebP (VP8L) of the given size: enough for the upload checks. */
function vp8l(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  const payload = [
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    (bits >>> 24) & 0xff,
    0,
    0,
    0,
  ];
  const out = new Uint8Array(20 + payload.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, out.length - 8, true);
  out.set(new TextEncoder().encode('WEBPVP8L'), 8);
  view.setUint32(16, payload.length, true);
  out.set(payload, 20);
  return out;
}

describe('browser-made image copies at upload', () => {
  function variantDeps(opts: { live?: boolean; exists?: boolean } = {}) {
    const stored = new Map<string, Uint8Array>();
    if (opts.exists) stored.set(`media/copies/${ID}/w480.webp`, new Uint8Array(1));
    const row = {
      id: ID,
      r2_key: KEY,
      width: 1600,
      height: 1000,
      live: { mediaIds: opts.live ? [ID] : [] },
    };
    const deps = {
      sql: (async () => [row]) as unknown as Deps['sql'],
      blob: {
        get: async (key: string) => stored.get(key) ?? null,
        put: async (key: string, bytes: Uint8Array) => void stored.set(key, bytes),
      } as unknown as Deps['blob'],
    } as Deps;
    return { deps, stored };
  }

  it('stores a copy of the right width and aspect ratio next to the original', async () => {
    const { deps, stored } = variantDeps();
    expect(await uploadImageVariant(deps, 'L', ID, 480, vp8l(480, 300))).toEqual({
      width: 480,
      stored: true,
    });
    expect(await uploadImageVariant(deps, 'L', ID, 1200, vp8l(1200, 750))).toEqual({
      width: 1200,
      stored: true,
    });
    expect([...stored.keys()]).toEqual([
      `media/copies/${ID}/w480.webp`,
      `media/copies/${ID}/w1200.webp`,
    ]);
  });

  it('refuses other widths, wrong sizes, non-WebP and live images, and never replaces a copy', async () => {
    const { deps } = variantDeps();
    await expect(uploadImageVariant(deps, 'L', ID, 500, vp8l(500, 312))).rejects.toMatchObject({
      code: 'BAD_WIDTH',
    });
    await expect(uploadImageVariant(deps, 'L', ID, 480, vp8l(480, 480))).rejects.toMatchObject({
      code: 'IMAGE_DIMENSIONS',
    });
    await expect(uploadImageVariant(deps, 'L', ID, 960, vp8l(480, 300))).rejects.toMatchObject({
      code: 'IMAGE_DIMENSIONS',
    });
    await expect(
      uploadImageVariant(deps, 'L', ID, 480, new TextEncoder().encode('<svg onload=alert(1)>')),
    ).rejects.toMatchObject({ code: 'IMAGE_TYPE' });
    await expect(
      uploadImageVariant(variantDeps({ live: true }).deps, 'L', ID, 480, vp8l(480, 300)),
    ).rejects.toMatchObject({ code: 'IMAGE_LIVE' });
    const kept = variantDeps({ exists: true });
    expect(await uploadImageVariant(kept.deps, 'L', ID, 480, vp8l(480, 300))).toEqual({
      width: 480,
      stored: false,
    });
    expect(kept.stored.get(`media/copies/${ID}/w480.webp`)).toHaveLength(1);
  });
});
