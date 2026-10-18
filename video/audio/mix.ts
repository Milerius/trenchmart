// Shared mixing helpers: voiceover bus, music ducking and loudness mastering.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { addInto, Biquad, filter, place, SR, Stereo, stereo } from './dsp';

const TARGET_LUFS = -14;
const CEILING_DBTP = -1;

export const readMono48k = (file: string): Float32Array => {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'],
    {
      maxBuffer: 1 << 28,
    },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
};

export const rms = (x: Float32Array, gate = 0) => {
  let s = 0;
  let n = 0;
  for (const v of x) {
    if (Math.abs(v) < gate) continue;
    s += v * v;
    n++;
  }
  return Math.sqrt(s / Math.max(1, n));
};

/** Places each line's `<id>.wav` at its start time, EQ'd for clarity. Null if any line is missing. */
export const renderVoBus = (
  lines: { id: string; seconds: number }[],
  dir: string,
  seconds: number,
): Stereo | null => {
  const files = lines.map((l) => path.join(dir, `${l.id}.wav`));
  if (!files.every(existsSync)) return null;
  const bus = stereo(seconds);
  lines.forEach((l, i) => {
    const x = readMono48k(files[i]);
    filter(x, new Biquad('hp', 90));
    filter(x, new Biquad('peak', 3200, 0.9, 2.5));
    filter(x, new Biquad('peak', 250, 1, -1.5));
    place(bus, x, l.seconds, 1, 0);
  });
  return bus;
};

/** Gain curve that dips the music by up to `depthDb` while the voice is talking. */
export const duckCurve = (vo: Stereo, depthDb = 7): Float32Array => {
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

/** Music ducked under the voice, SFX, and the voice ~7 dB above the ducked bed (speech only). */
export const mixWithVo = (music: Stereo, sfx: Stereo, vo: Stereo, seconds: number): Stereo => {
  const duck = duckCurve(vo);
  const ducked = stereo(seconds);
  for (let i = 0; i < ducked.L.length; i++) {
    ducked.L[i] = music.L[i] * duck[i];
    ducked.R[i] = music.R[i] * duck[i];
  }
  const voGain = (rms(ducked.L) * 10 ** (7 / 20)) / rms(vo.L, 0.01);
  const full = stereo(seconds);
  addInto(full, ducked);
  addInto(full, sfx, 0.85);
  addInto(full, vo, voGain);
  return full;
};

export const measure = (file: string) => {
  const log = execFileSync('bash', [
    '-c',
    `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1 | tail -14`,
  ]).toString();
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log)?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(log)?.[1]);
  return { I, TP };
};

/** Gain to -14 LUFS, then a true-peak-safe limiter at -1 dBTP; repeated until within 0.2 LU. */
export const master = (premaster: string, out: string) => {
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
