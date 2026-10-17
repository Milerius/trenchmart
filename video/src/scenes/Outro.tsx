import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { ease, lin, springAt } from '../anim';
import { C, MONO } from '../theme';
import { WORDMARK_D, WORDMARK_TRANSFORM } from '../ui/brand-paths';
import { Headline, useWide } from '../ui/layout';

const VB_W = 328.47;
const DIM_LINE = '#3A4A16';

/** brand/logo-wordmark.svg, built up: tile pops, glyph strokes draw, wordmark wipes in. */
const BuildLogo: React.FC<{ width: number }> = ({ width }) => {
  const frame = useCurrentFrame();
  const unit = width / VB_W;
  const tile = springAt(frame, 0, 11);
  const chevron = ease(frame, 8, 20);
  const trench = ease(frame, 14, 30);
  const slide = ease(frame, 28, 48);
  const reveal = ease(frame, 32, 52);
  const shift = ((VB_W - 64) / 2) * unit * (1 - slide);

  return (
    <svg
      width={width}
      height={64 * unit}
      viewBox={`0 0 ${VB_W} 64`}
      style={{ transform: `translateX(${shift}px)`, overflow: 'visible' }}
    >
      <defs>
        <clipPath id="wm-clip">
          <rect x={64} y={-10} width={(VB_W - 64) * reveal} height={84} />
        </clipPath>
      </defs>
      <g
        style={{
          transform: `scale(${tile}) rotate(${(1 - tile) * -12}deg)`,
          transformOrigin: '32px 32px',
        }}
      >
        <rect width="64" height="64" rx="14" fill={C.accent} />
        <g
          fill="none"
          stroke={C.onAccent}
          strokeWidth="6"
          strokeLinecap="square"
          strokeLinejoin="miter"
        >
          <path
            d="M17 15 27 23 17 31"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - chevron}
            opacity={chevron > 0 ? 1 : 0}
          />
          <path
            d="M11 43H23V51H41V43H53"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - trench}
            opacity={trench > 0 ? 1 : 0}
          />
        </g>
      </g>
      <g clipPath="url(#wm-clip)">
        <g style={{ transform: `translateX(${(1 - reveal) * -24}px)` }}>
          <path transform={WORDMARK_TRANSFORM} fill={C.text} d={WORDMARK_D} />
        </g>
      </g>
    </svg>
  );
};

/** The trench-line motif from the X header, drawn across the frame. */
const TrenchLine: React.FC<{ y: number }> = ({ y }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const seg = width / 6;
  let d = `M0 ${y}`;
  for (let i = 0; i < 6; i++) {
    const a = i * seg + seg * 0.35;
    d += ` H${a} v22 H${a + seg * 0.3} v-22`;
  }
  d += ` H${width}`;
  const draw = ease(frame, 20, 70);
  const sweep = lin(frame, 60, 150, [-0.2, 1.2]);
  return (
    <svg
      width={width}
      height={y + 40}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="sweep" x1="0" x2="1" y1="0" y2="0">
          <stop offset={Math.min(1, Math.max(0, sweep - 0.12))} stopColor={DIM_LINE} />
          <stop offset={Math.min(1, Math.max(0, sweep))} stopColor={C.accent} />
          <stop offset={Math.min(1, Math.max(0, sweep + 0.12))} stopColor={DIM_LINE} />
        </linearGradient>
      </defs>
      <path
        d={d}
        fill="none"
        stroke="url(#sweep)"
        strokeWidth={4}
        strokeLinecap="square"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - draw}
      />
    </svg>
  );
};

export const Outro: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const wide = useWide();
  const url = springAt(frame, 74, 16);
  const meta = ease(frame, 86, 98);
  const caret = Math.floor(frame / 9) % 2 === 0;
  const glow = ease(frame, 0, 40) * 0.1;
  const tagSize = wide ? 84 : 76;

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 50% 40% at 50% 46%, rgba(198,244,50,${glow}) 0%, rgba(198,244,50,0) 70%)`,
        }}
      />
      <TrenchLine y={height - (wide ? 150 : 170)} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          marginTop: wide ? -40 : -10,
        }}
      >
        <BuildLogo width={wide ? 760 : 700} />
        <div style={{ height: wide ? 70 : 64 }} />
        <Headline
          size={tagSize}
          dur={dur + 100}
          delay={48}
          align="center"
          lines={[
            [
              { t: 'Buy' },
              { t: 'the' },
              { t: 'edge,' },
              { t: 'skip', c: C.accent },
              { t: 'the', c: C.accent },
              { t: 'rug.', c: C.accent },
            ],
          ]}
        />
        <div style={{ height: wide ? 44 : 44 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '14px 26px',
            borderRadius: 999,
            border: `1px solid ${C.accentBorder}`,
            background: C.accentBg,
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 34,
            color: C.text,
            opacity: url,
            transform: `translateY(${(1 - url) * 20}px) scale(${0.92 + 0.08 * url})`,
          }}
        >
          <span style={{ color: C.accent, marginRight: 14 }}>›</span>
          trenchmart.fun
          <span
            style={{
              width: 16,
              height: 34,
              marginLeft: 6,
              background: C.accent,
              opacity: caret ? 1 : 0,
            }}
          />
        </div>
        <div
          style={{
            marginTop: 26,
            fontFamily: MONO,
            fontSize: 17,
            letterSpacing: '0.14em',
            color: C.muted,
            opacity: meta,
          }}
        >
          $TRENCH · AI-VERIFIED · SOL ESCROW
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
