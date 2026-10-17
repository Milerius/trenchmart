// Single source of timing for the visuals and the audio. The cut sits on a 100 BPM grid:
// one beat is exactly 18 frames at 30 fps, and every scene is two bars (144 frames), so each
// scene change lands on a downbeat.

export const FPS = 30;
export const BPM = 100;
export const BEAT = (60 / BPM) * FPS;
export const BAR = BEAT * 4;
const SCENE = BAR * 2;

export const BEATS = {
  hook: { from: 0, dur: SCENE },
  list: { from: SCENE, dur: SCENE },
  scan: { from: SCENE * 2, dur: SCENE },
  escrow: { from: SCENE * 3, dur: SCENE },
  unlock: { from: SCENE * 4, dur: SCENE },
  outro: { from: SCENE * 5, dur: SCENE + 12 },
} as const;

export const PROMO_FRAMES = BEATS.outro.from + BEATS.outro.dur;

// Scene-local event frames (relative to each scene's `from`).

export const HOOK = {
  lines: [-10, 7, 16],
  bad: 34,
  glitchEnd: 52,
  backspace: [72, 81],
  type: [88, 104],
  dim: [82, 96],
} as const;

export const LIST = {
  fly: 10,
  upload: [26, 44],
  sha: [44, 54],
  title: [52, 76],
  category: 78,
  price: [84, 100],
  cursor: [90, 107],
  click: 108,
} as const;

export const SCAN = {
  beam: [12, 90],
  rows: [
    [14, 36],
    [36, 63],
    [63, 90],
  ],
  verified: 90,
} as const;

export const ESCROW = {
  cursor: [34, 52],
  click: 54,
  signed: 72,
  confirmed: 90,
  funded: 108,
} as const;

export const UNLOCK = {
  fastForward: [10, 50],
  released: 54,
  toast: 66,
  cursor: [72, 89],
  click: 90,
  download: [96, 112],
} as const;

export const OUTRO = {
  tile: 0,
  wordmark: 30,
  tagline: 51,
  url: 72,
} as const;
