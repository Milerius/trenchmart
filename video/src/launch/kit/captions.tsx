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

const text = (words: CaptionWord[]) => words.map((x) => x.w).join(' ');

/** Cuts a clause into the fewest phrases that fit, of roughly equal length (no orphan words). */
const balance = (words: CaptionWord[], maxChars: number, slack: number): CaptionWord[][] => {
  const len = text(words).length;
  if (len <= maxChars + slack) return [words];
  const target = len / Math.ceil(len / maxChars);
  const out: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (const word of words) {
    if (cur.length && text([...cur, word]).length > target + 4) {
      out.push(cur);
      cur = [];
    }
    cur.push(word);
  }
  return [...out, cur];
};

/**
 * Splits each line into short phrases at sentence ends and pauses, then balances long clauses.
 * `slack` lets a clause run a few characters over `maxChars` rather than split. A phrase that is
 * fully spoken before a scene cut is not held past that cut.
 */
export const chunk = (
  data: CaptionData,
  maxChars: number,
  slack: number,
  cuts: number[] = [],
): Chunk[] => {
  const chunks: Chunk[] = [];
  for (const line of data.lines) {
    let clause: CaptionWord[] = [];
    line.words.forEach((word, i) => {
      clause.push(word);
      const rest = text(line.words.slice(i + 1));
      const stop = /[.?!]$/.test(word.w);
      const pause = /[,:;]$/.test(word.w) && clause.length >= 3 && rest.length > 8;
      if (!stop && !pause && rest) return;
      for (const words of balance(clause, maxChars, slack)) {
        chunks.push({ words, from: words[0].from, to: words[words.length - 1].to });
      }
      clause = [];
    });
  }
  return chunks.map((c, i) => {
    const next = chunks[i + 1];
    const cut = cuts.find((f) => f > c.to) ?? Infinity;
    const end = Math.min(c.to + HOLD, next ? next.from - LEAD - 1 : Infinity, cut);
    return { ...c, from: c.from - LEAD, to: Math.max(end, c.to + 2) };
  });
};

/** Burned-in captions: one phrase at a time, the spoken word in lime. */
export const Captions: React.FC<{ data: CaptionData; cuts?: number[] }> = ({ data, cuts }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const chunks = React.useMemo(
    () => (tall ? chunk(data, 30, 3, cuts) : chunk(data, 46, 10, cuts)),
    [data, tall, cuts],
  );
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
          maxWidth: tall ? 1000 : 1500,
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
