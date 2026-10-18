/**
 * Backfill for the narrower listing-image copies the API serves for `?w=480|960|1200` (content.ts
 * MEDIA_WIDTHS). Uploads are stored once at up to 1600 px; phones and cards need far less.
 * New uploads get them from the seller's browser (webp.ts uploadCopies); this covers older
 * images. Re-encoding in the Worker costs too much CPU, so it runs offline; safe to rerun.
 *
 *   echo '<image id> media/<sha>.webp' | tsx scripts/media-variants.ts   # one row per line
 *
 * Reads and writes R2 through `wrangler r2 object get/put --remote` (WRANGLER, R2_BUCKET).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import decodeWebp, { init as initWebpDec } from '@jsquash/webp/decode';
import decodePng, { init as initPng } from '@jsquash/png/decode';
import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode';
import encodeWebp, { init as initWebpEnc } from '@jsquash/webp/encode';
import resize, { initResize } from '@jsquash/resize';
import { MEDIA_WIDTHS, mediaVariantKey } from '../src/content';
import { WEBP_QUALITY } from '../src/image-optimize';

const require = createRequire(import.meta.url);
const wasm = (path: string) => new WebAssembly.Module(readFileSync(require.resolve(path)));
const bucket = process.env.R2_BUCKET ?? 'trenchmart-files';
const wrangler = (process.env.WRANGLER ?? 'npx -y wrangler@4').split(' ');
const run = (args: string[]) =>
  execFileSync(wrangler[0]!, [...wrangler.slice(1), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

await Promise.all([
  initWebpDec(wasm('@jsquash/webp/codec/dec/webp_dec.wasm') as never),
  initWebpEnc(wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm') as never),
  initPng(wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm') as never),
  initJpeg(wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm') as never),
  initResize(wasm('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm') as never),
]);

const dir = mkdtempSync(join(tmpdir(), 'tm-variants-'));
const rows = readFileSync(0, 'utf8')
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .filter((parts): parts is [string, string] => parts.length === 2);
for (const [id, key] of rows) {
  const src = join(dir, 'src');
  run(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', src]);
  const bytes = readFileSync(src);
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const image = key.endsWith('.png')
    ? await decodePng(buf)
    : key.endsWith('.jpg') || key.endsWith('.jpeg')
      ? await decodeJpeg(buf)
      : await decodeWebp(buf);
  for (const width of MEDIA_WIDTHS) {
    if (image.width <= width) continue; // the original is already this small
    const height = Math.max(1, Math.round((image.height * width) / image.width));
    const out = new Uint8Array(
      await encodeWebp(await resize(image, { width, height }), { quality: WEBP_QUALITY }),
    );
    const file = join(dir, `w${width}.webp`);
    writeFileSync(file, out);
    const target = mediaVariantKey(id, width);
    run([
      'r2',
      'object',
      'put',
      `${bucket}/${target}`,
      '--remote',
      '--file',
      file,
      '--content-type',
      'image/webp',
    ]);
    console.log(
      `${target}  ${width}x${height}  ${Math.round(out.length / 1024)} KB (from ${Math.round(bytes.length / 1024)} KB)`,
    );
  }
}
