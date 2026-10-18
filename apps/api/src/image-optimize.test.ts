import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode';
import { cleanImage } from '@trenchmart/scanner';
import { createImageOptimizer, MAX_WIDTH } from './image-optimize';

const require = createRequire(import.meta.url);
const wasm = (path: string): object =>
  new (
    globalThis as unknown as { WebAssembly: { Module: new (b: Uint8Array) => object } }
  ).WebAssembly.Module(readFileSync(require.resolve(path)));
const modules = () => ({
  png: wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
  jpeg: wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
  webpEncode: wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm'),
  resize: wasm('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'),
});

async function noisyPng(width: number, height: number): Promise<Uint8Array> {
  await initPngEncode(modules().png as never);
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const px = i / 4;
    data[i] = (px % width) & 0xff;
    data[i + 1] = (seed >> 8) & 0x3f;
    data[i + 2] = Math.floor(px / width) & 0xff;
    data[i + 3] = 255;
  }
  return new Uint8Array(await encodePng({ data, width, height, colorSpace: 'srgb' } as never));
}

describe('upload-time WebP optimizer', () => {
  const optimize = createImageOptimizer(modules);

  it('turns a large PNG cover into a smaller WebP, capped at MAX_WIDTH, that still passes the image checks', async () => {
    const png = await noisyPng(2000, 1000);
    const out = await optimize(png, 'image/png');
    expect(out).not.toBeNull();
    expect(out!.mime).toBe('image/webp');
    expect(out!.width).toBe(MAX_WIDTH);
    expect(out!.height).toBe(800);
    expect(out!.bytes.length).toBeLessThan(png.length / 2);
    const clean = cleanImage(out!.bytes);
    expect(clean.mime).toBe('image/webp');
    expect([clean.width, clean.height]).toEqual([MAX_WIDTH, 800]);
  });

  it('leaves WebP and GIF-like inputs alone', async () => {
    expect(await optimize(new Uint8Array([1, 2, 3]), 'image/webp')).toBeNull();
  });
});
