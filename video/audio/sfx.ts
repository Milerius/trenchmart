import { BEATS, ESCROW, FPS, HOOK, LIST, OUTRO, PROMO_FRAMES, SCAN, UNLOCK } from '../src/timeline';
import { Biquad, filter, mono, place, rng, SR, Stereo, stereo, sweep } from './dsp';
import {
  beep,
  chime,
  coin,
  glitch,
  keyTick,
  lockClunk,
  pop,
  thud,
  uiClick,
  whir,
  whoosh,
} from './instruments';

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let f = a; f <= b; f += step) out.push(f);
  return out;
};

/** Filtered noise that tracks the scan beam down the card. */
export const scanHum = (len: number): Float32Array => {
  const r = rng(81);
  const out = mono(len);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * 12 * t);
    out[i] = (r() * 2 - 1) * trem * Math.min(1, t / 0.08, (len - t) / 0.08);
  }
  sweep(out, 'bp', (t) => 700 * 2 ** ((t / len) * 1.8), 3);
  return filter(out, new Biquad('hp', 400));
};

export const renderSfx = (): Stereo => {
  const bus = stereo(PROMO_FRAMES / FPS);
  const cue = (
    scene: keyof typeof BEATS,
    frame: number,
    src: Float32Array,
    gain: number,
    pan = 0,
  ) => place(bus, src, (BEATS[scene].from + frame) / FPS, gain, pan);

  // Hook: line slams, the drainer glitch, backspace and retype.
  HOOK.lines.slice(1).forEach((f) => cue('hook', f + 2, thud(), 0.35));
  cue('hook', HOOK.bad, glitch(), 0.2);
  range(HOOK.backspace[0], HOOK.backspace[1], 2).forEach((f, i) =>
    cue('hook', f, keyTick(i), 0.12),
  );
  range(HOOK.type[0], HOOK.type[1], 2).forEach((f, i) => cue('hook', f, keyTick(100 + i), 0.12));

  // List: file flies in and lands, upload ticks, hash pin, typing, category, price, submit.
  cue('list', LIST.fly - 2, whoosh(0.32, true), 0.22, 0.4);
  cue('list', LIST.fly + 8, thud(), 0.3);
  range(LIST.upload[0], LIST.upload[1], 3).forEach((f, i) =>
    cue('list', f, beep(84 + i * 2, 0.05), 0.035),
  );
  cue('list', LIST.sha[1], beep(96, 0.1), 0.12);
  range(LIST.title[0], LIST.title[1], 2).forEach((f, i) => cue('list', f, keyTick(200 + i), 0.08));
  cue('list', LIST.category, uiClick(22), 0.28);
  range(LIST.price[0], LIST.price[1], 4).forEach((f, i) => cue('list', f, keyTick(300 + i), 0.06));
  cue('list', LIST.click, uiClick(), 0.42);

  // Scan: beam hum, a rising beep per finished row, then the verified chime.
  cue('scan', SCAN.beam[0], scanHum((SCAN.beam[1] - SCAN.beam[0]) / FPS), 0.07);
  SCAN.rows.forEach(([, done], i) => cue('scan', done, beep([88, 91, 95][i]), 0.15));
  cue('scan', SCAN.verified + 1, chime([84, 91, 96]), 0.3);

  // Escrow: click, wallet prompt, confirming, confirmed, coins into the vault, lock.
  cue('escrow', ESCROW.click, uiClick(), 0.42);
  cue('escrow', ESCROW.click + 3, beep(83, 0.08), 0.08);
  cue('escrow', ESCROW.click + 6, beep(88, 0.1), 0.08);
  cue('escrow', ESCROW.signed, beep(79, 0.08), 0.06);
  cue('escrow', ESCROW.confirmed, beep(88, 0.08), 0.12);
  cue('escrow', ESCROW.confirmed + 3, beep(92, 0.12), 0.12);
  for (let i = 0; i < 22; i += 2) cue('escrow', ESCROW.signed + 20 + i * 0.8, coin(i), 0.05, 0.45);
  cue('escrow', ESCROW.funded, lockClunk(), 0.5, 0.35);

  // Unlock: tape whir through the 48h fast-forward, release chime, toast, click, done.
  cue('unlock', UNLOCK.fastForward[0], whir((UNLOCK.released - UNLOCK.fastForward[0]) / FPS), 0.15);
  cue('unlock', UNLOCK.released, lockClunk(), 0.28);
  cue('unlock', UNLOCK.released + 1, chime([80, 84, 87, 92]), 0.3);
  cue('unlock', UNLOCK.toast, pop(), 0.14, 0.4);
  cue('unlock', UNLOCK.click, uiClick(), 0.42);
  cue('unlock', UNLOCK.download[1], beep(91, 0.08), 0.13);
  cue('unlock', UNLOCK.download[1] + 4, beep(96, 0.14), 0.13);

  // Outro: glyph strokes, wordmark wipe, URL pill.
  cue('outro', OUTRO.tile + 8, whoosh(0.22, true, 33), 0.08);
  cue('outro', OUTRO.wordmark, whoosh(0.4, false, 35), 0.14);
  cue('outro', OUTRO.url, pop(), 0.14);
  cue('outro', OUTRO.url, uiClick(23), 0.12);

  return bus;
};
