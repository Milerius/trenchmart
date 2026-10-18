import { BAR, FPS } from '../../src/timeline';
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
} from '../dsp';
import { bell, boom, clap, crash, hat, kick, padNote, pluck, riser, sub808 } from '../instruments';

const BAR_S = BAR / FPS;
const S16 = BAR_S / 16;
const at = (bar: number, pos16 = 0) => bar * BAR_S + pos16 * S16;

// Diatonic chords of F minor; `Song.key` transposes the whole song.
const CHORDS = {
  i: { pad: [53, 56, 60, 65], root: 41 },
  VI: { pad: [49, 53, 56, 61], root: 37 },
  III: { pad: [51, 56, 60, 63], root: 44 },
  VII: { pad: [51, 55, 58, 63], root: 39 },
  iv: { pad: [53, 58, 61, 65], root: 46 },
  v: { pad: [51, 55, 60, 63], root: 36 },
};
export type Chord = keyof typeof CHORDS;

/**
 * One launch video's score. The first two bars are the hook (a building intro), the last two the
 * outro (a hit on the logo, a final stab as the tagline lands, then the pads ring out). Everything
 * in between grooves, with a crash on every scene change.
 */
export type Song = {
  bars: number;
  key: number;
  /** One chord per bar before the outro. */
  prog: Chord[];
  /** Bars that start a new scene. */
  scenes: number[];
};

export const renderLaunchMusic = (song: Song): Stereo => {
  const len = (song.bars * BAR) / FPS;
  const outroBar = song.bars - 2;
  const tr = (m: number) => m + song.key;
  const chordAt = (bar: number) => CHORDS[song.prog[Math.min(bar, song.prog.length - 1)]];
  const tonic = CHORDS.i;

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

  for (let bar = 0; bar < outroBar; bar++) {
    const ch = chordAt(bar);
    const intro = bar < 2;
    const cutoff = intro ? 900 + bar * 500 : 1700;
    ch.pad.forEach((m, i) =>
      place(
        pads,
        padNote(tr(m), BAR_S, cutoff, bar),
        at(bar),
        intro ? 0.15 : 0.11,
        [-0.6, -0.2, 0.2, 0.6][i],
      ),
    );

    if (intro) {
      place(bass, sub808(tr(ch.root), BAR_S * 0.9, 2.2), at(bar), 0.45);
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
      continue;
    }

    const sceneEnd = song.scenes.includes(bar + 1);
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
      place(bass, sub808(tr(m), l * S16), at(bar, p), 0.5);
      place(drums, k, at(bar, p), i === 0 ? 0.6 : 0.45);
    });
    place(drums, cl, at(bar, 4), 0.42);
    place(drums, cl, at(bar, 12), 0.42);

    for (let p = 0; p < 16; p++) {
      const sixteenths = sceneEnd && p >= 8;
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
      const notes = ch.pad.slice(1).map((m) => tr(m + 12));
      const seq = [0, 1, 2, 1, 0, 2, 1, 2];
      for (let p = 0; p < 16; p++)
        place(
          arps,
          pluck(notes[seq[p % 8]] + (p >= 12 && sceneEnd ? 12 : 0)),
          at(bar, p),
          0.07,
          p % 2 ? 0.35 : -0.35,
        );
    }
  }

  // Outro: hit on the logo, a half bar of groove, the final stab as the tagline lands, then ring out.
  tonic.pad.forEach((m, i) =>
    place(pads, padNote(tr(m), BAR_S * 2, 2200, 99), at(outroBar), 0.14, [-0.6, -0.2, 0.2, 0.6][i]),
  );
  place(bass, sub808(tr(tonic.root), BAR_S * 0.5), at(outroBar), 0.55);
  place(drums, k, at(outroBar), 0.65);
  place(drums, cl, at(outroBar, 4), 0.35);
  for (let p = 0; p < 8; p += 2) place(drums, hc[p % 3], at(outroBar, p), 0.1, 0.25);
  place(fx, boom(2.4), at(outroBar), 0.7);
  place(fx, crash(3), at(outroBar), 0.26);
  const notes = tonic.pad.slice(1).map((m) => tr(m + 12));
  for (let p = 0; p < 8; p++)
    place(arps, pluck(notes[[0, 1, 2, 1][p % 4]]), at(outroBar, p), 0.045, p % 2 ? 0.35 : -0.35);

  const stab = at(outroBar, 9);
  place(drums, k, stab, 0.6);
  place(bass, sub808(tr(tonic.root), 1.6), stab, 0.5);
  place(fx, crash(2), stab, 0.18);
  for (const [m, pan] of [
    [77, -0.3],
    [80, 0.3],
    [84, 0],
  ] as const)
    place(fx, bell(440 * 2 ** ((tr(m) - 69) / 12), 1.8, 1.6, 2), stab, 0.08, pan);

  place(fx, riser(BAR_S), at(1), 0.32);
  place(fx, boom(), at(2), 0.55);
  place(fx, riser(BAR_S * 0.5, 17), at(outroBar - 1, 8), 0.14);
  for (const b of song.scenes) if (b > 2 && b < outroBar) place(fx, crash(), at(b), 0.12, -0.15);
  place(fx, crash(), at(2), 0.24, -0.15);

  const sends = stereo(len);
  addInto(sends, pads, 0.6);
  addInto(sends, arps, 0.8);
  addInto(sends, fx, 0.4);
  const verb = reverb(sends, 0.82, 0.35);
  const delay = pingPong(arps, S16 * 3, 0.35);

  const out = stereo(len);
  addInto(out, drums);
  addInto(out, bass);
  addInto(out, pads);
  addInto(out, arps);
  addInto(out, fx);
  addInto(out, delay, 0.35);
  addInto(out, verb, 0.45);

  applyGain(out, (t) => Math.min(1, (len - t) / 0.6));
  normalize(out, 0.9);
  softClip(out, 1.3);
  normalize(out, 0.89);
  return out;
};
