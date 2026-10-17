/**
 * Seller image validation. The type is decided from the bytes (never the file name or the
 * client's content-type), metadata segments that can carry EXIF, GPS or XMP are removed,
 * and anything after the image's end marker is dropped so a file cannot double as HTML or
 * a script (a polyglot). Pixels are not re-encoded: Workers have no image codec, and the
 * structural rewrite keeps the original quality.
 */

export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 8192;
export const IMAGE_MIN_SIDE = 16;
export const IMAGE_MAX_PIXELS = 40_000_000;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export type CleanImage = {
  mime: ImageMime;
  width: number;
  height: number;
  bytes: Uint8Array;
  /** Metadata blocks that were removed, for the review log. */
  stripped: string[];
};

export type ImageErrorCode =
  'IMAGE_TYPE' | 'IMAGE_TOO_LARGE' | 'IMAGE_CORRUPT' | 'IMAGE_DIMENSIONS';

export class ImageError extends Error {
  code: ImageErrorCode;
  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function cleanImage(input: Uint8Array): CleanImage {
  if (input.length > IMAGE_MAX_BYTES) {
    throw new ImageError('IMAGE_TOO_LARGE', 'images are limited to 3 MB');
  }
  const mime = sniffImage(input);
  if (!mime) {
    throw new ImageError('IMAGE_TYPE', 'only PNG, JPEG or WebP images are accepted');
  }
  const out =
    mime === 'image/png'
      ? cleanPng(input)
      : mime === 'image/jpeg'
        ? cleanJpeg(input)
        : cleanWebp(input);
  const { width, height } = out;
  if (
    width < IMAGE_MIN_SIDE ||
    height < IMAGE_MIN_SIDE ||
    width > IMAGE_MAX_SIDE ||
    height > IMAGE_MAX_SIDE ||
    width * height > IMAGE_MAX_PIXELS
  ) {
    throw new ImageError(
      'IMAGE_DIMENSIONS',
      `image must be between ${IMAGE_MIN_SIDE} and ${IMAGE_MAX_SIDE} px per side`,
    );
  }
  if (sniffImage(out.bytes) !== mime) throw new ImageError('IMAGE_CORRUPT', 'image rewrite failed');
  return { mime, ...out };
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = at; i < at + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  );
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) | bytes[at + 1]!;
}

function u32le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
  );
}

function u24le(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const corrupt = (what: string) => new ImageError('IMAGE_CORRUPT', `invalid ${what}`);

// ── PNG ──────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Chunks that describe pixels or colour. Text, EXIF, time and animation chunks are dropped. */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
]);

function cleanPng(bytes: Uint8Array) {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const stripped: string[] = [];
  let at = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  let first = true;
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    const end = at + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > bytes.length) throw corrupt('PNG chunk');
    const crc = u32be(bytes, end - 4);
    if (crc32(bytes.subarray(at + 4, end - 4)) !== crc) throw corrupt('PNG checksum');
    if (first) {
      if (type !== 'IHDR' || length !== 13) throw corrupt('PNG header');
      width = u32be(bytes, at + 8);
      height = u32be(bytes, at + 12);
      first = false;
    }
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(at, end));
    else stripped.push(type);
    at = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || first) throw corrupt('PNG (no IEND)');
  if (at < bytes.length) stripped.push(`trailing ${bytes.length - at} bytes`);
  return { width, height, bytes: concat(parts), stripped };
}

// ── JPEG ─────────────────────────────────────────────────────────────────────────────

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function keepJpegSegment(marker: number, bytes: Uint8Array, at: number): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker >= 0xe1 && marker <= 0xef) {
    // APP1 (EXIF/XMP) and the rest are metadata; keep only the ICC colour profile (APP2)
    // and Adobe's colour-transform flag (APP14), which change how pixels decode.
    if (marker === 0xe2) return ascii(bytes, at + 4, 11) === 'ICC_PROFILE';
    if (marker === 0xee) return ascii(bytes, at + 4, 5) === 'Adobe';
    return false;
  }
  return true;
}

