import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { clamp, ease, lin, springAt } from '../anim';
import { C, MONO, SANS } from '../theme';
import { Shield, Spinner } from '../ui/icons';
import { Headline, ScreenBackdrop, Stage, useWide } from '../ui/layout';
import { Card, CheckBox, Label, Tag } from '../ui/primitives';
import { SCAN } from '../timeline';

const W = 540;

const ROWS = [
  { t: 'Static checks', d: '14 rules · 0 findings', s: '0.4 s' },
  { t: 'Sandbox run', d: 'egress blocked · 0 wallet calls', s: '1.9 s' },
  { t: 'AI verdict', d: 'behaviour matches the listing', s: '2.6 s' },
].map((r, i) => ({ ...r, from: SCAN.rows[i][0], to: SCAN.rows[i][1] }));

const CHECKS = [
  'Userscript header',
  'Match scope',
  'No eval',
  'No remote code',
  'No obfuscation',
  'No transaction signing',
  'No key access',
  'No clipboard read',
  'Declared network',
  'Network hosts',
  'No DOM wallet tamper',
  'Sandbox egress',
  'No wallet calls',
  'Permissions match',
  'Behaviour matches',
];

const VERIFIED_AT = SCAN.verified;

export const CheckFlipper: React.FC<{ size: number }> = ({ size }) => {
  const frame = useCurrentFrame();
  const n = Math.min(CHECKS.length, Math.max(1, Math.floor(lin(frame, 16, 90, [1, 16]))));
  const show = ease(frame, 14, 22);
  const done = frame >= VERIFIED_AT;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: size * 0.5,
        opacity: show,
        fontFamily: MONO,
        fontSize: size,
      }}
    >
      <span style={{ color: done ? C.accent : C.text, fontWeight: 600 }}>
        {String(n).padStart(2, '0')}/15
      </span>
      <Tag tone="ok" size={size * 0.85}>
        ✓ PASS
      </Tag>
      <span style={{ color: C.text2, letterSpacing: '0.01em' }}>
        {done ? 'All checks passed' : CHECKS[n - 1]}
      </span>
    </div>
  );
};

export const ScanCard: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, 0, 18);
  const elapsed = interpolate(frame, [14, 36, 62, 90], [0, 0.4, 2.3, 4.9], clamp);
  const verified = frame >= VERIFIED_AT;
  const pop = springAt(frame, VERIFIED_AT, 10);
  const approved = springAt(frame, VERIFIED_AT + 4, 16);
  const beam = lin(frame, ...SCAN.beam);
  const beamOn = frame >= SCAN.beam[0] && frame < VERIFIED_AT;

  return (
    <div
      style={{
        position: 'relative',
        width: W,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 60}px)`,
      }}
    >
      <Card style={{ padding: 22, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: 22,
                letterSpacing: '-0.02em',
                color: C.text,
              }}
            >
              Live AI review
            </div>
            <div style={{ fontFamily: SANS, fontSize: 13, color: C.muted, marginTop: 4 }}>
              Checked the moment it lands.
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Label>Review time</Label>
            <div
              style={{
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: 28,
                color: verified ? C.accent : C.text,
                marginTop: 2,
              }}
            >
              {elapsed.toFixed(1)} s
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            height: 46,
            borderRadius: 10,
            background: C.inset,
            border: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 10,
            fontFamily: MONO,
            fontSize: 13,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: C.text }}>bundle-detector.user.js</span>
          <span style={{ color: C.muted }}>v1.0.0</span>
          <span
            style={{ marginLeft: 'auto', transform: `scale(${verified ? 0.8 + 0.2 * pop : 1})` }}
          >
            {verified ? (
              <Tag tone="ok">✓ AI-verified</Tag>
            ) : (
              <Tag tone="info">◑ AI review · {frame < 62 ? 'checks' : 'verdict'}</Tag>
            )}
          </span>
        </div>

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ROWS.map((r) => {
            const running = frame >= r.from && frame < r.to;
            const done = frame >= r.to;
            const doneP = springAt(frame, r.to, 12);
            return (
              <div
                key={r.t}
                style={{
                  height: 56,
                  borderRadius: 10,
                  border: `1px solid ${done ? C.accentBorder : running ? C.infoBorder : C.border}`,
                  background: done ? C.accentBg : running ? C.infoBg : C.surface,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0 14px',
                }}
              >
                {done ? (
                  <CheckBox size={20} on={doneP} />
                ) : running ? (
                  <Spinner frame={frame} size={20} color={C.info} />
                ) : (
                  <CheckBox size={20} on={0} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 14, color: C.text }}>
                    {r.t}
                    <span style={{ fontWeight: 400, color: C.muted }}>
                      {done ? ' · done' : running ? ' · running' : ''}
                    </span>
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted, marginTop: 2 }}>
                    {r.d}
                  </div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 13, color: done ? C.text2 : C.faint }}>
                  {done ? r.s : running ? '…' : ''}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 12,
            height: 60,
            borderRadius: 12,
            background: C.accentBg,
            border: `1px solid ${C.accentBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 14px',
            opacity: approved,
            transform: `translateY(${(1 - approved) * 16}px)`,
          }}
        >
          <Shield size={26} color={C.accent} />
          <div>
            <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 15, color: C.text }}>
              Approved and live
            </div>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: C.accentBody, marginTop: 2 }}>
              15 of 15 checks passed · hash pinned to the listing
            </div>
          </div>
        </div>

        {beamOn ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${beam * 100}%`,
              height: 90,
              marginTop: -90,
              background: `linear-gradient(180deg, rgba(198,244,50,0) 0%, rgba(198,244,50,0.10) 85%, rgba(198,244,50,0.55) 100%)`,
              borderBottom: `2px solid ${C.accent}`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </Card>
      {verified ? (
        <div
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: 16,
            border: `2px solid ${C.accent}`,
            opacity: 1 - lin(frame, VERIFIED_AT, VERIFIED_AT + 18),
            transform: `scale(${1 + 0.05 * lin(frame, VERIFIED_AT, VERIFIED_AT + 18)})`,
          }}
        />
      ) : null}
    </div>
  );
};

export const ScanScene: React.FC<{ dur: number }> = ({ dur }) => {
  const wide = useWide();
  return (
    <AbsoluteFill>
      <ScreenBackdrop src="06-live-ai-review.webp" dur={dur} />
      <AbsoluteFill>
        <Stage
          dur={dur}
          cardScale={{ square: 1.38, wide: 1.6 }}
          headline={
            <Headline
              label="02 / AI SCAN"
              size={wide ? 112 : 84}
              dur={dur}
              lines={
                wide
                  ? [[{ t: 'Verified' }], [{ t: 'in' }, { t: 'seconds.', c: C.accent }]]
                  : [[{ t: 'Verified' }, { t: 'in' }, { t: 'seconds.', c: C.accent }]]
              }
              sub={<CheckFlipper size={wide ? 26 : 22} />}
            />
          }
          card={<ScanCard />}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
