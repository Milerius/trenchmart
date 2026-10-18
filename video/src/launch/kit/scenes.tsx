import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ease, easeIn, lin, sceneMotion } from '../../anim';
import { C, MONO, SANS } from '../../theme';
import { LogoMark } from '../../ui/primitives';
import { Headline, type Word } from '../../ui/layout';
import { DevnetPill } from './shell';
import { useFormat } from './format';

/** Opening beat: a centred kinetic headline over an optional backdrop. */
export const HookScene: React.FC<{
  dur: number;
  label: string;
  wide: Word[][];
  tall: Word[][];
  sub?: React.ReactNode;
  backdrop?: React.ReactNode;
}> = ({ dur, label, wide, tall: tallLines, sub, backdrop }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const lines = tall ? tallLines : wide;
  const chars = Math.max(...lines.map((l) => l.map((w) => w.t).join(' ').length));
  const size = Math.min(tall ? 132 : 150, Math.floor((tall ? 960 : 1600) / (chars * 0.54)));
  const push = 1 + 0.04 * lin(frame, 0, dur);
  return (
    <AbsoluteFill>
      {backdrop}
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: tall ? 260 : 60,
        }}
      >
        <div style={{ transform: `scale(${push})` }}>
          <Headline label={label} lines={lines} sub={sub} size={size} dur={dur} align="center" />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Closing beat: the mark draws, the wordmark and tagline land, then the URL. */
export const OutroScene: React.FC<{ dur: number; tagline: Word[]; note?: string }> = ({
  dur,
  tagline,
  note,
}) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const mark = tall ? 150 : 132;
  const word = tall ? 112 : 104;
  const tagSize = tall ? 66 : 64;
  const reveal = ease(frame, 22, 42);
  const push = 1 + 0.03 * lin(frame, 0, dur);
  const end = 1 - easeIn(frame, dur - 6, dur);
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: tall ? 300 : 70,
        opacity: end,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transform: `scale(${push})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: mark * 0.24 }}>
          <div style={{ transform: `scale(${0.7 + 0.3 * ease(frame, 0, 18)})`, opacity: ease(frame, 0, 8) }}>
            <LogoMark size={mark} chevron={ease(frame, 4, 18)} trench={ease(frame, 12, 28)} />
          </div>
          <div style={{ overflow: 'hidden', width: `${reveal * (word * 5.1)}px`, transition: 'none' }}>
            <span
              style={{
                display: 'inline-block',
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: word,
                letterSpacing: '-0.035em',
                color: C.text,
                whiteSpace: 'nowrap',
                transform: `translateX(${(1 - reveal) * -40}px)`,
              }}
            >
              trenchmart
            </span>
          </div>
        </div>
        <div
          style={{
            marginTop: tall ? 64 : 48,
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: tagSize,
            letterSpacing: '-0.035em',
            textAlign: 'center',
            maxWidth: tall ? 940 : 1500,
            lineHeight: 1.08,
          }}
        >
          {tagline.map((w, i) => {
            const p = ease(frame, 40 + i * 3, 54 + i * 3);
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  overflow: 'hidden',
                  verticalAlign: 'top',
                  paddingBottom: 8,
                  marginBottom: -8,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    color: w.c ?? C.text,
                    transform: `translateY(${(1 - p) * 110}%)`,
                  }}
                >
                  {w.t}
                  {i < tagline.length - 1 ? '\u00a0' : ''}
                </span>
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginTop: tall ? 56 : 44,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            flexDirection: tall ? 'column' : 'row',
            opacity: ease(frame, 62, 76),
            transform: `translateY(${ease(frame, 62, 76, [14, 0])}px)`,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: tall ? 40 : 34,
              color: C.text,
              padding: tall ? '16px 34px' : '13px 30px',
              borderRadius: 999,
              border: `1px solid ${C.accentBorder}`,
              background: C.accentBg,
            }}
          >
            <span style={{ color: C.accent }}>›</span> trenchmart.fun
          </div>
          <div style={{ opacity: ease(frame, 72, 86) }}>
            <DevnetPill size={tall ? 22 : 19} />
          </div>
        </div>
        {note ? (
          <div
            style={{
              marginTop: tall ? 30 : 22,
              fontFamily: MONO,
              fontSize: tall ? 22 : 18,
              letterSpacing: '0.08em',
              color: C.faint,
              opacity: ease(frame, 80, 94),
              textTransform: 'uppercase',
            }}
          >
            {note}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const motion = sceneMotion;
