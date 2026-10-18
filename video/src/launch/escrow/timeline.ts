import { sequence } from '../kit/timeline';

export const ESCROW_V = sequence([
  { id: 'hook', bars: 2 },
  { id: 'buy', bars: 2, chapter: 'BUY' },
  { id: 'hold', bars: 2, chapter: 'HOLD' },
  { id: 'dispute', bars: 2, chapter: 'DISPUTE' },
  { id: 'release', bars: 2, chapter: 'RELEASE' },
  { id: 'proof', bars: 3, chapter: 'PROOF' },
  { id: 'outro', bars: 2 },
]);

/** Beat frames, local to each scene. */
export const BUY = { cursor: [4, 22], click: 24, signed: 48, confirmed: 76, done: 100 } as const;
export const HOLD = { count: [8, 34], window: [44, 60], download: 80 } as const;
export const DISPUTE = { cursor: [20, 40], click: 44, open: 48, refund: 74, reject: 86, timeout: 98 } as const;
export const RELEASE = { ff: [8, 34], released: 40, seller: 84, split: [104, 120] } as const;
export const PROOF = {
  zoomA: [14, 40],
  addr: 40,
  tx: 92,
  zoomB: [98, 118],
  escrowRow: 112,
  zoomC: [148, 172],
  logs: 168,
} as const;