function cleanJpeg(bytes: Uint8Array) {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const stripped: string[] = [];
  let at = 2;
  let width = 0;
  let height = 0;
  let inScan = false;
  let scanStart = 0;
  let ended = false;
  while (at < bytes.length) {
    if (inScan) {
      // Entropy-coded data: copy until the next real marker. FF00 is a stuffed byte,
      // FFD0-FFD7 are restart markers and FFFF is fill; all stay inside the scan.
      if (bytes[at] !== 0xff) {
        at++;
        continue;
      }
      const next = bytes[at + 1];
      if (next === undefined) throw corrupt('JPEG (truncated scan)');
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
        at += next === 0xff ? 1 : 2;
        continue;
      }
      parts.push(bytes.subarray(scanStart, at));
      inScan = false;
      continue;
    }
    if (bytes[at] !== 0xff) throw corrupt('JPEG marker');
    let marker = bytes[at + 1];
    while (marker === 0xff) {
      at++;
      marker = bytes[at + 1];
    }
    if (marker === undefined) throw corrupt('JPEG (truncated)');
    if (marker === 0xd9) {
      parts.push(bytes.subarray(at, at + 2));
      at += 2;
      ended = true;
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) throw corrupt('JPEG segment');
    const length = u16be(bytes, at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) throw corrupt('JPEG segment length');
    if (SOF.has(marker)) {
      if (length < 8) throw corrupt('JPEG frame header');
      height = u16be(bytes, at + 5);
      width = u16be(bytes, at + 7);
    }
    if (keepJpegSegment(marker, bytes, at)) parts.push(bytes.subarray(at, end));
    else stripped.push(marker === 0xfe ? 'COM' : `APP${marker - 0xe0}`);
    at = end;
    if (marker === 0xda) {
      inScan = true;
      scanStart = at;
    }
  }
  if (!ended) throw corrupt('JPEG (no end marker)');
  if (!width || !height) throw corrupt('JPEG (no frame header)');
  if (at < bytes.length) stripped.push(`trailing ${bytes.length - at} bytes`);
  return { width, height, bytes: concat(parts), stripped };
}

// ── WebP ─────────────────────────────────────────────────────────────────────────────

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function cleanWebp(bytes: Uint8Array) {
  const riffEnd = 8 + u32le(bytes, 4);
  if (riffEnd > bytes.length || riffEnd < 12) throw corrupt('WebP size');
  const chunks: Uint8Array[] = [];
  const stripped: string[] = [];
  let width = 0;
  let height = 0;
  let at = 12;
  while (at + 8 <= riffEnd) {
    const type = ascii(bytes, at, 4);
    const size = u32le(bytes, at + 4);
    const end = at + 8 + size + (size % 2);
    if (end > riffEnd) throw corrupt('WebP chunk');
    const data = bytes.subarray(at + 8, at + 8 + size);
    if (type === 'VP8X') {
      if (size < 10) throw corrupt('WebP VP8X');
      width = u24le(data, 4) + 1;
      height = u24le(data, 7) + 1;
      const copy = bytes.slice(at, end);
      copy[8] = copy[8]! & ~0x0c; // clear the EXIF (0x08) and XMP (0x04) flags
      chunks.push(copy);
    } else if (WEBP_KEEP.has(type)) {
      if (type === 'VP8 ' && !width) {
        if (size < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
          throw corrupt('WebP VP8 frame');
        }
        width = (data[6]! | (data[7]! << 8)) & 0x3fff;
        height = (data[8]! | (data[9]! << 8)) & 0x3fff;
      }
      if (type === 'VP8L' && !width) {
        if (size < 5 || data[0] !== 0x2f) throw corrupt('WebP VP8L');
        const bits = u32le(data, 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      chunks.push(bytes.subarray(at, end));
    } else {
      stripped.push(type.trim());
    }
    at = end;
  }
  if (!width || !height) throw corrupt('WebP (no image data)');
  if (riffEnd < bytes.length) stripped.push(`trailing ${bytes.length - riffEnd} bytes`);
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 4), 0);
  const size = body.length + 4;
  header.set([size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff], 4);
  header.set(bytes.subarray(8, 12), 8);
  return { width, height, bytes: concat([header, body]), stripped };
}

export function extensionOf(mime: ImageMime): string {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
}
