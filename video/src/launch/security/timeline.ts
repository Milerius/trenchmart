import { sequence } from '../kit/timeline';

export const SECURITY = sequence([
  { id: 'hook', bars: 2 },
  { id: 'upload', bars: 2, chapter: 'UPLOAD' },
  { id: 'review', bars: 3, chapter: 'LIVE REVIEW' },
  { id: 'verdict', bars: 3, chapter: 'VERDICT' },
  { id: 'report', bars: 2, chapter: 'SIGNED REPORT' },
  { id: 'outro', bars: 2 },
]);

/** Beat frames, local to each scene. */
export const HOOK = { beam: [14, 100], flag: 64 } as const;
export const UPLOAD = { fly: [8, 26], progress: [28, 56], sha: [58, 80], pinned: 82, scanning: 94 } as const;
export const REVIEW = {
  staticRun: 8,
  staticDone: 44,
  sandboxRun: 12,
  sandboxDone: 80,
  logs: [26, 84],
  verdictRun: 86,
  verdictDone: 150,
  live: 162,
} as const;
export const VERDICT = {
  rules: 8,
  rulesDecide: 28,
  llm: 20,
  llmDecide: 70,
  merge: [96, 118],
  final: 120,
  note: 150,
} as const;
export const REPORT = { json: [6, 54], sign: 56, browser: [62, 84], zoom: [86, 112], valid: 108 } as const;
