import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { lin } from '../../anim';
import { C, MONO, SANS } from '../../theme';
import { LogoMark } from '../../ui/primitives';
import { Background } from '../../ui/layout';
import { Captions, type CaptionData } from './captions';
import { useFormat } from './format';
import type { Placed } from './timeline';

export type SceneProps = { dur: number };

/** The live site's header lockup: mark plus the lowercase wordmark. */
export const Wordmark: React.FC<{ size: number; style?: React.CSSProperties }> = ({
  size,
  style,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3, ...style }}>
    <LogoMark size={size} />
    <span
      style={{
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: size * 0.68,
        letterSpacing: '-0.02em',
        color: C.text,
      }}
    >
      trenchmart
    </span>
  </div>
);

export const DevnetPill: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: size * 0.5,
      fontFamily: MONO,
      fontSize: size,
      letterSpacing: '0.08em',
      color: C.warn,
      background: C.warnBg,
      border: `1px solid ${C.warnBorder}`,
      borderRadius: 999,
      padding: `${size * 0.4}px ${size * 0.85}px`,
      whiteSpace: 'nowrap',
    }}
  >
    <span
      style={{ width: size * 0.45, height: size * 0.45, borderRadius: 99, background: C.warn }}
    />
    SOLANA DEVNET
  </span>
);

const TopBar: React.FC<{ chapters: { label: string; from: number }[]; opacity: number }> = ({
  chapters,
  opacity,
}) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const current = chapters.filter((c) => frame >= c.from - 4).length - 1;
  if (tall) {
    return (
      <div style={{ position: 'absolute', left: 64, right: 64, top: 74, opacity }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Wordmark size={54} />
          <DevnetPill size={17} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 34 }}>
          {chapters.map((c, i) => (
            <div key={c.label} style={{ flex: 1 }}>
              <div
                style={{
                  height: 5,
                  borderRadius: 3,
                  background: i <= current ? C.accent : C.border,
                  opacity: i < current ? 0.55 : 1,
                }}
              />
              <div
                style={{
                  marginTop: 12,
                  fontFamily: MONO,
                  fontSize: 17,
                  letterSpacing: '0.08em',
                  color: i === current ? C.accent : i < current ? C.accentLabel : C.faint,
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: 46,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <Wordmark size={46} />
        <DevnetPill size={15} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {chapters.map((c, i) => {
          const active = i === current;
          const done = i < current;
          return (
            <div
              key={c.label}
              style={{
                fontFamily: MONO,
                fontSize: 17,
                letterSpacing: '0.06em',
                padding: '8px 15px',
                borderRadius: 999,
                color: active ? C.onAccent : done ? C.accent : C.faint,
                background: active ? C.accent : 'transparent',
                border: `1px solid ${active ? C.accent : done ? C.accentBorder : C.border}`,
                fontWeight: active ? 600 : 500,
              }}
            >
              {done ? '✓ ' : `0${i + 1} `}
              {c.label}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export type LaunchProps = { audio: boolean };

export const LaunchShell: React.FC<{
  scenes: Placed<string>[];
  components: Record<string, React.FC<SceneProps>>;
  captions: CaptionData;
  audioFile: string;
  audio: boolean;
}> = ({ scenes, components, captions, audioFile, audio }) => {
  const frame = useCurrentFrame();
  const chapters = scenes
    .filter((s) => s.chapter)
    .map((s) => ({ label: s.chapter as string, from: s.from }));
  const outro = scenes[scenes.length - 1];
  const barOpacity = Math.min(lin(frame, 4, 16), 1 - lin(frame, outro.from - 8, outro.from + 4));
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Background />
      {scenes.map((s) => {
        const Scene = components[s.id];
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.dur} name={s.id}>
            <Scene dur={s.dur} />
          </Sequence>
        );
      })}
      <TopBar chapters={chapters} opacity={barOpacity} />
      <Captions data={captions} cuts={scenes.map((s) => s.from)} />
      {audio ? <Html5Audio src={staticFile(audioFile)} /> : null}
    </AbsoluteFill>
  );
};
