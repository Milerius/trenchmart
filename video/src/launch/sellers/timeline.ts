import { sequence } from '../kit/timeline';

export const SELLERS = sequence([
  { id: 'hook', bars: 2 },
  { id: 'wizard', bars: 3, chapter: 'LIST' },
  { id: 'pricing', bars: 3, chapter: 'PRICING' },
  { id: 'versions', bars: 2, chapter: 'VERSIONS' },
  { id: 'studio', bars: 2, chapter: 'STUDIO' },
  { id: 'outro', bars: 2 },
]);

/** Beat frames, local to each scene. */
export const WIZARD = {
  pick: 22,
  step2: 58,
  /** When each terminal is named in the voiceover: Axiom, GMGN, Photon, Terminal, Trojan. */
  terminals: [115, 133, 169, 184, 194],
} as const;
export const PRICING = {
  price: [14, 30],
  toggle: 76,
  free: 118,
  monthly: [150, 166],
  renews: 172,
} as const;
export const VERSIONS = {
  semver: [10, 22],
  changelog: [24, 50],
  submit: 56,
  checks: 60,
  verdict: 96,
  live: 118,
} as const;
export const STUDIO = { chips: [20, 50], zoom: [80, 104], bond: 98, trust: 116 } as const;
