import { Easing, interpolate, spring } from 'remotion';
import { FPS } from './theme';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const springAt = (frame: number, at: number, damping = 200, durationInFrames?: number) =>
  spring({ frame: frame - at, fps: FPS, config: { damping }, durationInFrames });

export const ease = (frame: number, from: number, to: number, out = [0, 1]) =>
  interpolate(frame, [from, to], out, { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) });

export const easeIn = (frame: number, from: number, to: number, out = [0, 1]) =>
  interpolate(frame, [from, to], out, { ...clamp, easing: Easing.bezier(0.64, 0, 0.78, 0) });

export const lin = (frame: number, from: number, to: number, out = [0, 1]) =>
  interpolate(frame, [from, to], out, clamp);

/** Characters of `text` revealed between frames `from` and `to`. */
export const typed = (frame: number, text: string, from: number, to: number) =>
  text.slice(0, Math.round(lin(frame, from, to, [0, text.length])));

/** Scene wrapper motion: rise in at the start, lift out at the end. */
export const sceneMotion = (frame: number, dur: number, outLen = 12) => {
  const exit = easeIn(frame, dur - outLen, dur);
  return {
    opacity: 1 - exit,
    transform: `translateY(${-40 * exit}px)`,
    filter: exit > 0.01 ? `blur(${exit * 6}px)` : undefined,
  };
};
