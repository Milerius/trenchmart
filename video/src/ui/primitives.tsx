import React from 'react';
import { C, MONO, SANS } from '../theme';

/** brand/logo-mark.svg, with optional stroke-draw progress for the two glyph strokes. */
export const LogoMark: React.FC<{
  size: number;
  chevron?: number;
  trench?: number;
  style?: React.CSSProperties;
}> = ({ size, chevron = 1, trench = 1, style }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" style={style}>
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
  </svg>
);

export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  tone?: 'surface' | 'accent';
}> = ({ children, style, tone = 'surface' }) => (
  <div
    style={{
      background: tone === 'accent' ? C.accentBg : C.surface,
      border: `1px solid ${tone === 'accent' ? C.accentBorder : C.border}`,
      borderRadius: 14,
      ...style,
    }}
  >
    {children}
  </div>
);

export type Tone = 'ok' | 'warn' | 'info' | 'danger' | 'neutral';

const TONES: Record<Tone, { fg: string; bg: string; line: string }> = {
  ok: { fg: C.accent, bg: C.accentBg, line: C.accentBorder },
  warn: { fg: C.warn, bg: C.warnBg, line: C.warnBorder },
  info: { fg: C.info, bg: C.infoBg, line: C.infoBorder },
  danger: { fg: C.danger, bg: C.dangerBg, line: C.dangerBorder },
  neutral: { fg: C.text2, bg: C.surface2, line: C.border },
};

export const Tag: React.FC<{
  children: React.ReactNode;
  tone?: Tone;
  size?: number;
  style?: React.CSSProperties;
}> = ({ children, tone = 'neutral', size = 11, style }) => {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: MONO,
        fontSize: size,
        fontWeight: 500,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.line}`,
        borderRadius: 6,
        padding: `${size * 0.32}px ${size * 0.72}px`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
};

export const CheckBox: React.FC<{ size?: number; on?: number }> = ({ size = 18, on = 1 }) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: 5,
      flex: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: on > 0.5 ? C.accent : 'transparent',
      border: `1.5px solid ${on > 0.5 ? C.accent : C.borderStrong}`,
      color: C.onAccent,
      fontFamily: MONO,
      fontWeight: 700,
      fontSize: size * 0.62,
      transform: `scale(${0.6 + 0.4 * on})`,
    }}
  >
    {on > 0.5 ? '✓' : ''}
  </span>
);

export const Button: React.FC<{
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'locked';
  height?: number;
  press?: number;
  style?: React.CSSProperties;
}> = ({ children, variant = 'primary', height = 48, press = 0, style }) => {
  const primary = variant === 'primary';
  return (
    <div
      style={{
        height,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: 15,
        background: primary ? C.accent : variant === 'locked' ? C.surface2 : 'transparent',
        color: primary ? C.onAccent : variant === 'locked' ? C.muted : C.text,
        border: primary ? 'none' : `1px solid ${C.borderStrong}`,
        transform: `scale(${1 - 0.04 * press})`,
        boxShadow: primary ? `0 0 ${24 * press}px ${C.accent}55` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * macOS-style pointer; (x, y) is the tip. `press` shrinks it for a click and `away` (0 → 1)
 * moves it off the label it just clicked and fades it out.
 */
export const Cursor: React.FC<{
  x: number;
  y: number;
  press?: number;
  opacity?: number;
  away?: number;
}> = ({ x, y, press = 0, opacity = 1, away = 0 }) => (
  <svg
    width={26}
    height={26}
    viewBox="0 0 24 24"
    style={{
      position: 'absolute',
      left: x + 90 * away,
      top: y + 60 * away,
      opacity: opacity * (1 - away),
      transform: `scale(${1 - 0.15 * press})`,
      transformOrigin: '3px 2px',
      filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.6))',
      zIndex: 20,
    }}
  >
    <path
      d="M3 2l7.5 19 2.2-7.6L20.5 11z"
      fill={C.text}
      stroke={C.bg}
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  </svg>
);

/** Ring that expands from a click point. */
export const ClickRing: React.FC<{ x: number; y: number; t: number }> = ({ x, y, t }) =>
  t <= 0 || t >= 1 ? null : (
    <div
      style={{
        position: 'absolute',
        left: x - 30 * t,
        top: y - 30 * t,
        width: 60 * t,
        height: 60 * t,
        borderRadius: '50%',
        border: `2px solid ${C.accent}`,
        opacity: 1 - t,
        zIndex: 19,
      }}
    />
  );

export const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: C.muted,
      ...style,
    }}
  >
    {children}
  </div>
);
