// Renders the launch videos: `npm run render:launch -- [Id...]` (default: all), both formats each,
// to out/launch/trenchmart-<id>-1920x1080.mp4 and -1080x1920.mp4.
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import { LAUNCH_VIDEOS } from '../src/launch';

const ids = process.argv.slice(2);
const videos = ids.length ? LAUNCH_VIDEOS.filter((v) => ids.includes(v.id)) : LAUNCH_VIDEOS;
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const inputProps = { audio: true };

for (const v of videos) {
  for (const [suffix, size] of [
    ['16x9', '1920x1080'],
    ['9x16', '1080x1920'],
  ]) {
    const id = `Launch-${v.id}-${suffix}`;
    const composition = await selectComposition({ serveUrl, id, inputProps });
    const outputLocation = path.resolve(`out/launch/trenchmart-${v.id.toLowerCase()}-${size}.mp4`);
    const started = Date.now();
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      outputLocation,
      codec: 'h264',
      pixelFormat: 'yuv420p',
      crf: 18,
      x264Preset: 'slow',
      imageFormat: 'jpeg',
      jpegQuality: 95,
      audioCodec: 'aac',
      audioBitrate: '192k',
    });
    console.log(`${outputLocation} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
}
