import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cleanImage, crc32, IMAGE_MAX_BYTES, ImageError, sniffImage } from './image';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(width: number, height: number, extra: Uint8Array[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array((width * 3 + 1) * height);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImageError);
    expect((err as ImageError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('seller image validation', () => {
  it('decides the type from the bytes', () => {
    expect(sniffImage(fixture('exif.jpg'))).toBe('image/jpeg');
    expect(sniffImage(fixture('meta.png'))).toBe('image/png');
    expect(sniffImage(fixture('exif.webp'))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('GIF89a....'))).toBeNull();
  });

  it('rejects SVG, HTML and GIF whatever they claim to be', () => {
    for (const body of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<!doctype html><script>alert(1)</script>',
      'GIF89a\x01\x00\x01\x00',
    ]) {
      expectError(() => cleanImage(new TextEncoder().encode(body)), 'IMAGE_TYPE');
    }
  });

  it('strips EXIF, GPS and comments from JPEG, keeping the pixels', () => {
    for (const name of ['exif.jpg', 'progressive.jpg']) {
      const input = fixture(name);
      expect(text(input)).toMatch(/LEAK|SecretCam/);
      const out = cleanImage(input);
      expect(out.mime).toBe('image/jpeg');
      expect([out.width, out.height]).toEqual([64, 48]);
      expect(text(out.bytes)).not.toMatch(/LEAK|SecretCam|Exif/);
      expect(out.stripped).toContain('APP1');
      expect(out.bytes.at(-2)).toBe(0xff);
      expect(out.bytes.at(-1)).toBe(0xd9);
    }
  });

  it('strips text and EXIF chunks from PNG', () => {
    const out = cleanImage(fixture('meta.png'));
    expect(out.mime).toBe('image/png');
    expect([out.width, out.height]).toEqual([64, 48]);
    expect(text(out.bytes)).not.toMatch(/LEAK|SecretCam|tEXt|eXIf/);
    expect(out.stripped).toEqual(expect.arrayContaining(['tEXt']));
  });

  it('strips EXIF from WebP and clears the VP8X flags', () => {
    const out = cleanImage(fixture('exif.webp'));
    expect(out.mime).toBe('image/webp');
    expect([out.width, out.height]).toEqual([64, 48]);
    expect(text(out.bytes)).not.toMatch(/LEAK|SecretCam|EXIF/);
    expect(new DataView(out.bytes.buffer, out.bytes.byteOffset).getUint32(4, true)).toBe(
      out.bytes.length - 8,
    );
    expect(cleanImage(fixture('lossless.webp')).width).toBe(64);
  });

  it('drops a script appended after the image end (polyglot)', () => {
    const payload = new TextEncoder().encode('<script>alert(document.cookie)</script>');
    for (const base of [fixture('exif.jpg'), png(32, 32)]) {
      const out = cleanImage(Buffer.concat([base, payload]));
      expect(text(out.bytes)).not.toContain('<script>');
      expect(out.stripped.some((item) => item.startsWith('trailing'))).toBe(true);
    }
    const webp = fixture('lossless.webp');
    const out = cleanImage(Buffer.concat([webp, payload]));
    expect(text(out.bytes)).not.toContain('<script>');
  });

  it('drops a script hidden in a PNG text chunk', () => {
    const evil = chunk('tEXt', new TextEncoder().encode('Comment\0<script>alert(1)</script>'));
    const out = cleanImage(png(32, 32, [evil]));
    expect(text(out.bytes)).not.toContain('<script>');
  });

  it('rejects corrupt, oversized and out-of-range images', () => {
    const bad = png(32, 32);
    bad[bad.length - 20] = (bad[bad.length - 20] ?? 0) ^ 0xff; // breaks the IDAT checksum
    expectError(() => cleanImage(bad), 'IMAGE_CORRUPT');
    expectError(() => cleanImage(fixture('exif.jpg').subarray(0, 200)), 'IMAGE_CORRUPT');
    expectError(() => cleanImage(png(32, 32).subarray(0, 40)), 'IMAGE_CORRUPT');
    expectError(() => cleanImage(png(8, 8)), 'IMAGE_DIMENSIONS');
    expectError(() => cleanImage(png(9000, 16)), 'IMAGE_DIMENSIONS');
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(png(32, 32));
    expectError(() => cleanImage(big), 'IMAGE_TOO_LARGE');
  });
});
