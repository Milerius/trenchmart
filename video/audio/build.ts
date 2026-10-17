// Builds the promo soundtrack: `npm run audio` (run `npm run tts` first for the voiceover).
// Writes stems to audio/build/ and two mastered mixes to public/audio/:
//   promo-full.flac      music + SFX + voiceover (music ducked under the voice)
//   promo-music-sfx.flac music + SFX
// Both are mastered to -14 LUFS integrated with a -1 dBTP ceiling.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS, PROMO_FRAMES } from '../src/timeline';
import { addInto, Biquad, filter, place, SR, Stereo, stereo, wav } from './dsp';
import { renderMusic } from './music';
import { renderSfx } from './sfx';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, 'build');
const PUBLIC = path.join(HERE, '..', 'public', 'audio');
const TARGET_LUFS = -14;
const CEILING_DBTP = -1;

const readMono48k = (file: string): Float32Array => {
  const raw = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-f',
    'f32le',
    '-ac',
    '1',
    '-ar',
    String(SR),
    '-',
  ]);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
};

const rms = (x: Float32Array, gate = 0) => {
  let s = 0;
  let n = 0;
  for (const v of x) {
    if (Math.abs(v) < gate) continue;
    s += v * v;
    n++;
  }
  return Math.sqrt(s / Math.max(1, n));
};

const renderVo = (): Stereo | null => {
  const script = JSON.parse(readFileSync(path.join(HERE, 'vo-lines.json'), 'utf8')) as {
    lines: { id: string; frame: number }[];
  };
  const files = script.lines.map((l) => path.join(BUILD, 'vo', `${l.id}.wav`));
  if (!files.every(existsSync)) return null;
  const bus = stereo(PROMO_FRAMES / FPS);
  script.lines.forEach((l, i) => {
    const x = readMono48k(files[i]);
    filter(x, new Biquad('hp', 90));
    filter(x, new Biquad('peak', 3200, 0.9, 2.5));
    filter(x, new Biquad('peak', 250, 1, -1.5));
    place(bus, x, l.frame / FPS, 1, 0);
  });
  return bus;
};

/** Gain curve that dips the music by up to `depthDb` while the voice is talking. */
const duckCurve = (vo: Stereo, depthDb = 7): Float32Array => {
  const g = new Float32Array(vo.L.length);
  const att = Math.exp(-1 / (0.012 * SR));
  const rel = Math.exp(-1 / (0.35 * SR));
  const depth = 1 - 10 ** (-depthDb / 20);
  let env = 0;
  for (let i = 0; i < g.length; i++) {
    const x = Math.abs(vo.L[i]);
    env = x > env ? att * env + (1 - att) * x : rel * env + (1 - rel) * x;
    g[i] = 1 - depth * Math.min(1, env / 0.04);
  }
  return g;
};

const measure = (file: string) => {
  const log = execFileSync('bash', [
    '-c',
    `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1 | tail -14`,
  ]).toString();
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log)?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(log)?.[1]);
  return { I, TP };
};

/** Gain to the target loudness, then a true-peak-safe limiter; repeated until within 0.2 LU. */
const master = (premaster: string, out: string) => {
  let gain = 0;
  for (let pass = 0; pass < 4; pass++) {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      premaster,
      '-af',
      `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${10 ** ((CEILING_DBTP - 0.3) / 20)}:attack=1:release=60:level=false,aresample=${SR}`,
      '-c:a',
      'flac',
      '-sample_fmt',
      's32',
      '-bits_per_raw_sample',
      '24',
      out,
    ]);
    const { I, TP } = measure(out);
    console.log(`  ${path.basename(out)} pass ${pass + 1}: ${I} LUFS, ${TP} dBTP`);
    if (Math.abs(I - TARGET_LUFS) <= 0.2) return { I, TP };
    gain += TARGET_LUFS - I;
  }
  return measure(out);
};

const main = () => {
  mkdirSync(BUILD, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });

  console.log('Rendering music…');
  const music = renderMusic();
  console.log('Rendering SFX…');
  const sfx = renderSfx();
  const vo = renderVo();
  if (!vo)
    console.log('No voiceover found in audio/build/vo (run `npm run tts`); skipping the VO mix.');

  writeFileSync(path.join(BUILD, 'stem-music.wav'), wav(music));
  writeFileSync(path.join(BUILD, 'stem-sfx.wav'), wav(sfx));

  const musicSfx = stereo(PROMO_FRAMES / FPS);
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
    const duck = duckCurve(vo);
    const ducked = stereo(PROMO_FRAMES / FPS);
    for (let i = 0; i < ducked.L.length; i++) {
      ducked.L[i] = music.L[i] * duck[i];
      ducked.R[i] = music.R[i] * duck[i];
    }
    // Sit the voice ~7 dB above the ducked bed, measured on active speech only.
    const voGain = (rms(ducked.L) * 10 ** (7 / 20)) / rms(vo.L, 0.01);
    const full = stereo(PROMO_FRAMES / FPS);
    addInto(full, ducked);
    addInto(full, sfx, 0.85);
    addInto(full, vo, voGain);
    writeFileSync(path.join(BUILD, 'premaster-full.wav'), wav(full));
    console.log('Mastering full mix…');
    const b = master(path.join(BUILD, 'premaster-full.wav'), path.join(PUBLIC, 'promo-full.flac'));
    console.log(`full: ${b.I} LUFS / ${b.TP} dBTP`);
  }
  console.log(`music+sfx: ${a.I} LUFS / ${a.TP} dBTP`);
};

main();
