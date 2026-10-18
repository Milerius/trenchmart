import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { clamp } from '../../anim';
import { Headline, type Word } from '../../ui/layout';
import { useFormat } from './format';

/** Rough Geist Bold advance at -0.04em tracking, used to keep headlines inside their column. */
const fit = (lines: Word[][], maxWidth: number, maxSize: number) => {
  const chars = Math.max(...lines.map((l) => l.map((w) => w.t).join(' ').length));
  return Math.min(maxSize, Math.floor(maxWidth / (chars * 0.54)));
};

export type HeadlineSpec = {
  label: string;
  wide: Word[][];
  tall?: Word[][];
  sub?: React.ReactNode;
};

export const SceneHeadline: React.FC<{ spec: HeadlineSpec; dur: number; delay?: number }> = ({
  spec,
  dur,
  delay = 0,
}) => {
  const { tall } = useFormat();
  const lines = tall ? (spec.tall ?? spec.wide) : spec.wide;
  const size = tall ? fit(lines, 950, 100) : fit(lines, 720, 86);
  return <Headline label={spec.label} lines={lines} sub={spec.sub} size={size} dur={dur} delay={delay} />;
};

/**
 * A beat's headline and UI card. Wide: headline in the left column, card on the right.
 * Tall: headline on top, card below it, clear of the caption band.
 */
export const LStage: React.FC<{
  headline: HeadlineSpec;
  card: React.ReactNode;
  scale?: { wide: number; tall: number };
  dur: number;
  tallCardTop?: number;
}> = ({ headline, card, scale = { wide: 1, tall: 1.1 }, dur, tallCardTop = 640 }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const s = tall ? scale.tall : scale.wide;
  const exit = interpolate(frame, [dur - 15, dur - 2], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  return (
    <AbsoluteFill>
      <div
        style={
          tall
            ? { position: 'absolute', left: 64, right: 64, top: 262 }
            : {
                position: 'absolute',
                left: 110,
                width: 740,
                top: 140,
                bottom: 150,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }
        }
      >
        <SceneHeadline spec={headline} dur={dur} />
      </div>
      <div
        style={{
          position: 'absolute',
          ...(tall
            ? { left: 0, right: 0, top: tallCardTop, bottom: 480 }
            : { left: 860, right: 70, top: 140, bottom: 150 }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 1 - exit,
          filter: exit > 0.01 ? `blur(${exit * 8}px)` : undefined,
        }}
      >
        <div
          style={{
            transform: `translateY(${-50 * exit}px) scale(${s * (1 + 0.025 * (frame / dur) - 0.04 * exit)})`,
          }}
        >
          {card}
        </div>
      </div>
    </AbsoluteFill>
  );
};
