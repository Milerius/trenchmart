import { BAR, BEATS, FPS, PROMO_FRAMES, UNLOCK } from '../src/timeline';
import {
  addInto,
  applyGain,
  normalize,
  pingPong,
  place,
  reverb,
  softClip,
  Stereo,
  stereo,
  sweepStereo,
} from './dsp';
import { bell, boom, clap, crash, hat, kick, padNote, pluck, riser, sub808 } from './instruments';

const BAR_S = BAR / FPS;
const S16 = BAR_S / 16;
const at = (bar: number, pos16 = 0) => bar * BAR_S + pos16 * S16;
const sec = (frame: number) => frame / FPS;

// F minor: i - VI - III - VII.
const CHORDS = {
  Fm: { pad: [53, 56, 60, 65], root: 41 },
  Db: { pad: [49, 53, 56, 61], root: 37 },
  Ab: { pad: [51, 56, 60, 63], root: 44 },
  Eb: { pad: [51, 55, 58, 63], root: 39 },
};
type Chord = keyof typeof CHORDS;
const PROG: Chord[] = ['Fm', 'Db', 'Fm', 'Db', 'Ab', 'Eb', 'Fm', 'Db', 'Ab', 'Eb', 'Fm', 'Fm'];

const GROOVE = [2, 9] as const;
const OUTRO_BAR = 10;
const FINAL_STAB = at(11, 8);

