import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { ease, lin, sceneMotion, springAt } from '../anim';
import { C, SANS } from '../theme';
import { useWide } from '../ui/layout';
import { HOOK } from '../timeline';

const STACK = ['Trading scripts.', 'Bot configs.', 'Wallet trackers.'];
const BAD = 'Some are drainers.';
const GOOD_A = 'Not on ';
const GOOD_B = 'TrenchMart.';

export const Hook: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const wide = useWide();
  const size = wide ? 124 : 96;
  const line = size * 1.06;

  const badIn = springAt(frame, HOOK.bad, 14);
  const glitch = frame >= HOOK.bad && frame < HOOK.glitchEnd;
  const dx = glitch ? (random(`g${frame}`) - 0.5) * 14 : 0;
  const backspace = Math.round(lin(frame, ...HOOK.backspace, [BAD.length, 0]));
  const goodN = Math.round(lin(frame, ...HOOK.type, [0, GOOD_A.length + GOOD_B.length]));
  const typingGood = frame >= HOOK.type[0] - 1;
  const dim = ease(frame, ...HOOK.dim);
  const blink = Math.floor(frame / 8) % 2 === 0 || (frame > 30 && frame < HOOK.type[1] + 6);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', ...sceneMotion(frame, dur, 14) }}>
      <div style={{ paddingLeft: wide ? 180 : 80, marginTop: wide ? 0 : -10 }}>
        {STACK.map((t, i) => {
          const p = springAt(frame, HOOK.lines[i], 15);
          return (
            <div
              key={t}
              style={{
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: size,
                lineHeight: `${line}px`,
                letterSpacing: '-0.045em',
                color: dim > 0 ? mix(C.text, C.decor, dim) : C.text,
                opacity: Math.min(1, p * 1.4),
                transform: `translateY(${(1 - p) * 70}px) scale(${0.94 + 0.06 * p})`,
                transformOrigin: 'left center',
              }}
            >
              {t}
            </div>
          );
        })}
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: size,
            lineHeight: `${line}px`,
            letterSpacing: '-0.045em',
            display: 'flex',
            alignItems: 'center',
            whiteSpace: 'pre',
            opacity: frame < HOOK.bad ? 0 : 1,
            transform: `translateY(${(1 - badIn) * 60}px) translateX(${dx}px)`,
          }}
        >
          {typingGood ? (
            <>
              <span style={{ color: C.text }}>{GOOD_A.slice(0, goodN)}</span>
              <span style={{ color: C.accent }}>
                {GOOD_B.slice(0, Math.max(0, goodN - GOOD_A.length))}
              </span>
            </>
          ) : (
            <span
              style={{
                color: C.danger,
                textShadow: glitch ? `${dx}px 0 ${C.danger}88, ${-dx}px 0 ${C.info}66` : 'none',
              }}
            >
              {BAD.slice(0, backspace)}
            </span>
          )}
          <span
            style={{
              display: 'inline-block',
              width: size * 0.09,
              height: size * 0.9,
              marginLeft: size * 0.06,
              background: typingGood ? C.accent : C.danger,
              opacity: blink ? 1 : 0,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
};
