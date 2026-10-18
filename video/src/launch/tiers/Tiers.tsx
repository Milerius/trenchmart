import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ease, lin } from '../../anim';
import { C, MONO, SANS } from '../../theme';
import { Button, Card, Label, Tag } from '../../ui/primitives';
import { useFormat } from '../kit/format';
import { HookScene, OutroScene } from '../kit/scenes';
import { LaunchShell, type LaunchProps, type SceneProps } from '../kit/shell';
import { LStage } from '../kit/stage';
import { Divider, Panel, Row } from '../kit/ui';
import captions from './captions.json';
import { CHECKOUT, FEE, HOOK_T, LADDER, TIERS, WINDOW } from './timeline';

const CARD_W = 860;

/** The buyer fee counting down through the tiers, huge and faint behind the hook. */
const FeeBackdrop: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const steps = [5, 3.75, 2, 0];
  const p = lin(frame, HOOK_T.count[0], HOOK_T.count[1], [0, steps.length - 1]);
  const i = Math.floor(p);
  const t = ease(p - i, 0, 0.35);
  const fee = i >= steps.length - 1 ? 0 : steps[i] + (steps[i + 1] - steps[i]) * t;
  const fade = Math.min(ease(frame, 0, 14), 1 - ease(frame, dur - 14, dur - 2));
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: tall ? 260 : 40,
        opacity: fade * 0.09,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: tall ? 300 : 460,
          color: C.accent,
          letterSpacing: '-0.05em',
        }}
      >
        {fee.toFixed(2)}%
      </div>
    </AbsoluteFill>
  );
};

const Hook: React.FC<SceneProps> = ({ dur }) => (
  <HookScene
    dur={dur}
    label="$TRENCH TIERS"
    wide={[
      [{ t: 'Hold' }, { t: '$TRENCH.' }],
      [{ t: 'Pay' }, { t: 'lower' }, { t: 'fees.', c: C.accent }],
    ]}
    tall={[
      [{ t: 'Hold' }, { t: '$TRENCH.' }],
      [{ t: 'Pay' }, { t: 'lower' }, { t: 'fees.', c: C.accent }],
    ]}
    backdrop={<FeeBackdrop dur={dur} />}
  />
);

const Side: React.FC<{
  show: number;
  big: string;
  bigColor: string;
  title: string;
  rows: [string, string, string?][];
  total: [string, string];
}> = ({ show, big, bigColor, title, rows, total }) => (
  <Panel
    style={{ flex: 1, padding: 26, opacity: show, transform: `translateY(${(1 - show) * 24}px)` }}
  >
    <Label style={{ fontSize: 16 }}>{title}</Label>
    <div
      style={{
        fontFamily: MONO,
        fontSize: 76,
        fontWeight: 700,
        color: bigColor,
        letterSpacing: '-0.04em',
        marginTop: 8,
      }}
    >
      {big}
    </div>
    <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
      {rows.map(([k, v, c]) => (
        <Row key={k} label={k} value={v} size={20} valueColor={c ?? C.text} />
      ))}
    </div>
    <Divider style={{ margin: '16px 0 12px' }} />
    <Row label={total[0]} value={total[1]} size={21} style={{ color: C.text, fontWeight: 600 }} />
  </Panel>
);

const FeeCard: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ width: CARD_W }}>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 21,
          color: C.text2,
          marginBottom: 16,
          opacity: ease(frame, 0, 10),
        }}
      >
        Trojan Trenches Intel · listed at{' '}
        <span style={{ fontFamily: MONO, color: C.text }}>0.10 SOL</span>
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        <Side
          show={ease(frame, FEE.buyer, FEE.buyer + 12)}
          big="5%"
          bigColor={C.text}
          title="Buyer pays"
          rows={[
            ['Listing price', '0.10 SOL'],
            ['Buyer fee (5%)', '+0.005 SOL'],
          ]}
          total={['You pay', '0.105 SOL']}
        />
        <Side
          show={ease(frame, FEE.creator, FEE.creator + 12)}
          big="0%"
          bigColor={C.accent}
          title="Creator receives"
          rows={[
            ['Listing price', '0.10 SOL'],
            ['Creator commission', '0%', C.accent],
          ]}
          total={['Creator gets', '0.10 SOL']}
        />
      </div>
    </div>
  );
};

const FeeScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '01 / THE FEE',
      wide: [
        [{ t: '5%' }, { t: 'on' }, { t: 'top.' }],
        [{ t: '0%' }, { t: 'for' }],
        [{ t: 'creators.', c: C.accent }],
      ],
      tall: [
        [{ t: '5%' }, { t: 'on' }, { t: 'top.' }],
        [{ t: '0%' }, { t: 'for' }, { t: 'creators.', c: C.accent }],
      ],
      sub: 'The creator receives the full listing price.',
    }}
    card={<FeeCard />}
    scale={{ wide: 1.06, tall: 1.14 }}
    tallCardTop={600}
  />
);

const TIER_ROWS = [
  { name: 'No tier', hold: 'under 100K', off: '—', fee: 5 },
  { name: 'Scout', hold: '100K+', off: '25% off', fee: 3.75 },
  { name: 'Trencher', hold: '1M+', off: '60% off', fee: 2 },
  { name: 'OG', hold: '10M+', off: '100% off', fee: 0 },
];

const LadderCard: React.FC = () => {
  const frame = useCurrentFrame();
  const at = [0, LADDER.scout, LADDER.trencher, LADDER.og];
  const offAt = [0, LADDER.scoutOff, LADDER.trencherOff, LADDER.ogOff];
  const active = at.filter((f) => frame >= f).length - 1;
  const fee = TIER_ROWS.reduce(
    (v, r, i) =>
      i === 0 ? r.fee : v + (r.fee - TIER_ROWS[i - 1].fee) * ease(frame, offAt[i], offAt[i] + 14),
    0,
  );
  return (
    <Card style={{ width: CARD_W, padding: 30, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label style={{ fontSize: 16 }}>Hold $TRENCH · buyer fee</Label>
        <Tag size={16}>lowest balance, last 72 h</Tag>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
        {TIER_ROWS.map((r, i) => {
          const on = i === active;
          const reached = i <= active;
          const show = i === 0 ? 1 : ease(frame, at[i] - 6, at[i] + 6, [0.35, 1]);
          const off = ease(frame, offAt[i], offAt[i] + 10);
          return (
            <div
              key={r.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '220px 1fr 170px 120px',
                alignItems: 'center',
                padding: '16px 22px',
                borderRadius: 12,
                border: `1px solid ${on ? C.accent : C.border}`,
                background: on ? C.accentBg : C.surface,
                boxShadow: on ? `0 0 30px ${C.accent}22` : undefined,
                opacity: show * (reached && !on ? 0.7 : 1),
              }}
            >
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 26,
                  fontWeight: 600,
                  color: on ? C.accent : C.text,
                }}
              >
                {r.name}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 21, color: C.text2 }}>{r.hold}</span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 21,
                  color: i === 0 ? C.muted : C.accent,
                  opacity: i === 0 ? 1 : 0.35 + 0.65 * off,
                }}
              >
                {r.off}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 24,
                  fontWeight: 600,
                  color: C.text,
                  textAlign: 'right',
                }}
              >
                {r.fee}%
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <Label style={{ fontSize: 15 }}>Fee on a 0.10 SOL listing</Label>
          <div
            style={{
              marginTop: 12,
              height: 14,
              borderRadius: 7,
              background: C.border,
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${(fee / 5) * 100}%`, height: '100%', background: C.accent }} />
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 300 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 48,
              fontWeight: 700,
              color: fee < 0.01 ? C.accent : C.text,
            }}
          >
            {fee < 0.001 ? 'no fee' : `${((0.1 * fee) / 100).toFixed(5).replace(/0+$/, '')} SOL`}
          </div>
        </div>
      </div>
    </Card>
  );
};

const LadderScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '02 / TIERS',
      wide: [
        [{ t: 'Hold' }, { t: 'more.' }],
        [{ t: 'Pay' }, { t: 'less.', c: C.accent }],
      ],
      tall: [[{ t: 'Hold' }, { t: 'more.' }, { t: 'Pay' }, { t: 'less.', c: C.accent }]],
      sub: 'Scout, Trencher and OG take 25%, 60% and 100% off the 5% buyer fee.',
    }}
    card={<LadderCard />}
    scale={{ wide: 1.06, tall: 1.14 }}
    tallCardTop={560}
  />
);

const CheckoutCard: React.FC = () => {
  const frame = useCurrentFrame();
  const tierOn = ease(frame, CHECKOUT.tier, CHECKOUT.tier + 10);
  const discount = ease(frame, CHECKOUT.discount, CHECKOUT.discount + 12);
  const total = lin(ease(frame, CHECKOUT.total, CHECKOUT.total + 14), 0, 1, [0.105, 0.102]);
  const sign = Math.sin(Math.min(1, Math.max(0, (frame - CHECKOUT.sign) / 16)) * Math.PI);
  return (
    <Card style={{ width: CARD_W, padding: 32, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Label style={{ fontSize: 16 }}>Checkout</Label>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 30,
              fontWeight: 600,
              color: C.text,
              marginTop: 6,
              letterSpacing: '-0.02em',
            }}
          >
            Trojan Trenches Intel
          </div>
        </div>
        <span style={{ opacity: tierOn, transform: `scale(${0.8 + 0.2 * tierOn})` }}>
          <Tag tone="ok" size={18}>
            tier · Trencher
          </Tag>
        </span>
      </div>
      <Divider style={{ margin: '22px 0' }} />
      <div style={{ display: 'grid', gap: 14 }}>
        <Row label="Listing price" value="0.10 SOL" size={23} />
        <Row label="Buyer fee (5%)" value="0.005 SOL" size={23} />
        <div style={{ position: 'relative', height: 30 }}>
          <Row
            label="Your tier discount"
            value={
              <span style={{ color: C.info, fontFamily: SANS, fontSize: 20 }}>
                Connect to apply
              </span>
            }
            size={23}
            style={{ position: 'absolute', inset: 0, opacity: 1 - discount }}
          />
          <Row
            label="Trencher discount (60% off the fee)"
            value="−0.003 SOL"
            valueColor={C.accent}
            size={23}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: discount,
              transform: `translateX(${(1 - discount) * -16}px)`,
            }}
          />
        </div>
        <Row label="Creator commission" value="0%" size={23} valueColor={C.accent} />
      </div>
      <Divider style={{ margin: '20px 0 16px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: SANS, fontSize: 24, fontWeight: 600, color: C.text }}>
          {discount > 0.5 ? 'You pay' : 'You pay (before discount)'}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 38,
            fontWeight: 700,
            color: discount > 0.5 ? C.accent : C.text,
          }}
        >
          {total.toFixed(3)} SOL
        </span>
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 19,
          color: C.muted,
          marginTop: 10,
          opacity: ease(frame, CHECKOUT.locked, CHECKOUT.locked + 10),
        }}
      >
        Quote locked for tier Trencher
      </div>
      <div style={{ marginTop: 20 }}>
        <Button
          height={66}
          style={{
            fontSize: 23,
            boxShadow: `0 0 ${40 * sign}px ${C.accent}66`,
            transform: `scale(${1 + 0.03 * sign})`,
          }}
        >
          Pay into escrow
        </Button>
      </div>
    </Card>
  );
};

const CheckoutScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '03 / CHECKOUT',
      wide: [[{ t: 'Applied' }], [{ t: 'before' }, { t: 'you' }], [{ t: 'sign.', c: C.accent }]],
      tall: [
        [{ t: 'Applied' }, { t: 'before' }],
        [{ t: 'you' }, { t: 'sign.', c: C.accent }],
      ],
      sub: 'The discount is in the quote, and in the escrow.',
    }}
    card={<CheckoutCard />}
    scale={{ wide: 1.04, tall: 1.14 }}
    tallCardTop={580}
  />
);

// Hourly balance over the last 72 h: a steady ~300K holder who buys 12M two hours ago.
const SERIES = Array.from({ length: 73 }, (_, h) => {
  if (h >= 71) return 12_000_000;
  if (h === 70) return 2_500_000;
  const wobble = Math.sin(h * 0.45) * 60_000 + Math.sin(h * 1.7) * 25_000;
  return 300_000 + wobble - (h > 26 && h < 34 ? 70_000 * Math.sin(((h - 26) / 8) * Math.PI) : 0);
});
const LOW_H = SERIES.reduce((best, v, i) => (v < SERIES[best] ? i : best), 0);
const LOW = SERIES[LOW_H];

const WindowCard: React.FC = () => {
  const frame = useCurrentFrame();
  const W = 796;
  const H = 300;
  const y = (v: number) => H - ((Math.log10(v) - 4.7) / (7.4 - 4.7)) * H;
  const x = (h: number) => (h / 72) * W;
  const draw = lin(frame, WINDOW.draw[0], WINDOW.draw[1]);
  const path = SERIES.map((v, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)} ${y(v).toFixed(1)}`).join(
    ' ',
  );
  const low = ease(frame, WINDOW.low, WINDOW.low + 12);
  const result = ease(frame, WINDOW.result, WINDOW.result + 12);
  const lines = [
    { v: 100_000, label: 'Scout 100K' },
    { v: 1_000_000, label: 'Trencher 1M' },
    { v: 10_000_000, label: 'OG 10M' },
  ];
  return (
    <Card style={{ width: CARD_W, padding: 32, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label style={{ fontSize: 16 }}>Your $TRENCH balance · last 72 h</Label>
        <Tag size={16}>read from Solana devnet</Tag>
      </div>
      <svg
        width={W}
        height={H + 30}
        style={{ display: 'block', marginTop: 20, overflow: 'visible' }}
      >
        {lines.map((l) => (
          <g key={l.v}>
            <line
              x1={0}
              x2={W}
              y1={y(l.v)}
              y2={y(l.v)}
              stroke={C.borderStrong}
              strokeDasharray="6 6"
            />
            <text x={4} y={y(l.v) - 8} fill={C.muted} fontFamily={MONO} fontSize={17}>
              {l.label}
            </text>
          </g>
        ))}
        <path
          d={path}
          fill="none"
          stroke={C.text}
          strokeWidth={3}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - draw}
        />
        <g opacity={low}>
          <line x1={0} x2={W} y1={y(LOW)} y2={y(LOW)} stroke={C.accent} strokeWidth={2} />
          <circle cx={x(LOW_H)} cy={y(LOW)} r={9} fill={C.accent} />
          <text x={x(LOW_H) + 18} y={y(LOW) + 30} fill={C.accent} fontFamily={MONO} fontSize={20}>
            lowest · {Math.round(LOW / 1000)}K
          </text>
        </g>
        <text
          x={x(70.5)}
          y={y(12_000_000) - 16}
          textAnchor="end"
          fill={C.warn}
          fontFamily={MONO}
          fontSize={18}
          opacity={lin(frame, WINDOW.spike[1], WINDOW.spike[1] + 8)}
        >
          bought 12M, 2 h ago
        </text>
        <text x={0} y={H + 28} fill={C.muted} fontFamily={MONO} fontSize={17}>
          72 h ago
        </text>
        <text x={W} y={H + 28} textAnchor="end" fill={C.muted} fontFamily={MONO} fontSize={17}>
          now
        </text>
      </svg>
      <Panel
        tone="ok"
        style={{
          marginTop: 22,
          padding: '18px 22px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: result,
          transform: `translateY(${(1 - result) * 14}px)`,
        }}
      >
        <div>
          <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 600, color: C.text }}>
            Your tier: Scout
          </div>
          <div style={{ fontFamily: SANS, fontSize: 19, color: C.accentBody, marginTop: 4 }}>
            The 12M only counts once it has been held for 72 hours.
          </div>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 24, color: C.accent }}>25% off</span>
      </Panel>
    </Card>
  );
};

const WindowScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '04 / 72 H WINDOW',
      wide: [[{ t: 'Your' }, { t: 'lowest' }], [{ t: 'balance' }], [{ t: 'counts.', c: C.accent }]],
      tall: [[{ t: 'Your' }, { t: 'lowest' }, { t: 'balance' }], [{ t: 'counts.', c: C.accent }]],
      sub: 'No flash-buy games.',
    }}
    card={<WindowCard />}
    scale={{ wide: 1.04, tall: 1.14 }}
    tallCardTop={560}
  />
);

const Outro: React.FC<SceneProps> = ({ dur }) => (
  <OutroScene
    dur={dur}
    tagline={[{ t: 'Hold' }, { t: 'more.' }, { t: 'Pay' }, { t: 'less.', c: C.accent }]}
    note="Tiers live on devnet · $TRENCH mainnet token not launched"
  />
);

const COMPONENTS = {
  hook: Hook,
  fee: FeeScene,
  tiers: LadderScene,
  checkout: CheckoutScene,
  window: WindowScene,
  outro: Outro,
};

export const TiersVideo: React.FC<LaunchProps> = ({ audio }) => (
  <LaunchShell
    scenes={TIERS.list}
    components={COMPONENTS}
    captions={captions}
    audioFile="audio/launch/tiers.flac"
    audio={audio}
  />
);
