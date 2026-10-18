// Renders review stills: `npm run stills -- [compositionId] [frame...]`.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';

const [id = 'Promo-1x1', ...frameArgs] = process.argv.slice(2);
const frames = frameArgs.length ? frameArgs.map(Number) : [48, 100, 220, 345, 500, 632, 790];
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const inputProps = { audio: false };
const composition = await selectComposition({ serveUrl, id, inputProps });
for (const frame of frames) {
  const output = path.resolve(`out/stills/${id}-${String(frame).padStart(4, '0')}.png`);
  await renderStill({ serveUrl, composition, frame, output, inputProps });
  console.log(output);
}
