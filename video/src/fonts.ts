import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

export const fontsReady = Promise.all([
  loadFont({
    family: 'Geist',
    url: staticFile('fonts/Geist-Variable.woff2'),
    weight: '100 900',
  }),
  loadFont({
    family: 'Geist Mono',
    url: staticFile('fonts/GeistMono-Variable.woff2'),
    weight: '100 900',
  }),
]);
