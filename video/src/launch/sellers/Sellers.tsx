import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { ease, typed } from '../../anim';
import { C, MONO, SANS } from '../../theme';
import { Upload } from '../../ui/icons';
import { Button, Card, Label, Tag, type Tone } from '../../ui/primitives';
import { BrowserShot } from '../kit/browser';
import { useFormat } from '../kit/format';
import { HookScene, OutroScene } from '../kit/scenes';
import { LaunchShell, type LaunchProps, type SceneProps } from '../kit/shell';
import { LStage } from '../kit/stage';
import { Divider, Panel } from '../kit/ui';
import captions from './captions.json';
import { PRICING, SELLERS, STUDIO, VERSIONS, WIZARD } from './timeline';

const CARD_W = 880;

const KINDS = [
  'Terminal script',
  'Trading bot config',
  'Wallet tracker list',
  'Filter / preset pack',
  'Indicator',
  'Telegram bot',
];

/** The listing types drifting past behind the hook. */
const KindsBackdrop: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const fade = Math.min(ease(frame, 0, 14), 1 - ease(frame, dur - 14, dur - 2));
  const rows = tall ? 12 : 7;
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        gap: tall ? 46 : 34,
        opacity: fade * 0.2,
        maskImage: 'radial-gradient(ellipse 65% 60% at 50% 50%, #000 20%, transparent 85%)',
      }}
    >
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            whiteSpace: 'nowrap',
            fontFamily: MONO,
            fontSize: tall ? 34 : 30,
            color: r === Math.floor(rows / 2) ? C.accent : C.decor,
            transform: `translateX(${(r % 2 ? -1 : 1) * frame * 0.8 - 400}px)`,
          }}
        >
          {Array.from({ length: 4 }, () =>
            KINDS.slice(r % KINDS.length)
              .concat(KINDS.slice(0, r % KINDS.length))
              .join('   ·   '),
          ).join('   ·   ')}
        </div>
      ))}
    </AbsoluteFill>
  );
};

const Hook: React.FC<SceneProps> = ({ dur }) => (
  <HookScene
    dur={dur}
    label="FOR SELLERS"
    wide={[
      [{ t: 'Sell' }, { t: 'your' }, { t: 'edge.' }],
      [{ t: 'Keep' }, { t: '100%.', c: C.accent }],
    ]}
    tall={[
      [{ t: 'Sell' }, { t: 'your' }, { t: 'edge.' }],
      [{ t: 'Keep' }, { t: '100%.', c: C.accent }],
    ]}
    backdrop={<KindsBackdrop dur={dur} />}
  />
);

const STEPS = [
  ['What you sell', 'Type'],
  ['Terminals', 'Type-specific'],
  ['Details', 'Title, guide'],
  ['Media', 'Cover, screens'],
  ['Pricing', 'Price, updates'],
  ['File', 'Upload, fee'],
  ['Review', 'Submit'],
];

const Stepper: React.FC<{ step: number }> = ({ step }) => (
  <div style={{ display: 'flex', gap: 6 }}>
    {STEPS.map(([title, sub], i) => {
      const n = i + 1;
      const done = n < step;
      const now = n === step;
      return (
        <div key={title} style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: MONO,
              fontWeight: 700,
              fontSize: 16,
              background: done ? C.accent : now ? C.accentBg : 'transparent',
              color: done ? C.onAccent : now ? C.accent : C.faint,
              border: done ? 'none' : `${now ? 2 : 1}px solid ${now ? C.accent : C.borderStrong}`,
            }}
          >
            {done ? '✓' : n}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 16,
              fontWeight: 600,
              color: done || now ? C.text : C.muted,
              marginTop: 8,
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 14,
              color: now ? C.accent : C.faint,
              marginTop: 2,
              whiteSpace: 'nowrap',
            }}
          >
            {now ? 'You are here' : done ? 'Done' : sub}
          </div>
        </div>
      );
    })}
  </div>
);

/** Logos are the files the live wizard bundles under apps/web/public/terminals. */
const TERMINALS = [
  { name: 'Axiom', host: 'axiom.trade', logo: 'axiom.svg' },
  { name: 'GMGN', host: 'gmgn.ai', logo: 'gmgn.png' },
  { name: 'Photon', host: 'photon-sol.tinyastro.io', logo: 'photon.png' },
  { name: 'Terminal', host: 'trade.padre.gg', logo: 'terminal.svg' },
  { name: 'Trojan', host: 'trojan.com', logo: 'trojan.png' },
];

