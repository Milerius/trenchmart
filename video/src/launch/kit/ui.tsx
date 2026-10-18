import React from 'react';
import { C, MONO, SANS } from '../../theme';
import type { Tone } from '../../ui/primitives';

export const TONE: Record<Tone, { fg: string; bg: string; line: string }> = {
  ok: { fg: C.accent, bg: C.accentBg, line: C.accentBorder },
  warn: { fg: C.warn, bg: C.warnBg, line: C.warnBorder },
  info: { fg: C.info, bg: C.infoBg, line: C.infoBorder },
  danger: { fg: C.danger, bg: C.dangerBg, line: C.dangerBorder },
  neutral: { fg: C.text2, bg: C.surface2, line: C.border },
};

/** The status square from the live review list. */
export const Square: React.FC<{ tone: Tone; size?: number; children: React.ReactNode }> = ({
  tone,
  size = 36,
  children,
}) => {
  const t = TONE[tone];
  const solid = tone === 'ok';
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: size * 0.24,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: MONO,
        fontWeight: 700,
        fontSize: size * 0.48,
        color: solid ? C.onAccent : t.fg,
        background: solid ? C.accent : t.bg,
        border: `1px solid ${solid ? C.accent : t.line}`,
      }}
    >
      {children}
    </span>
  );
};

export const Panel: React.FC<{
  tone?: Tone | 'surface';
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ tone = 'surface', children, style }) => {
  const t = tone === 'surface' ? { bg: C.surface, line: C.border } : TONE[tone];
  return (
    <div
      style={{
        background: t.bg,
        border: `1px solid ${t.line}`,
        borderRadius: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Row: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  size?: number;
  valueColor?: string;
  style?: React.CSSProperties;
}> = ({ label, value, size = 18, valueColor = C.text, style }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      fontFamily: SANS,
      fontSize: size,
      color: C.text2,
      ...style,
    }}
  >
    <span>{label}</span>
    <span style={{ fontFamily: MONO, color: valueColor, fontWeight: 500 }}>{value}</span>
  </div>
);

export const Divider: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div style={{ height: 1, background: C.borderSoft, ...style }} />
);
