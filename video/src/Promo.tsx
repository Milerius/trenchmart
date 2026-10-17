import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { lin } from './anim';
import { Background, Hud, Ticker } from './ui/layout';
import { Hook } from './scenes/Hook';
import { ListScene } from './scenes/List';
import { ScanScene } from './scenes/Scan';
import { EscrowScene } from './scenes/Escrow';
import { UnlockScene } from './scenes/Unlock';
import { Outro } from './scenes/Outro';

/** Scene start frames and lengths; neighbours overlap by 8 frames for the hand-off. */
export const BEATS = {
  hook: { from: 0, dur: 120 },
  list: { from: 112, dur: 136 },
  scan: { from: 240, dur: 150 },
  escrow: { from: 382, dur: 140 },
  unlock: { from: 514, dur: 134 },
  outro: { from: 640, dur: 160 },
} as const;

export const PROMO_FRAMES = BEATS.outro.from + BEATS.outro.dur;

const STEP_STARTS = [BEATS.list.from, BEATS.scan.from, BEATS.escrow.from, BEATS.unlock.from];

export const Promo: React.FC = () => {
  const frame = useCurrentFrame();
  const hudOpacity = Math.min(
    lin(frame, BEATS.list.from + 4, BEATS.list.from + 16),
    1 - lin(frame, BEATS.outro.from - 6, BEATS.outro.from + 4),
  );
  const step = STEP_STARTS.filter((s) => frame >= s + 6).length - 1;

  return (
    <AbsoluteFill>
      <Background />
      {(Object.keys(BEATS) as (keyof typeof BEATS)[]).map((k) => {
        const { from, dur } = BEATS[k];
        const Scene = SCENES[k];
        return (
          <Sequence key={k} from={from} durationInFrames={dur} name={k}>
            <Scene dur={dur} />
          </Sequence>
        );
      })}
      <Hud step={Math.max(0, step)} opacity={hudOpacity} />
      <Ticker />
    </AbsoluteFill>
  );
};

const SCENES: Record<keyof typeof BEATS, React.FC<{ dur: number }>> = {
  hook: Hook,
  list: ListScene,
  scan: ScanScene,
  escrow: EscrowScene,
  unlock: UnlockScene,
  outro: Outro,
};