const CheckBadge: React.FC<{ on: number }> = ({ on }) => (
  <span
    style={{
      width: 26,
      height: 26,
      borderRadius: 13,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: MONO,
      fontWeight: 700,
      fontSize: 15,
      background: on > 0.5 ? C.accent : 'transparent',
      color: C.onAccent,
      border: on > 0.5 ? 'none' : `1.5px solid ${C.borderStrong}`,
      transform: `scale(${1 + 0.25 * Math.sin(on * Math.PI)})`,
    }}
  >
    {on > 0.5 ? '✓' : ''}
  </span>
);

const WizardCard: React.FC = () => {
  const frame = useCurrentFrame();
  const step2 = ease(frame, WIZARD.step2, WIZARD.step2 + 12);
  const step = frame < WIZARD.step2 ? 1 : 2;
  const picked = frame >= WIZARD.pick;
  const selected = WIZARD.terminals.filter((f) => frame >= f).length;
  return (
    <Card style={{ width: CARD_W, padding: 30, boxSizing: 'border-box' }}>
      <Stepper step={step} />
      <Divider style={{ margin: '24px 0' }} />
      <div style={{ position: 'relative', height: 418 }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 1 - step2,
            transform: `translateX(${-30 * step2}px)`,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 28,
              fontWeight: 600,
              color: C.text,
              letterSpacing: '-0.02em',
            }}
          >
            What are you selling?
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 20 }}>
            {KINDS.map((k, i) => {
              const on = i === 0 && picked;
              return (
                <div
                  key={k}
                  style={{
                    padding: '20px 22px',
                    borderRadius: 14,
                    border: `1px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accentBg : C.inset,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontFamily: SANS,
                    fontSize: 22,
                    fontWeight: 600,
                    color: on ? C.text : C.text2,
                  }}
                >
                  {k}
                  <CheckBadge on={on ? ease(frame, WIZARD.pick, WIZARD.pick + 8) : 0} />
                </div>
              );
            })}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: step2,
            transform: `translateX(${30 * (1 - step2)}px)`,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 28,
              fontWeight: 600,
              color: C.text,
              letterSpacing: '-0.02em',
            }}
          >
            Which terminals does it run on?
          </div>
          <div style={{ fontFamily: SANS, fontSize: 19, color: C.text2, marginTop: 6 }}>
            Buyers filter by terminal. The review checks your{' '}
            <span style={{ fontFamily: MONO }}>@match</span> lines.
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 20 }}
          >
            {[...TERMINALS, { name: 'Any site', host: 'all terminals', logo: '' }].map((t, i) => {
              const at = WIZARD.terminals[i];
              const on = at !== undefined && frame >= at;
              const pulse = at !== undefined ? ease(frame, at, at + 10) : 0;
              return (
                <div
                  key={t.name}
                  style={{
                    position: 'relative',
                    padding: 18,
                    borderRadius: 14,
                    border: `1px ${i === 5 ? 'dashed' : 'solid'} ${on ? C.accent : C.borderStrong}`,
                    background: on ? C.accentBg : C.inset,
                    boxShadow: on ? `0 0 ${24 * (1 - pulse)}px ${C.accent}55` : undefined,
                  }}
                >
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 11,
                      border: `1px solid ${C.border}`,
                      background: C.surface2,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: MONO,
                      fontWeight: 600,
                      fontSize: 22,
                      color: C.text,
                    }}
                  >
                    {t.logo ? (
                      <Img
                        src={staticFile(`launch/terminals/${t.logo}`)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      '◎'
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: SANS,
                      fontSize: 22,
                      fontWeight: 600,
                      color: C.text,
                      marginTop: 12,
                    }}
                  >
                    {t.name}
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 15,
                      color: C.muted,
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t.host}
                  </div>
                  <div style={{ position: 'absolute', right: 14, top: 14 }}>
                    <CheckBadge on={on ? pulse : 0} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontFamily: SANS, fontSize: 17, color: C.muted, marginTop: 14 }}>
            <span style={{ color: C.accent }}>{selected} selected</span> · Names and logos belong to
            their owners; TrenchMart is not affiliated with these terminals.
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 18,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 17, color: C.muted }}>Step {step} of 7</span>
        <div style={{ width: 340 }}>
          <Button height={58} style={{ fontSize: 21 }}>
            Continue: {step === 1 ? 'terminals' : 'details'} →
          </Button>
        </div>
      </div>
    </Card>
  );
};

const WizardScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '01 / LIST',
      wide: [
        [{ t: 'Seven' }, { t: 'steps' }],
        [{ t: 'to' }, { t: 'listed.', c: C.accent }],
      ],
      tall: [[{ t: 'Seven' }, { t: 'steps' }, { t: 'to' }, { t: 'listed.', c: C.accent }]],
      sub: 'A wizard tailored to what you sell.',
    }}
    card={<WizardCard />}
    scale={{ wide: 1.04, tall: 1.12 }}
    tallCardTop={520}
  />
);

const Toggle: React.FC<{ on: number }> = ({ on }) => (
  <span
    style={{
      position: 'relative',
      width: 58,
      height: 32,
      borderRadius: 16,
      display: 'inline-block',
      background: on > 0.5 ? C.accent : C.surface2,
      border: on > 0.5 ? 'none' : `1px solid ${C.borderStrong}`,
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: 5,
        left: 5 + 26 * on,
        width: 22,
        height: 22,
        borderRadius: 11,
        background: on > 0.5 ? C.onAccent : C.muted,
      }}
    />
  </span>
);

const PricingCard: React.FC = () => {
  const frame = useCurrentFrame();
  const on = ease(frame, PRICING.toggle, PRICING.toggle + 8);
  const subs = ease(frame, PRICING.toggle + 4, PRICING.toggle + 16);
  const free = ease(frame, PRICING.free, PRICING.free + 12);
  const renew = ease(frame, PRICING.renews, PRICING.renews + 10);
  const monthly = typed(frame, '0.01', PRICING.monthly[0], PRICING.monthly[1]);
  const cols: [string, string, number][] = [
    ['Day 0', 'Buys v1.0.0 · 0.10 SOL', 1],
    ['Days 1–30', 'Free updates', free],
    ['Day 31', 'Renews at 0.01 SOL/mo', renew],
  ];
  return (
    <Card style={{ width: CARD_W, padding: 30, boxSizing: 'border-box' }}>
      <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 600, color: C.text }}>
        One-time price
      </div>
      <div style={{ fontFamily: SANS, fontSize: 19, color: C.text2, marginTop: 4 }}>
        What a buyer pays once. You keep 100% of it.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 16 }}>
        <div
          style={{
            width: 300,
            height: 72,
            borderRadius: 12,
            border: `2px solid ${C.accent}`,
            background: C.inset,
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            boxSizing: 'border-box',
          }}
        >
          <span style={{ flex: 1, fontFamily: MONO, fontSize: 34, fontWeight: 600, color: C.text }}>
            {typed(frame, '0.10', PRICING.price[0], PRICING.price[1]) || (
              <span style={{ color: C.faint }}>1.20</span>
            )}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 18, color: C.muted }}>SOL</span>
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 20,
            color: C.text2,
            opacity: ease(frame, PRICING.price[1], PRICING.price[1] + 8),
          }}
        >
          0% creator commission
        </div>
      </div>
      <Divider style={{ margin: '24px 0 20px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 600, color: C.text }}>
            Updates subscription
          </div>
          <div style={{ fontFamily: SANS, fontSize: 19, color: C.text2, marginTop: 4 }}>
            Buyers renew monthly to keep getting new versions.
          </div>
        </div>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: SANS,
            fontSize: 19,
            color: C.text2,
          }}
        >
          {on > 0.5 ? 'On' : 'Off'} <Toggle on={on} />
        </span>
      </div>
      <div style={{ opacity: subs, transform: `translateY(${(1 - subs) * 12}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 16 }}>
          <div
            style={{
              width: 300,
              height: 58,
              borderRadius: 12,
              border: `1px solid ${frame >= PRICING.monthly[0] ? C.accent : C.borderStrong}`,
              background: C.inset,
              display: 'flex',
              alignItems: 'center',
              padding: '0 18px',
              boxSizing: 'border-box',
            }}
          >
            <span
              style={{ flex: 1, fontFamily: MONO, fontSize: 26, fontWeight: 600, color: C.text }}
            >
              {monthly || <span style={{ color: C.faint }}>0.12</span>}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 17, color: C.muted }}>SOL / month</span>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 17, color: C.muted }}>
            Suggested 10% of the price
          </span>
        </div>
        <Panel tone="ok" style={{ marginTop: 18, padding: 20 }}>
          <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 600, color: C.accent }}>
            ✓ First 30 days of updates are free with every purchase
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 16 }}
          >
            {cols.map(([a, b, p], i) => (
              <div key={a} style={{ opacity: 0.4 + 0.6 * p }}>
                <div
                  style={{
                    height: 5,
                    borderRadius: 3,
                    background: i === 2 ? C.borderStrong : C.accent,
                    opacity: i === 0 ? 0.6 : 1,
                  }}
                />
                <div style={{ fontFamily: MONO, fontSize: 16, color: C.muted, marginTop: 10 }}>
                  {a}
                </div>
                <div style={{ fontFamily: SANS, fontSize: 19, color: C.text2, marginTop: 2 }}>
                  {b}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: SANS, fontSize: 17, color: C.text2, marginTop: 14 }}>
            Buyers who stop renewing keep the last version they downloaded.
          </div>
        </Panel>
      </div>
    </Card>
  );
};

const PricingScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '02 / PRICING',
      wide: [[{ t: 'Paid' }, { t: 'once.' }], [{ t: 'Updates' }], [{ t: 'monthly.', c: C.accent }]],
      tall: [
        [{ t: 'Paid' }, { t: 'once.' }],
        [{ t: 'Updates' }, { t: 'monthly.', c: C.accent }],
      ],
      sub: '30 days of updates free, then your price.',
    }}
    card={<PricingCard />}
    scale={{ wide: 1.0, tall: 1.12 }}
    tallCardTop={540}
  />
);

const STATUS: Record<string, [string, string, Tone]> = {
  scanning: ['◑', 'REVIEW · CHECKS', 'info'],
  in_review: ['◑', 'REVIEW · VERDICT', 'info'],
  live: ['✓', 'REVIEWED', 'ok'],
  superseded: ['↷', 'SUPERSEDED', 'neutral'],
};

const VersionRow: React.FC<{ semver: string; status: string; live?: boolean }> = ({
  semver,
  status,
  live,
}) => {
  const [sym, label, tone] = STATUS[status]!;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        borderRadius: 12,
        border: `1px solid ${live ? C.accentBorder : C.border}`,
        background: live ? C.accentBg : C.inset,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontFamily: MONO, fontSize: 22, color: C.text }}>v{semver}</span>
        {live ? (
          <span style={{ fontFamily: SANS, fontSize: 18, color: C.accent }}>live for buyers</span>
        ) : null}
      </span>
      <Tag tone={tone} size={16}>
        {sym} {label}
      </Tag>
    </div>
  );
};

