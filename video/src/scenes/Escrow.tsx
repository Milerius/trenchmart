import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { ease, lin, springAt } from '../anim';
import { C, MONO, SANS } from '../theme';
import { Lock, Shield, Spinner } from '../ui/icons';
import { Headline, ScreenBackdrop, Stage, useWide } from '../ui/layout';
import { Button, Card, ClickRing, Cursor, Label } from '../ui/primitives';
import { ESCROW } from '../timeline';

const BOX_W = 360;
const VAULT_W = 250;
const GAP = 20;
const H = 440;
const BTN = { x: BOX_W / 2, y: 328 };
const LOCK = { x: BOX_W + GAP + VAULT_W / 2, y: 102 };

const { click: CLICK, signed: SIGNED, confirmed: CONFIRMED, funded: FUNDED } = ESCROW;

const Row: React.FC<{ k: string; v: string; accent?: boolean; show: number }> = ({
  k,
  v,
  accent,
  show,
}) => (
  <div
    style={{
      height: 26,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: 13,
      opacity: show,
      transform: `translateX(${(1 - show) * -12}px)`,
    }}
  >
    <span style={{ fontFamily: SANS, color: C.text2 }}>{k}</span>
    <span style={{ fontFamily: MONO, color: accent ? C.accent : C.text, fontWeight: 500 }}>
      {v}
    </span>
  </div>
);

const Divider: React.FC<{ m: number }> = ({ m }) => (
  <div style={{ height: 1, background: C.borderSoft, margin: `${m}px 0` }} />
);

const PayButton: React.FC<{ frame: number }> = ({ frame }) => {
  const press = frame >= CLICK && frame < CLICK + 6 ? 1 : 0;
  if (frame < CLICK) return <Button press={press}>Pay into escrow</Button>;
  const state =
    frame < SIGNED
      ? { bg: C.warnBg, line: C.warn, fg: C.warn, body: <>◔ Approve in your wallet</> }
      : frame < CONFIRMED
        ? {
            bg: C.infoBg,
            line: C.info,
            fg: C.info,
            body: (
              <>
                <Spinner frame={frame} size={16} color={C.info} /> Confirming on Solana
              </>
            ),
          }
        : { bg: C.accentBg, line: C.accent, fg: C.accent, body: <>✓ Payment confirmed</> };
  return (
    <Button
      press={press}
      variant="secondary"
      style={{ background: state.bg, borderColor: state.line, color: state.fg }}
    >
      {state.body}
    </Button>
  );
};

const Particles: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    {Array.from({ length: 22 }).map((_, i) => {
      const start = SIGNED + 4 + i * 0.8;
      const t = ease(frame, start, start + 16);
      if (t <= 0 || t >= 1) return null;
      const jx = (random(`px${i}`) - 0.5) * 120;
      const jy = (random(`py${i}`) - 0.5) * 50;
      const x0 = BTN.x + jx;
      const y0 = BTN.y;
      const cx = (x0 + LOCK.x) / 2 + 40;
      const cy = Math.min(y0, LOCK.y) - 90 + jy;
      const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * LOCK.x;
      const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * LOCK.y;
      const s = 8 + 8 * Math.sin(t * Math.PI);
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: x - s / 2,
            top: y - s / 2,
            width: s,
            height: s,
            borderRadius: 2,
            transform: 'rotate(45deg)',
            background: i % 3 === 0 ? C.accentHover : C.accent,
            boxShadow: `0 0 12px ${C.accent}`,
            zIndex: 15,
          }}
        />
      );
    })}
  </>
);

