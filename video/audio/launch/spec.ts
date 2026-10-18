import type { Mono } from '../dsp';
import type { Chord } from './music';

export type Cue<T extends string> = (scene: T, frame: number, src: Mono, gain: number, pan?: number) => void;

/** A launch video's soundtrack: the score's key and chords, and SFX cues on scene-local frames. */
export type LaunchAudio<T extends string> = {
  id: string;
  timeline: { list: { id: T; from: number }[]; at: Record<T, { from: number }>; total: number };
  key: number;
  prog: Chord[];
  sfx: (cue: Cue<T>) => void;
};

export const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let f = a; f <= b; f += step) out.push(f);
  return out;
};