const VersionsCard: React.FC = () => {
  const frame = useCurrentFrame();
  const submitted = frame >= VERSIONS.submit;
  const newStatus =
    frame < VERSIONS.verdict ? 'scanning' : frame < VERSIONS.live ? 'in_review' : 'live';
  const swapped = frame >= VERSIONS.live;
  const rowIn = ease(frame, VERSIONS.submit, VERSIONS.submit + 10);
  return (
    <Card style={{ width: CARD_W, padding: 30, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Label style={{ fontSize: 16 }}>Trojan Trenches Intel</Label>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 30,
              fontWeight: 600,
              color: C.text,
              marginTop: 4,
              letterSpacing: '-0.02em',
            }}
          >
            Upload new version
          </div>
        </div>
        <Upload size={34} color={C.accent} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, marginTop: 20 }}>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 18, color: C.text2 }}>Version</div>
          <div
            style={{
              marginTop: 8,
              height: 56,
              borderRadius: 12,
              border: `1px solid ${C.accent}`,
              background: C.inset,
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              fontFamily: MONO,
              fontSize: 24,
              color: C.text,
            }}
          >
            {typed(frame, '1.4.2', VERSIONS.semver[0], VERSIONS.semver[1])}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 18, color: C.text2 }}>Changelog</div>
          <div
            style={{
              marginTop: 8,
              height: 56,
              borderRadius: 12,
              border: `1px solid ${C.borderStrong}`,
              background: C.inset,
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              fontFamily: SANS,
              fontSize: 21,
              color: C.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {typed(
              frame,
              'Faster labels on new pairs',
              VERSIONS.changelog[0],
              VERSIONS.changelog[1],
            )}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 17, color: C.muted, marginTop: 10 }}>
        Suggested patch bump from v1.4.1. It must be higher than the live version.
      </div>
      <Divider style={{ margin: '22px 0 18px' }} />
      <Label style={{ fontSize: 15 }}>Versions</Label>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <div
          style={{
            opacity: submitted ? rowIn : 0,
            transform: `translateY(${(1 - rowIn) * -10}px)`,
          }}
        >
          <VersionRow semver="1.4.2" status={newStatus} live={swapped} />
        </div>
        <VersionRow semver="1.4.1" status={swapped ? 'superseded' : 'live'} live={!swapped} />
      </div>
      <Panel
        tone="info"
        style={{
          marginTop: 18,
          padding: '14px 18px',
          fontFamily: SANS,
          fontSize: 18,
          color: C.text2,
          lineHeight: 1.4,
        }}
      >
        The current version stays live. Buyers switch over once the new file passes review;
        subscribers get it automatically.
      </Panel>
    </Card>
  );
};

const VersionsScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '03 / VERSIONS',
      wide: [
        [{ t: 'Ship' }, { t: 'updates.' }],
        [{ t: 'Stay' }, { t: 'live.', c: C.accent }],
      ],
      tall: [[{ t: 'Ship' }, { t: 'updates.' }, { t: 'Stay' }, { t: 'live.', c: C.accent }]],
      sub: 'Every version is reviewed before buyers get it.',
    }}
    card={<VersionsCard />}
    scale={{ wide: 1.02, tall: 1.12 }}
    tallCardTop={500}
  />
);

const STATS = ['Revenue · 30d', 'Sales · 30d', 'Update subscribers', 'Paid out · all time'];

const StudioCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const bw = tall ? 940 : 960;
  const bh = 560;
  const shotIn = ease(frame, STUDIO.chips[1] - 6, STUDIO.chips[1] + 10);
  return (
    <div style={{ width: bw }}>
      <Panel style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label style={{ fontSize: 15 }}>Creator studio · your dashboard</Label>
          <span style={{ fontFamily: MONO, fontSize: 16, color: C.muted }}>/studio</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: 10,
            marginTop: 14,
          }}
        >
          {STATS.map((s, i) => {
            const p = ease(frame, STUDIO.chips[0] + i * 6, STUDIO.chips[0] + 10 + i * 6);
            return (
              <div
                key={s}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.inset,
                  fontFamily: MONO,
                  fontSize: 15,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: C.text2,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 10}px)`,
                }}
              >
                {s}
              </div>
            );
          })}
        </div>
      </Panel>
      <div
        style={{ marginTop: 18, opacity: shotIn, transform: `translateY(${(1 - shotIn) * 40}px)` }}
      >
        <BrowserShot
          src="launch/profile.webp"
          imgW={2880}
          url="trenchmart.fun/u/6f6g…tPGt"
          width={bw}
          height={bh}
          crops={[
            { at: STUDIO.zoom[0], x: 180, y: 1080, w: 2540 },
            { at: STUDIO.zoom[1], x: 1300, y: 1120, w: 1500 },
          ]}
          highlights={[
            { x: 1442, y: 1151, w: 615, h: 221, from: STUDIO.bond },
            { x: 2031, y: 1422, w: 640, h: 554, from: STUDIO.trust },
          ]}
        />
      </div>
      <div
        style={{
          textAlign: 'center',
          fontFamily: SANS,
          fontSize: 21,
          color: C.text2,
          marginTop: 16,
          opacity: shotIn,
        }}
      >
        Your public profile, live on devnet today
      </div>
    </div>
  );
};

const StudioScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '04 / STUDIO',
      wide: [
        [{ t: 'Your' }, { t: 'studio.' }],
        [{ t: 'Your' }, { t: 'record.', c: C.accent }],
      ],
      tall: [[{ t: 'Your' }, { t: 'studio.' }, { t: 'Your' }, { t: 'record.', c: C.accent }]],
      sub: 'Buyers see your bond, sales and reviewed versions.',
    }}
    card={<StudioCard />}
    scale={{ wide: 0.98, tall: 1.06 }}
    tallCardTop={500}
  />
);

const Outro: React.FC<SceneProps> = ({ dur }) => (
  <OutroScene
    dur={dur}
    tagline={[{ t: 'Sell' }, { t: 'your' }, { t: 'edge.', c: C.accent }]}
    note="TrenchMart is not affiliated with these terminals"
  />
);

const COMPONENTS = {
  hook: Hook,
  wizard: WizardScene,
  pricing: PricingScene,
  versions: VersionsScene,
  studio: StudioScene,
  outro: Outro,
};

export const SellersVideo: React.FC<LaunchProps> = ({ audio }) => (
  <LaunchShell
    scenes={SELLERS.list}
    components={COMPONENTS}
    captions={captions}
    audioFile="audio/launch/sellers.flac"
    audio={audio}
  />
);