export const EscrowCard: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, 0, 18);
  const vaultIn = springAt(frame, 8, 18);
  const amount = lin(frame, SIGNED + 12, FUNDED, [0, 1.224]);
  const funded = frame >= FUNDED;
  const pulse = springAt(frame, FUNDED, 8);
  const cursorP = ease(frame, ...ESCROW.cursor);
  const secs = 48 * 3600 - 2 - Math.max(0, frame - FUNDED) / 30;
  const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(secs % 60)).padStart(2, '0');

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        gap: GAP,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 60}px)`,
      }}
    >
      <Card style={{ width: BOX_W, height: H, padding: 20, boxSizing: 'border-box' }}>
        <Label style={{ height: 14 }}>Price</Label>
        <div style={{ height: 34, display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 26, color: C.text }}>
            1.20 SOL
          </span>
          <span style={{ fontFamily: MONO, fontSize: 15, color: C.muted }}>≈ $216.00</span>
        </div>
        <div style={{ height: 18, fontFamily: SANS, fontSize: 12, color: C.muted }}>
          Your tier: <span style={{ color: C.accent }}>Trencher</span>
        </div>
        <Divider m={14} />
        <Row k="Listing price" v="1.20 SOL" show={ease(frame, 8, 18)} />
        <Row k="Buyer fee (5%)" v="0.06 SOL" show={ease(frame, 11, 21)} />
        <Row k="Trencher discount" v="−0.036 SOL" accent show={ease(frame, 14, 24)} />
        <Row k="Creator commission" v="0%" accent show={ease(frame, 17, 27)} />
        <Divider m={12} />
        <div
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: ease(frame, 20, 30),
          }}
        >
          <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 14, color: C.text }}>
            You pay
          </span>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 22, color: C.text }}>
            1.224 SOL
          </span>
        </div>
        <div style={{ marginTop: 16 }}>
          <PayButton frame={frame} />
        </div>
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontFamily: SANS,
            fontSize: 12.5,
            color: C.text2,
          }}
        >
          <Shield size={15} color={C.accent} />
          Held in escrow for 1h. Dispute any time.
        </div>
      </Card>

      <Card
        tone={funded ? 'accent' : 'surface'}
        style={{
          width: VAULT_W,
          height: H,
          padding: 20,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: vaultIn,
          transform: `translateX(${(1 - vaultIn) * 40}px)`,
        }}
      >
        <Label style={{ height: 14, color: funded ? C.accentLabel : C.muted }}>
          Escrow · on-chain
        </Label>
        <div
          style={{
            marginTop: 20,
            width: 96,
            height: 96,
            borderRadius: 20,
            border: `1.5px solid ${funded ? C.accent : C.borderStrong}`,
            background: funded ? C.bg : C.inset,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${1 + 0.12 * Math.sin(pulse * Math.PI)})`,
            boxShadow: funded ? `0 0 ${40 * pulse}px ${C.accent}40` : undefined,
          }}
        >
          <Lock size={46} color={funded ? C.accent : C.muted} open={funded ? 0 : 0.6} />
        </div>
        <div
          style={{
            marginTop: 16,
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 26,
            color: funded ? C.accent : C.text,
          }}
        >
          {amount.toFixed(3)} SOL
        </div>
        <div style={{ fontFamily: MONO, fontSize: 13, color: C.muted, marginTop: 2 }}>
          ≈ ${(amount * 180).toFixed(2)}
        </div>
        <div
          style={{ width: '100%', height: 1, background: C.borderSoft, margin: '18px 0 14px' }}
        />
        <Label style={{ color: funded ? C.accentLabel : C.muted }}>Releases in</Label>
        <div
          style={{
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 22,
            color: funded ? C.text : C.faint,
            marginTop: 4,
          }}
        >
          {funded ? `${hh}:${mm}:${ss}` : '48:00:00'}
        </div>
        <div
          style={{
            marginTop: 16,
            fontFamily: MONO,
            fontSize: 12,
            color: C.accentBody,
            opacity: ease(frame, FUNDED + 4, FUNDED + 12),
          }}
        >
          tx 5Kq9…f3Xa <span style={{ color: C.accent }}>✓ confirmed</span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: SANS,
            fontSize: 12,
            color: C.muted,
            textAlign: 'center',
            opacity: ease(frame, FUNDED + 8, FUNDED + 16),
          }}
        >
          Seller can&apos;t touch it until release.
        </div>
      </Card>

      <Particles frame={frame} />
      <Cursor
        x={lin(cursorP, 0, 1, [BOX_W + 120, BTN.x + 30])}
        y={lin(cursorP, 0, 1, [H + 60, BTN.y - 4])}
        press={frame >= CLICK && frame < CLICK + 6 ? 1 : 0}
        opacity={ease(frame, ESCROW.cursor[0] - 2, ESCROW.cursor[0] + 4)}
        away={ease(frame, CLICK + 5, CLICK + 18)}
      />
      <ClickRing x={BTN.x + 32} y={BTN.y - 2} t={lin(frame, CLICK, CLICK + 10)} />
    </div>
  );
};

export const EscrowScene: React.FC<{ dur: number }> = ({ dur }) => {
  const wide = useWide();
  return (
    <AbsoluteFill>
      <ScreenBackdrop src="03-checkout-fee-breakdown.webp" dur={dur} />
      <AbsoluteFill>
        <Stage
          dur={dur}
          cardScale={{ square: 1.3, wide: 1.4 }}
          headline={
            <Headline
              label="03 / ESCROW"
              size={wide ? 112 : 84}
              dur={dur}
              lines={
                wide
                  ? [
                      [{ t: 'SOL' }, { t: 'goes' }],
                      [{ t: 'to' }, { t: 'escrow.', c: C.accent }],
                    ]
                  : [[{ t: 'SOL' }, { t: 'goes' }, { t: 'to' }, { t: 'escrow.', c: C.accent }]]
              }
              sub="Not to the seller. Not yet."
            />
          }
          card={<EscrowCard />}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
