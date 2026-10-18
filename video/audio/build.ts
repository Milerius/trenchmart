// Builds the promo soundtrack: `npm run audio` (run `npm run tts` first for the voiceover).
// Writes stems to audio/build/ and two mastered mixes to public/audio/:
//   promo-full.flac      music + SFX + voiceover (music ducked under the voice)
//   promo-music-sfx.flac music + SFX
// Both are mastered to -14 LUFS integrated with a -1 dBTP ceiling.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS, PROMO_FRAMES } from '../src/timeline';
import { addInto, stereo, wav } from './dsp';
import { master, mixWithVo, renderVoBus } from './mix';
import { renderMusic } from './music';
import { renderSfx } from './sfx';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, 'build');
const PUBLIC = path.join(HERE, '..', 'public', 'audio');
const SECONDS = PROMO_FRAMES / FPS;

const main = () => {
  mkdirSync(BUILD, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });

  console.log('Rendering music…');
  const music = renderMusic();
  console.log('Rendering SFX…');
  const sfx = renderSfx();
  const script = JSON.parse(readFileSync(path.join(HERE, 'vo-lines.json'), 'utf8')) as {
    lines: { id: string; frame: number }[];
  };
  const vo = renderVoBus(
    script.lines.map((l) => ({ id: l.id, seconds: l.frame / FPS })),
    path.join(BUILD, 'vo'),
    SECONDS,
  );
  if (!vo)
    console.log('No voiceover found in audio/build/vo (run `npm run tts`); skipping the VO mix.');

  writeFileSync(path.join(BUILD, 'stem-music.wav'), wav(music));
  writeFileSync(path.join(BUILD, 'stem-sfx.wav'), wav(sfx));

  const musicSfx = stereo(SECONDS);
  addInto(musicSfx, music);
  addInto(musicSfx, sfx);
  writeFileSync(path.join(BUILD, 'premaster-music-sfx.wav'), wav(musicSfx));
  console.log('Mastering music + SFX…');
  const a = master(
    path.join(BUILD, 'premaster-music-sfx.wav'),
    path.join(PUBLIC, 'promo-music-sfx.flac'),
  );

  if (vo) {
    writeFileSync(path.join(BUILD, 'stem-vo.wav'), wav(vo));
    writeFileSync(path.join(BUILD, 'premaster-full.wav'), wav(mixWithVo(music, sfx, vo, SECONDS)));
    console.log('Mastering full mix…');
    const b = master(path.join(BUILD, 'premaster-full.wav'), path.join(PUBLIC, 'promo-full.flac'));
    console.log(`full: ${b.I} LUFS / ${b.TP} dBTP`);
  }
  console.log(`music+sfx: ${a.I} LUFS / ${a.TP} dBTP`);
};

main();
