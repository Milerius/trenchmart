import React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { clamp, ease } from '../../anim';
import { C, MONO } from '../../theme';

export type Crop = { at: number; x: number; y: number; w: number };
export type Highlight = { x: number; y: number; w: number; h: number; from: number; to?: number };

const CHROME = 46;

const cropAt = (frame: number, keys: Crop[]) => {
  if (frame <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (frame <= b.at) {
      const t = interpolate(frame, [a.at, b.at], [0, 1], {
        ...clamp,
        easing: Easing.bezier(0.65, 0, 0.35, 1),
      });
      return {
        at: frame,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        w: a.w + (b.w - a.w) * t,
      };
    }
  }
  return keys[keys.length - 1];
};

/** A real page capture inside a browser window, panned and zoomed between crop keyframes. */
export const BrowserShot: React.FC<{
  src: string;
  imgW: number;
  url: string;
  width: number;
  height: number;
  crops: Crop[];
  highlights?: Highlight[];
  light?: boolean;
}> = ({ src, imgW, url, width, height, crops, highlights = [], light = false }) => {
  const frame = useCurrentFrame();
  const crop = cropAt(frame, crops);
  const scale = width / crop.w;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 16,
        overflow: 'hidden',
        border: `1px solid ${C.borderStrong}`,
        background: light ? '#fff' : '#0b0d0b',
        boxShadow: '0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: CHROME,
          background: C.surface2,
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 18px',
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span
              key={c}
              style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: 28,
            borderRadius: 8,
            background: C.inset,
            border: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            fontFamily: MONO,
            fontSize: 17,
            color: C.text2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <span style={{ color: C.accent }}>🔒</span>
          {url}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: CHROME,
          bottom: 0,
          overflow: 'hidden',
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            position: 'absolute',
            left: -crop.x * scale,
            top: -crop.y * scale,
            width: imgW * scale,
            maxWidth: 'none',
          }}
        />
        {highlights.map((h, i) => {
          const on =
            ease(frame, h.from, h.from + 10) * (h.to ? 1 - ease(frame, h.to, h.to + 8) : 1);
          if (on <= 0) return null;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: (h.x - crop.x) * scale - 6,
                top: (h.y - crop.y) * scale - 6,
                width: h.w * scale + 12,
                height: h.h * scale + 12,
                borderRadius: 10,
                border: `3px solid ${C.accent}`,
                boxShadow: `0 0 0 4px rgba(198,244,50,0.15), 0 0 30px rgba(198,244,50,0.35)`,
                opacity: on,
                transform: `scale(${1.04 - 0.04 * on})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