export const renderMusic = (): Stereo => {
  const len = PROMO_FRAMES / FPS;
  const drums = stereo(len);
  const bass = stereo(len);
  const pads = stereo(len);
  const arps = stereo(len);
  const fx = stereo(len);

  const k = kick();
  const kSoft = kick(0.6);
  const cl = clap();
  const hc = [hat(false, 5), hat(false, 6), hat(false, 8)];
  const ho = hat(true, 9);

  PROG.forEach((name, bar) => {
    const ch = CHORDS[name];
    const inGroove = bar >= GROOVE[0] && bar <= GROOVE[1];
    const intro = bar < GROOVE[0];
    const outro = bar >= OUTRO_BAR;

    const cutoff = intro ? 900 + bar * 500 : outro ? 2200 : 1700;
    const padLen = bar === PROG.length - 1 ? BAR_S * 0.5 : BAR_S;
    ch.pad.forEach((m, i) =>
      place(
        pads,
        padNote(m, padLen, cutoff, bar),
        at(bar),
        intro || outro ? 0.15 : 0.11,
        [-0.6, -0.2, 0.2, 0.6][i],
      ),
    );

    if (intro) {
      place(bass, sub808(ch.root, BAR_S * 0.9, 2.2), at(bar), 0.45);
      place(drums, k, at(bar), 0.5);
      place(drums, kSoft, at(bar, 10), 0.35);
      for (let p = 0; p < 16; p += 2)
        place(drums, hc[p % 3], at(bar, p), p % 4 ? 0.06 : 0.09, 0.25);
      if (bar === 1) {
        for (const p of [4, 8, 12]) place(drums, k, at(bar, p), 0.45);
        for (let p = 8; p < 16; p++) place(drums, cl, at(bar, p), 0.08 + ((p - 8) / 8) * 0.3);
        for (let p = 12; p < 16; p += 0.5) place(drums, hc[1], at(bar, p), 0.09, -0.2);
      } else {
        place(drums, cl, at(bar, 12), 0.3);
      }
      return;
    }

    if (inGroove) {
      const odd = bar % 2 === 1;
      const pattern: [number, number][] = odd
        ? [
            [0, 7],
            [7, 3],
            [10, 4],
            [14, 2],
          ]
        : [
            [0, 6],
            [6, 4],
            [10, 6],
          ];
      pattern.forEach(([p, l], i) => {
        const m = odd && i === 3 ? ch.root + 12 : ch.root;
        place(bass, sub808(m, l * S16), at(bar, p), 0.5);
        place(drums, k, at(bar, p), i === 0 ? 0.6 : 0.45);
      });
      place(drums, cl, at(bar, 4), 0.42);
      place(drums, cl, at(bar, 12), 0.42);

      const sceneEnd = odd;
      for (let p = 0; p < 16; p++) {
        const sixteenths = odd && p >= 8;
        if (p % 2 === 1 && !sixteenths) continue;
        if (sceneEnd && p >= 12) continue;
        place(drums, hc[p % 3], at(bar, p), p % 4 === 0 ? 0.13 : 0.085, 0.25);
      }
      if (sceneEnd) {
        for (let p = 12; p < 16; p += 1 / 3)
          place(drums, hc[1], at(bar, p), 0.06 + (p - 12) * 0.015, 0.25);
      } else {
        place(drums, ho, at(bar, 14), 0.06, -0.25);
      }

      if (bar >= 4) {
        const notes = ch.pad.slice(1).map((m) => m + 12);
        const seq = [0, 1, 2, 1, 0, 2, 1, 2];
        for (let p = 0; p < 16; p++) {
          place(
            arps,
            pluck(notes[seq[p % 8]] + (p >= 12 && odd ? 12 : 0)),
            at(bar, p),
            0.07,
            p % 2 ? 0.35 : -0.35,
          );
        }
      }
    }

    if (bar === OUTRO_BAR) {
      place(bass, sub808(ch.root, BAR_S * 1.6), at(bar), 0.55);
      place(drums, k, at(bar), 0.65);
      place(drums, k, at(bar, 8), 0.45);
      place(bass, sub808(ch.root + 12, S16 * 4), at(bar, 8), 0.3);
      place(drums, cl, at(bar, 4), 0.35);
      place(drums, cl, at(bar, 12), 0.35);
      for (let p = 0; p < 16; p += 2) place(drums, hc[p % 3], at(bar, p), 0.1, 0.25);
      const notes = ch.pad.slice(1).map((m) => m + 12);
      for (let p = 0; p < 16; p++)
        place(arps, pluck(notes[[0, 1, 2, 1][p % 4]]), at(bar, p), 0.045, p % 2 ? 0.35 : -0.35);
    }
  });

  // Section hits: drop into the first scene change, crashes on each scene, boom on the logo.
  place(fx, riser(BAR_S), at(1), 0.32);
  place(fx, riser(BAR_S * 0.5, 13), at(9, 8), 0.16);
  place(fx, riser(BAR_S * 0.5, 17), at(11), 0.14);
  for (const b of [2, 4, 6, 8]) place(fx, crash(), at(b), b === 2 ? 0.24 : 0.12, -0.15);
  place(fx, boom(), at(2), 0.55);
  place(fx, boom(2.4), at(OUTRO_BAR), 0.7);
  place(fx, crash(3), at(OUTRO_BAR), 0.26);

  // Final stab: kick, 808, crash and a bell chord that rings out over the end card.
  place(drums, k, FINAL_STAB, 0.6);
  place(bass, sub808(41, 1.6), FINAL_STAB, 0.5);
  place(fx, crash(2), FINAL_STAB, 0.18);
  for (const [m, pan] of [
    [77, -0.3],
    [80, 0.3],
    [84, 0],
  ] as const)
    place(fx, bell(440 * 2 ** ((m - 69) / 12), 1.8, 1.6, 2), FINAL_STAB, 0.08, pan);

  // 48h fast-forward: the whole bed sinks under a low-pass, then slams back on the release.
  const unlock = BEATS.unlock.from;
  const ffA = sec(unlock + UNLOCK.fastForward[0]);
  const ffB = sec(unlock + UNLOCK.released) - 0.04;
  const rel = sec(unlock + UNLOCK.released);
  const warp = (t: number) =>
    t < ffA || t >= rel ? 20000 : t < ffB ? 18000 * 2 ** (-((t - ffA) / (ffB - ffA)) * 5.6) : 380;
  const bed = stereo(len);
  addInto(bed, drums);
  addInto(bed, bass);
  addInto(bed, pads);
  addInto(bed, arps);
  sweepStereo(bed, 'lp', warp);
  place(fx, kick(), rel, 0.6);
  place(fx, crash(), rel, 0.18, 0.15);

  const sends = stereo(len);
  addInto(sends, pads, 0.6);
  addInto(sends, arps, 0.8);
  addInto(sends, fx, 0.4);
  const verb = reverb(sends, 0.82, 0.35);
  const delay = pingPong(arps, S16 * 3, 0.35);
  sweepStereo(delay, 'lp', warp);

  const out = stereo(len);
  addInto(out, bed);
  addInto(out, fx);
  addInto(out, delay, 0.35);
  addInto(out, verb, 0.45);

  const end = len;
  applyGain(out, (t) => Math.min(1, (end - t) / 0.35));
  normalize(out, 0.9);
  softClip(out, 1.3);
  normalize(out, 0.89);
  return out;
};
