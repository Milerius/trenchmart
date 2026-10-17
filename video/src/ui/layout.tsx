import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ease, easeIn, lin } from '../anim';
import { C, MONO, SANS } from '../theme';
import { LogoMark } from './primitives';

export const useWide = () => {
  const { width, height } = useVideoConfig();
  return width > height;
};

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const glow = 0.1 + 0.025 * Math.sin(frame / 22);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.borderSoft} 1px, transparent 1px), linear-gradient(90deg, ${C.borderSoft} 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          backgroundPosition: `${(width % 60) / 2}px ${(height % 60) / 2}px`,
          maskImage: 'radial-gradient(ellipse 70% 65% at 50% 45%, #000 20%, transparent 100%)',
          opacity: 0.75,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 45% at 50% 48%, rgba(198,244,50,${glow}) 0%, rgba(198,244,50,0) 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** A real app screenshot, dimmed and tilted, drifting behind a scene. */
export const ScreenBackdrop: React.FC<{ src: string; dur: number; focusY?: number }> = ({
  src,
  dur,
  focusY = 30,
}) => {
  const frame = useCurrentFrame();
  const wide = useWide();
  const opacity = Math.min(lin(frame, 0, 14), 1 - lin(frame, dur - 12, dur)) * 0.13;
  const drift = lin(frame, 0, dur, [0, -50]);
  return (
    <AbsoluteFill style={{ perspective: 1600, overflow: 'hidden' }}>
      <Img
        src={staticFile(`screens/${src}`)}
        style={{
          position: 'absolute',
          width: wide ? 2400 : 1800,
          left: '50%',
          top: '50%',
          objectFit: 'cover',
          transform: `translate(-50%, -${focusY}%) translateY(${drift}px) rotateX(18deg) rotateZ(-6deg)`,
          opacity,
          maskImage: 'radial-gradient(ellipse 55% 45% at 50% 62%, #000 25%, transparent 80%)',
        }}
      />
    </AbsoluteFill>
  );
};

const TICKER =
  'SOLANA · LIVE   ●   EVERY VERSION SCANNED, SANDBOXED AND AI-VERIFIED   ●   PAY IN SOL, HELD IN ESCROW   ●   0% CREATOR COMMISSION   ●   $TRENCH HOLDERS: UP TO 100% OFF THE 5% FEE   ●   ';

export const Ticker: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => {
  const frame = useCurrentFrame();
  const wide = useWide();
  const h = wide ? 56 : 46;
  const shift = (frame * 2.2) % 1600;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: h,
        background: C.inset,
        borderTop: `1px solid ${C.borderSoft}`,
        overflow: 'hidden',
        opacity,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          whiteSpace: 'nowrap',
          fontFamily: MONO,
          fontSize: wide ? 18 : 15,
          letterSpacing: '0.06em',
          color: C.muted,
          transform: `translateX(${-shift}px)`,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span key={i}>
            {TICKER.split('●').map((part, j, arr) => (
              <React.Fragment key={j}>
                {part}
                {j < arr.length - 1 ? <span style={{ color: C.accent }}>●</span> : null}
              </React.Fragment>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
};

export const STEPS = ['LIST', 'SCAN', 'ESCROW', 'UNLOCK'] as const;

export const Hud: React.FC<{ step: number; opacity: number }> = ({ step, opacity }) => {
  const wide = useWide();
  return (
    <div
      style={{
        position: 'absolute',
        left: wide ? 80 / 1.3 : 56,
        right: wide ? 80 / 1.3 : 56,
        top: wide ? 48 / 1.3 : 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity,
        zoom: wide ? 1.3 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LogoMark size={36} />
        <span
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 24,
            letterSpacing: '-0.02em',
            color: C.text,
          }}
        >
          TrenchMart
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {STEPS.map((s, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <div
              key={s}
              style={{
                fontFamily: MONO,
                fontSize: 14,
                letterSpacing: '0.06em',
                padding: '7px 12px',
                borderRadius: 999,
                color: active ? C.onAccent : done ? C.accent : C.faint,
                background: active ? C.accent : 'transparent',
                border: `1px solid ${active ? C.accent : done ? C.accentBorder : C.border}`,
                fontWeight: active ? 600 : 500,
              }}
            >
              {done ? '✓ ' : `0${i + 1} `}
              {s}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export type Word = { t: string; c?: string };

/** Kinetic headline: each word rises out of a mask, then lifts away at the end. */
export const Headline: React.FC<{
  label?: string;
  lines: Word[][];
  sub?: React.ReactNode;
  size: number;
  dur: number;
  delay?: number;
  align?: 'left' | 'center';
}> = ({ label, lines, sub, size, dur, delay = 0, align = 'left' }) => {
  const frame = useCurrentFrame();
  let idx = 0;
  const out = easeIn(frame, dur - 12, dur);
  return (
    <div style={{ textAlign: align }}>
      {label ? (
        <div
          style={{
            fontFamily: MONO,
            fontSize: Math.round(size * 0.2),
            letterSpacing: '0.12em',
            color: C.accent,
            marginBottom: size * 0.22,
            opacity: ease(frame, delay, delay + 10) * (1 - out),
            transform: `translateX(${ease(frame, delay, delay + 14, [-20, 0])}px)`,
          }}
        >
          {label}
        </div>
      ) : null}
      {lines.map((line, li) => (
        <div
          key={li}
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: size,
            lineHeight: 1.04,
            letterSpacing: '-0.04em',
            color: C.text,
            whiteSpace: 'nowrap',
          }}
        >
          {line.map((w, wi) => {
            const i = idx++;
            const inP = ease(frame, delay + 3 + i * 3, delay + 17 + i * 3);
            const outP = easeIn(frame, dur - 14 + i * 1.2, dur - 4 + i * 1.2);
            return (
              <span
                key={wi}
                style={{
                  display: 'inline-block',
                  overflow: 'hidden',
                  verticalAlign: 'top',
                  paddingBottom: size * 0.08,
                  marginBottom: -size * 0.08,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    color: w.c ?? C.text,
                    transform: `translateY(${(1 - inP) * 110 - outP * 110}%)`,
                  }}
                >
                  {w.t}
                  {wi < line.length - 1 ? '\u00a0' : ''}
                </span>
              </span>
            );
          })}
        </div>
      ))}
      {sub ? (
        <div
          style={{
            fontFamily: SANS,
            fontSize: Math.round(size * 0.3),
            color: C.text2,
            marginTop: size * 0.26,
            letterSpacing: '-0.01em',
            opacity: ease(frame, delay + 14, delay + 26) * (1 - out),
            transform: `translateY(${ease(frame, delay + 14, delay + 26, [12, 0])}px)`,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Positions a beat's headline and its UI card. Square: headline on top, card below.
 * Wide: headline in the left column, card on the right.
 */
export const Stage: React.FC<{
  headline: React.ReactNode;
  card: React.ReactNode;
  cardScale: { square: number; wide: number };
  cardStyle?: React.CSSProperties;
}> = ({ headline, card, cardScale, cardStyle }) => {
  const wide = useWide();
  return (
    <AbsoluteFill>
      <div
        style={
          wide
            ? {
                position: 'absolute',
                left: 120,
                width: 760,
                top: 110,
                bottom: 60,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }
            : { position: 'absolute', left: 72, right: 72, top: 140 }
        }
      >
        {headline}
      </div>
      <div
        style={{
          position: 'absolute',
          ...(wide
            ? { left: 860, right: 60, top: 110, bottom: 60 }
            : { left: 0, right: 0, top: 350, bottom: 76 }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...cardStyle,
        }}
      >
        <div style={{ transform: `scale(${wide ? cardScale.wide : cardScale.square})` }}>
          {card}
        </div>
      </div>
    </AbsoluteFill>
  );
};
