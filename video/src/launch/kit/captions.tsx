import React from 'react';
import { useCurrentFrame } from 'remotion';
import { ease, easeIn } from '../../anim';
import { C, SANS } from '../../theme';
import { useFormat } from './format';

export type CaptionWord = { w: string; from: number; to: number };
export type CaptionData = { lines: { id: string; words: CaptionWord[] }[] };

type Chunk = { words: CaptionWord[]; from: number; to: number };

const LEAD = 3;
const HOLD = 16;

/** Splits each line into short phrases, breaking at punctuation where possible. */
export const chunk = (data: CaptionData, maxChars: number): Chunk[] => {
  const chunks: Chunk[] = [];
  for (const line of data.lines) {
    let cur: CaptionWord[] = [];
    const flush = () => {
      if (cur.length) chunks.push({ words: cur, from: cur[0].from, to: cur[cur.length - 1].to });
      cur = [];
    };
    line.words.forEach((word, i) => {
      const len = [...cur, word].map((x) => x.w).join(' ').length;
      if (cur.length && len > maxChars) flush();
      cur.push(word);
      const next = line.words[i + 1];
      const stop = /[.?!]$/.test(word.w);
      const pause = /[,:;]$/.test(word.w);
      const restLen = line.words
        .slice(i + 1)
        .map((x) => x.w)
        .join(' ').length;
      if (stop || (pause && cur.length >= 3 && restLen > 8) || !next) flush();
    });
  }
  return chunks.map((c, i) => {
    const next = chunks[i + 1];
    const end = Math.min(c.to + HOLD, next ? next.from - LEAD - 1 : Infinity);
    return { ...c, from: c.from - LEAD, to: Math.max(end, c.to + 2) };
  });
};

/** Burned-in captions: one phrase at a time, the spoken word in lime. */
export const Captions: React.FC<{ data: CaptionData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const chunks = React.useMemo(() => chunk(data, tall ? 30 : 46), [data, tall]);
  const active = chunks.find((c) => frame >= c.from && frame < c.to);
  if (!active) return null;
  const inP = ease(frame, active.from, active.from + 5);
  const outP = easeIn(frame, active.to - 4, active.to);
  const size = tall ? 54 : 42;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(tall ? { top: 1468 } : { bottom: 54 }),
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: tall ? 940 : 1500,
          padding: tall ? '16px 30px 18px' : '12px 30px 14px',
          borderRadius: 16,
          background: 'rgba(10,11,10,0.82)',
          border: `1px solid ${C.border}`,
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: size,
          lineHeight: 1.22,
          letterSpacing: '-0.015em',
          textAlign: 'center',
          opacity: inP * (1 - outP),
          transform: `translateY(${(1 - inP) * 10 + outP * 6}px)`,
        }}
      >
        {active.words.map((word, i) => {
          const spoken = frame >= word.from;
          const current = spoken && frame < word.to + 2;
          return (
            <span
              key={i}
              style={{
                color: current ? C.accent : spoken ? C.text : 'rgba(237,239,234,0.5)',
              }}
            >
              {word.w}
              {i < active.words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
};
