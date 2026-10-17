import React from 'react';

type P = { size?: number; color?: string; stroke?: number; style?: React.CSSProperties };

const Svg: React.FC<P & { children: React.ReactNode }> = ({
  size = 16,
  color = 'currentColor',
  stroke = 2,
  style,
  children,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
  >
    {children}
  </svg>
);

export const Check: React.FC<P> = (p) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const Shield: React.FC<P> = (p) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

export const FileCode: React.FC<P> = (p) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="m10 13-2 2 2 2" />
    <path d="m14 17 2-2-2-2" />
  </Svg>
);

export const Upload: React.FC<P> = (p) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </Svg>
);

export const Download: React.FC<P> = (p) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </Svg>
);

/** Padlock whose shackle lifts and swings open as `open` goes 0 → 1. */
export const Lock: React.FC<P & { open?: number }> = ({ open = 0, ...p }) => (
  <Svg {...p}>
    <rect x="4" y="11" width="16" height="11" rx="2" />
    <g
      style={{
        transform: `translateY(${-2.5 * open}px) rotate(${-28 * open}deg)`,
        transformOrigin: '17px 11px',
      }}
    >
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </g>
  </Svg>
);

export const Spinner: React.FC<P & { frame: number }> = ({ frame, ...p }) => (
  <Svg {...p} style={{ ...p.style, transform: `rotate(${frame * 18}deg)` }}>
    <path d="M21 12a9 9 0 1 1-6.2-8.56" />
  </Svg>
);
