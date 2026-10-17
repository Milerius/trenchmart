import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { clamp, ease, lin, sceneMotion, springAt } from '../anim';
import { C, MONO, SANS } from '../theme';
import { Check, Download, FileCode, Lock } from '../ui/icons';
import { Headline, ScreenBackdrop, Stage, useWide } from '../ui/layout';
import { Button, Card, ClickRing, Cursor, Tag } from '../ui/primitives';

const W = 560;
const FF_FROM = 12;
const FF_TO = 54;
const RELEASED = 58;
const CLICK = 86;

export const UnlockCard: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, 0, 18);
  const left = interpolate(frame, [FF_FROM, FF_TO], [41 * 3600 + 59 * 60, 0], {
    ...clamp,
    easing: Easing.bezier(0.5, 0, 0.75, 0.4),
  });
  const hh = Math.floor(left / 3600);
  const mm = Math.floor((left % 3600) / 60);
  const released = frame >= RELEASED;
  const relP = springAt(frame, RELEASED, 12);
  const bar = released
    ? lin(frame, RELEASED, RELEASED + 14, [0.75, 1])
    : lin(left, 0, 41 * 3600 + 59 * 60, [0.75, 0.28]);
  const lockOpen = ease(frame, RELEASED, RELEASED + 8);
  const asDownload = frame >= RELEASED + 8;
  const cursorP = ease(frame, 68, 84);
  const press = frame >= CLICK && frame < CLICK + 6 ? 1 : 0;
  const dl = springAt(frame, CLICK + 4, 16);
  const dlProg = lin(frame, CLICK + 6, CLICK + 22);
  const toast = springAt(frame, RELEASED + 6, 16);
  const ff = frame >= FF_FROM && frame < FF_TO;

  const steps = [
    { k: 'Paid', v: '17 Oct, 01:55 UTC', on: true },
    {
      k: 'In escrow',
      v: released ? 'No dispute' : `${hh}h ${String(mm).padStart(2, '0')}m left`,
      on: true,
    },
    { k: 'Released', v: released ? '19 Oct, 01:55 UTC' : 'Scheduled 19 Oct', on: released },
    { k: 'Download', v: released ? 'Unlocked' : 'Locked', on: released },
  ];

  return (
    <div
      style={{
        position: 'relative',
        width: W,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 60}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: -62,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderRadius: 12,
          background: C.surface,
          border: `1px solid ${C.accentBorder}`,
          fontFamily: SANS,
          fontSize: 13,
          color: C.text,
          opacity: toast,
          transform: `translateY(${(1 - toast) * 14}px)`,
        }}
      >
        <Check size={16} color={C.accent} stroke={2.6} />
        Creator paid
        <span style={{ fontFamily: MONO, fontWeight: 600, color: C.accent }}>1.20 SOL</span>
      </div>

      <Card style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ transform: `scale(${released ? 0.85 + 0.15 * relP : 1})` }}>
              {released ? <Tag tone="ok">✓ Released</Tag> : <Tag tone="ok">● Paid · in escrow</Tag>}
            </span>
            <span style={{ fontFamily: SANS, fontSize: 12, color: C.muted }}>
              bought as Trencher
            </span>
          </div>
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 17, color: C.text }}>
            1.224 SOL
          </span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: 19,
            letterSpacing: '-0.01em',
            color: C.text,
          }}
        >
          Bundle Detector Overlay
        </div>
        <div style={{ marginTop: 4, fontFamily: SANS, fontSize: 12.5, color: C.muted }}>
          Order d8e0a5c9 · paid 17 Oct, 01:55 UTC ·{' '}
          <span style={{ color: C.text2, textDecoration: 'underline' }}>View transaction</span>
        </div>

        <div
          style={{
            marginTop: 16,
            height: 5,
            borderRadius: 3,
            background: C.surface2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${bar * 100}%`,
              height: '100%',
              background: C.accent,
              boxShadow: ff ? `0 0 14px ${C.accent}` : undefined,
            }}
          />
        </div>
        <div style={{ display: 'flex', marginTop: 12 }}>
          {steps.map((s) => (
            <div key={s.k} style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: SANS,
                  fontWeight: 600,
                  fontSize: 13,
                  color: s.on ? C.text : C.muted,
                }}
              >
                {s.k}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  color: s.k === 'In escrow' && ff ? C.accent : C.muted,
                  marginTop: 3,
                }}
              >
                {s.v}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Button
            variant={asDownload ? 'primary' : 'locked'}
            height={44}
            press={press}
            style={{ width: 210, fontSize: 14 }}
          >
            {asDownload ? (
              <>
                <Download size={17} color={C.onAccent} stroke={2.4} /> Download
              </>
            ) : (
              <>
                <Lock size={16} color={C.muted} open={lockOpen} />
                {released ? 'Unlocking' : `Unlocks in ${hh}h ${String(mm).padStart(2, '0')}m`}
              </>
            )}
          </Button>
          <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>
            {released ? 'Escrow released. File is yours.' : 'Open a dispute'}
          </span>
        </div>

        <div
          style={{
            marginTop: 14,
            height: 70,
            boxSizing: 'border-box',
            borderRadius: 10,
            background: C.inset,
            border: `1px solid ${dl > 0 ? C.accentBorder : C.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 14px',
          }}
        >
          {released ? (
            <FileCode size={22} color={C.accent} />
          ) : (
            <Lock size={22} color={C.faint} open={lockOpen} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: released ? C.text : C.muted }}>
                bundle-detector.user.js
              </span>
              {dl > 0 ? (
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>
                  {dlProg < 1 ? `${Math.round(dlProg * 100)}%` : '18.4 KB'}
                </span>
              ) : released ? (
                <Tag tone="ok" size={10}>
                  Ready
                </Tag>
              ) : (
                <Tag tone="neutral" size={10}>
                  Locked
                </Tag>
              )}
            </div>
            <div
              style={{
                marginTop: 6,
                height: 3,
                borderRadius: 2,
                background: C.surface2,
                overflow: 'hidden',
                opacity: dl,
              }}
            >
              <div style={{ width: `${dlProg * 100}%`, height: '100%', background: C.accent }} />
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: MONO,
                fontSize: 11.5,
                color: dlProg >= 1 ? C.accent : C.faint,
              }}
            >
              {dlProg >= 1
                ? '✓ sha256 matches reviewed v1.0.0'
                : released
                  ? 'Watermarked to your wallet'
                  : 'Unlocks when escrow releases'}
            </div>
          </div>
        </div>
      </Card>

      {ff ? (
        <div
          style={{
            position: 'absolute',
            left: 22,
            top: -50,
            fontFamily: MONO,
            fontSize: 13,
            letterSpacing: '0.1em',
            color: C.accent,
            opacity: Math.min(lin(frame, FF_FROM, FF_FROM + 4), 1 - lin(frame, FF_TO - 4, FF_TO)),
          }}
        >
          ▸▸ 48H LATER
        </div>
      ) : null}

      <Cursor
        x={lin(cursorP, 0, 1, [W + 60, 128])}
        y={lin(cursorP, 0, 1, [420, 214])}
        press={press}
        opacity={ease(frame, 66, 72) * (1 - lin(frame, 104, 112))}
      />
      <ClickRing x={130} y={222} t={lin(frame, CLICK, CLICK + 10)} />
    </div>
  );
};

export const UnlockScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const wide = useWide();
  return (
    <AbsoluteFill>
      <ScreenBackdrop src="04-escrow-status.webp" dur={dur} />
      <AbsoluteFill style={sceneMotion(frame, dur)}>
        <Stage
          cardScale={{ square: 1.38, wide: 1.55 }}
          headline={
            <Headline
              label="04 / UNLOCK"
              size={wide ? 92 : 80}
              dur={dur}
              lines={[
                [{ t: 'Trade' }, { t: 'clears.' }],
                [{ t: 'Download' }, { t: 'unlocks.', c: C.accent }],
              ]}
            />
          }
          card={<UnlockCard />}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
