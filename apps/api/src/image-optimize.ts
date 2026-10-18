import decodePng, { init as initPng } from '@jsquash/png/decode';
import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode';
import encodeWebp, { init as initWebp } from '@jsquash/webp/encode';
import resize, { initResize } from '@jsquash/resize';

/**
 * Listing images are re-encoded at upload time to WebP and capped at MAX_WIDTH (Lighthouse:
 * a 354 KB PNG cover made LCP 7.1 s). Runs in the Worker with WebAssembly codecs, so no
 * Cloudflare Images permission is needed. Only used when it makes the file smaller.
 */
export const MAX_WIDTH = 1600;
export const WEBP_QUALITY = 80;

/** A compiled WebAssembly.Module (typed loosely: the API tsconfig has no DOM/wasm lib). */
type WasmModule = object;
type Pixels = Awaited<ReturnType<typeof decodeJpeg>>;

export type CodecModules = {
  png: WasmModule;
  jpeg: WasmModule;
  /** The SIMD build of the WebP encoder (workerd and Node both support Wasm SIMD). */
  webpEncode: WasmModule;
  resize: WasmModule;
};

export type OptimizedImage = {
  bytes: Uint8Array;
  mime: 'image/webp';
  width: number;
  height: number;
};
export type ImageOptimizer = (bytes: Uint8Array, mime: string) => Promise<OptimizedImage | null>;

export function createImageOptimizer(
  load: () => CodecModules | Promise<CodecModules>,
): ImageOptimizer {
  let ready: Promise<void> | null = null;
  const init = () =>
    (ready ??= (async () => {
      const m = await load();
      await Promise.all([
        initPng(m.png as never),
        initJpeg(m.jpeg as never),
        initWebp(m.webpEncode as never),
        initResize(m.resize as never),
      ]);
    })());
  return async (bytes, mime) => {
    if (mime !== 'image/png' && mime !== 'image/jpeg') return null;
    await init();
    const buffer = bytes.slice().buffer as ArrayBuffer;
    let image: Pixels = mime === 'image/png' ? await decodePng(buffer) : await decodeJpeg(buffer);
    if (image.width > MAX_WIDTH) {
      const height = Math.max(1, Math.round((image.height * MAX_WIDTH) / image.width));
      image = await resize(image, { width: MAX_WIDTH, height });
    }
    const out = new Uint8Array(await encodeWebp(image, { quality: WEBP_QUALITY }));
    if (out.length >= bytes.length) return null;
    return { bytes: out, mime: 'image/webp', width: image.width, height: image.height };
  };
}
