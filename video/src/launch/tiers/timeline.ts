import { sequence } from '../kit/timeline';

export const TIERS = sequence([
  { id: 'hook', bars: 2 },
  { id: 'fee', bars: 2, chapter: 'THE FEE' },
  { id: 'tiers', bars: 4, chapter: 'TIERS' },
  { id: 'checkout', bars: 2, chapter: 'CHECKOUT' },
  { id: 'window', bars: 2, chapter: '72 H WINDOW' },
  { id: 'outro', bars: 2 },
]);

/** Beat frames, local to each scene. */
export const HOOK_T = { count: [30, 110] } as const;
export const FEE = { buyer: 10, fee: 30, creator: 76, zero: 96 } as const;
export const LADDER = { scout: 14, scoutOff: 76, trencher: 132, trencherOff: 186, og: 222, ogOff: 262 } as const;
export const CHECKOUT = { tier: 18, discount: 30, total: 44, locked: 64, sign: 92 } as const;
export const WINDOW = { draw: [8, 60], spike: [44, 60], low: 66, result: 104 } as const;
