import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ease, lin, sceneMotion, springAt, typed } from '../anim';
import { C, MONO, SANS } from '../theme';
import { FileCode, Spinner, Upload } from '../ui/icons';
import { Headline, ScreenBackdrop, Stage, useWide } from '../ui/layout';
import { Button, Card, ClickRing, Cursor, Label, Tag } from '../ui/primitives';

const W = 520;
const TITLE = 'Bundle Detector Overlay';
const CATS = [
  { t: 'USERSCRIPT', fg: C.accent, bg: '#141A10' },
  { t: 'WALLET LIST', fg: C.info, bg: '#0F1620' },
  { t: 'BOT CONFIG', fg: C.warn, bg: '#1C160A' },
];

const Field: React.FC<{ label: string; children: React.ReactNode; show: number }> = ({
  label,
  children,
  show,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      height: 44,
      opacity: show,
      transform: `translateY(${(1 - show) * 10}px)`,
    }}
  >
    <div style={{ width: 96, fontFamily: SANS, fontSize: 13, color: C.muted }}>{label}</div>
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
  </div>
);

const Input: React.FC<{
  children: React.ReactNode;
  focus?: boolean;
  style?: React.CSSProperties;
}> = ({ children, focus, style }) => (
  <div
    style={{
      height: 40,
      flex: 1,
      borderRadius: 10,
      background: C.inset,
      border: `1px solid ${focus ? C.accent : C.border}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      fontFamily: SANS,
      fontSize: 15,
      color: C.text,
      ...style,
    }}
  >
    {children}
  </div>
);

const Caret: React.FC<{ frame: number; on: boolean }> = ({ frame, on }) =>
  on ? (
    <span
      style={{
        width: 2,
        height: 18,
        marginLeft: 1,
        background: C.accent,
        opacity: Math.floor(frame / 6) % 2 ? 0.2 : 1,
      }}
    />
  ) : null;

export const ListCard: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, 0, 18);

  const fly = springAt(frame, 12, 16);
  const upload = lin(frame, 26, 44);
  const shaN = typed(frame, '2e59f5ba…9ce957', 44, 54);
  const title = typed(frame, TITLE, 52, 76);
  const catPick = springAt(frame, 78, 14);
  const price = lin(frame, 84, 100, [0, 1.2]);
  const cursorP = ease(frame, 94, 112);
  const click = lin(frame, 113, 122);
  const pressed = frame >= 113 && frame < 119 ? 1 : 0;
  const started = frame >= 117;

  return (
    <div
      style={{
        position: 'relative',
        width: W,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 60}px)`,
      }}
    >
      <Card style={{ padding: 24, height: 456, boxSizing: 'border-box' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            height: 52,
          }}
        >
          <div>
            <Label>Creator studio</Label>
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: 22,
                letterSpacing: '-0.02em',
                color: C.text,
                marginTop: 4,
              }}
            >
              New listing
            </div>
          </div>
          <Tag tone="ok">0% commission</Tag>
        </div>

        <div
          style={{
            marginTop: 18,
            height: 96,
            borderRadius: 12,
            background: C.inset,
            border: `1.5px dashed ${upload > 0 ? C.accentBorder : C.borderStrong}`,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              color: C.muted,
              fontFamily: SANS,
              fontSize: 14,
              opacity: 1 - lin(frame, 18, 26),
            }}
          >
            <Upload size={18} color={C.muted} />
            Drop your file
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>
              .js · .json · .csv
            </span>
          </div>
          <div
            style={{
              position: 'absolute',
              left: 16,
              right: 16,
              top: 16,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              opacity: Math.min(1, fly * 1.5),
              transform: `translate(${(1 - fly) * 260}px, ${(1 - fly) * -120}px) rotate(${(1 - fly) * 8}deg)`,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: C.accentBg,
                border: `1px solid ${C.accentBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileCode size={20} color={C.accent} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: MONO, fontSize: 14, color: C.text }}>
                  bundle-detector.user.js
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>
                  {upload < 1 ? `${Math.round(upload * 100)}%` : '18.4 KB'}
                </span>
              </div>
              <div
                style={{
                  marginTop: 8,
                  height: 4,
                  borderRadius: 2,
                  background: C.surface2,
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: `${upload * 100}%`, height: '100%', background: C.accent }} />
              </div>
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              left: 68,
              bottom: 14,
              fontFamily: MONO,
              fontSize: 12,
              color: C.accentLabel,
            }}
          >
            {shaN ? (
              <>
                sha256 {shaN}
                {shaN.length > 14 ? <span style={{ color: C.accent }}> · pinned</span> : null}
              </>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title" show={ease(frame, 44, 54)}>
            <Input focus={frame >= 52 && frame < 80}>
              {title}
              <Caret frame={frame} on={frame >= 50 && frame < 80} />
            </Input>
          </Field>
          <Field label="Category" show={ease(frame, 48, 58)}>
            {CATS.map((c, i) => {
              const on = i === 0 ? catPick : 0;
              return (
                <span
                  key={c.t}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    padding: '8px 10px',
                    borderRadius: 6,
                    color: on > 0.5 ? c.fg : C.muted,
                    background: on > 0.5 ? c.bg : C.inset,
                    border: `1px solid ${on > 0.5 ? c.fg : C.border}`,
                    transform: `scale(${1 + 0.06 * Math.sin(on * Math.PI)})`,
                  }}
                >
                  {on > 0.5 ? '✓ ' : ''}
                  {c.t}
                </span>
              );
            })}
          </Field>
          <Field label="Price" show={ease(frame, 52, 62)}>
            <Input focus={frame >= 84 && frame < 102} style={{ flex: 'none', width: 150 }}>
              <span style={{ fontFamily: MONO, fontWeight: 600 }}>{price.toFixed(2)}</span>
              <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 13, color: C.muted }}>
                SOL
              </span>
            </Input>
            <span style={{ fontFamily: MONO, fontSize: 13, color: C.muted }}>
              ≈ ${(price * 180).toFixed(2)}
            </span>
          </Field>
        </div>

        <div style={{ marginTop: 20 }}>
          <Button press={pressed} style={{ opacity: ease(frame, 60, 72) }}>
            {started ? (
              <>
                <Spinner frame={frame} size={16} color={C.onAccent} stroke={2.4} />
                Starting AI review
              </>
            ) : (
              'Submit for AI review  →'
            )}
          </Button>
        </div>
      </Card>
      <Cursor
        x={lin(cursorP, 0, 1, [W + 40, W / 2 + 40])}
        y={lin(cursorP, 0, 1, [500, 402])}
        press={pressed}
        opacity={ease(frame, 92, 98) * (1 - lin(frame, 124, 130))}
      />
      <ClickRing x={W / 2 + 42} y={404} t={click} />
    </div>
  );
};

export const ListScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const wide = useWide();
  return (
    <AbsoluteFill>
      <ScreenBackdrop src="05-creator-dashboard.webp" dur={dur} />
      <AbsoluteFill style={sceneMotion(frame, dur)}>
        <Stage
          cardScale={{ square: 1.34, wide: 1.6 }}
          headline={
            <Headline
              label="01 / LIST"
              size={wide ? 112 : 84}
              dur={dur}
              lines={
                wide
                  ? [[{ t: 'List' }, { t: 'your' }], [{ t: 'edge.', c: C.accent }]]
                  : [[{ t: 'List' }, { t: 'your' }, { t: 'edge.', c: C.accent }]]
              }
              sub="Scripts, bot configs, wallet trackers."
            />
          }
          card={<ListCard />}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
