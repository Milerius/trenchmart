import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { ease, lin, springAt } from '../../anim';
import { C, MONO, SANS } from '../../theme';
import { Download, Lock, Shield, Spinner } from '../../ui/icons';
import { Button, Card, ClickRing, Cursor, Label, Tag, type Tone } from '../../ui/primitives';
import { BrowserShot } from '../kit/browser';
import { useFormat } from '../kit/format';
import { HookScene, OutroScene } from '../kit/scenes';
import { LaunchShell, type LaunchProps, type SceneProps } from '../kit/shell';
import { LStage } from '../kit/stage';
import { Divider, Panel, Row, Square } from '../kit/ui';
import captions from './captions.json';
import { BUY, DISPUTE, ESCROW_V, HOLD, PROOF, RELEASE } from './timeline';

const PROGRAM_ID = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
const ESCROW_ACCOUNT = '34f362Qw6qMskMsqNCxw5GZgGLNP77Q8SDcVUTQGkQv9';
const CARD_W = 860;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeKey = (seed: number) =>
  Array.from({ length: 44 }, (_, i) => B58[Math.floor(random(`k${seed}-${i}`) * B58.length)]).join('');

/** Accounts scrolling past like a ledger, with the escrow program's row lit. */
const LedgerBackdrop: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const size = tall ? 28 : 26;
  const lineH = size * 1.9;
  const rows = tall ? 34 : 20;
  const lit = Math.floor(rows / 2);
  const fade = Math.min(ease(frame, 0, 14), 1 - ease(frame, dur - 14, dur - 2));
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fade * 0.32,
        maskImage: 'radial-gradient(ellipse 62% 60% at 50% 50%, #000 25%, transparent 85%)',
      }}
    >
      <div style={{ transform: `translateY(${-frame * 0.5}px)`, fontFamily: MONO, fontSize: size, lineHeight: `${lineH}px` }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ whiteSpace: 'pre', color: i === lit ? C.accent : C.decor, textAlign: 'center' }}>
            {i === lit ? PROGRAM_ID : fakeKey(i)}
            {'   '}
            {i === lit ? 'TrenchMart Escrow' : `+${(random(`a${i}`) * 2).toFixed(4)} SOL`}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Hook: React.FC<SceneProps> = ({ dur }) => (
  <HookScene
    dur={dur}
    label="ON-CHAIN ESCROW"
    wide={[[{ t: 'Paid' }, { t: 'to' }, { t: 'escrow.' }], [{ t: 'Not' }, { t: 'the' }, { t: 'seller.', c: C.accent }]]}
    tall={[[{ t: 'Paid' }, { t: 'to' }, { t: 'escrow.' }], [{ t: 'Not' }, { t: 'the' }, { t: 'seller.', c: C.accent }]]}
    backdrop={<LedgerBackdrop dur={dur} />}
  />
);

const PROGRESS = ['Price locked', 'Signed in wallet', 'Confirmed on devnet', 'Paid · in escrow'];
const BTN_Y = 404;

const CheckoutCard: React.FC = () => {
  const frame = useCurrentFrame();
  const press = frame >= BUY.click && frame < BUY.click + 6 ? 1 : 0;
  const done = ease(frame, BUY.done, BUY.done + 12);
  const stepsAt = [BUY.click + 4, BUY.signed, BUY.confirmed, BUY.done];
  const btn =
    frame < BUY.click
      ? { label: <>Pay into escrow</>, style: {} }
      : frame < BUY.signed
        ? { label: <>Approve in your wallet…</>, style: { background: C.warnBg, color: C.warn, border: `1px solid ${C.warnBorder}` } }
        : {
            label: (
              <>
                <Spinner size={22} frame={frame} color={C.info} /> Confirming on devnet…
              </>
            ),
            style: { background: C.infoBg, color: C.info, border: `1px solid ${C.infoBorder}` },
          };
  return (
    <div style={{ position: 'relative' }}>
      <Card style={{ width: CARD_W, padding: 32, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Label style={{ fontSize: 16 }}>Checkout</Label>
            <div style={{ fontFamily: SANS, fontSize: 30, fontWeight: 600, color: C.text, marginTop: 6, letterSpacing: '-0.02em' }}>
              Trojan Trenches Intel
            </div>
          </div>
          <Tag size={17}>userscript · Trojan</Tag>
        </div>
        <Divider style={{ margin: '22px 0' }} />
        <div style={{ display: 'grid', gap: 14 }}>
          <Row label="Listing price" value="0.10 SOL" size={23} />
          <Row label="Buyer fee (5%)" value="0.005 SOL" size={23} />
          <Row label="Creator commission" value="0%" size={23} valueColor={C.accent} />
        </div>
        <Divider style={{ margin: '20px 0 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: SANS, fontSize: 24, fontWeight: 600, color: C.text }}>You pay</span>
          <span style={{ fontFamily: MONO, fontSize: 36, fontWeight: 700, color: C.text }}>0.105 SOL</span>
        </div>
        <div style={{ position: 'relative', marginTop: 22, height: 96 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', opacity: 1 - done }}>
            <div style={{ width: '100%' }}>
              <Button height={68} press={press} style={{ fontSize: 23, ...btn.style }}>
                {btn.label}
              </Button>
            </div>
          </div>
          <Panel
            tone="ok"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '0 22px',
              opacity: done,
              transform: `scale(${0.96 + 0.04 * done})`,
            }}
          >
            <Square tone="ok" size={48}>
              ✓
            </Square>
            <div>
              <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 600, color: C.text }}>Paid · in escrow</div>
              <div style={{ fontFamily: SANS, fontSize: 20, color: C.accentBody, marginTop: 4 }}>
                Your SOL is in escrow for 1 hour. Your download is ready now.
              </div>
            </div>
          </Panel>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {PROGRESS.map((p, i) => {
            const on = frame >= stepsAt[i];
            return (
              <div
                key={p}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: SANS,
                  fontSize: 18,
                  color: on ? C.text : C.faint,
                  opacity: frame >= BUY.click ? 1 : 0.5,
                }}
              >
                <span style={{ color: on ? C.accent : C.decor, fontFamily: MONO }}>{on ? '✓' : '○'}</span>
                {p}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 20, fontFamily: SANS, fontSize: 19, color: C.text2 }}>
          <Shield size={20} color={C.accent} />
          Held in escrow for 1 hour. Dispute any time in that window.
        </div>
      </Card>
      <Cursor
        x={lin(ease(frame, BUY.cursor[0], BUY.cursor[1]), 0, 1, [CARD_W - 60, CARD_W / 2 + 40])}
        y={lin(ease(frame, BUY.cursor[0], BUY.cursor[1]), 0, 1, [BTN_Y + 220, BTN_Y + 4])}
        press={press}
        opacity={ease(frame, BUY.cursor[0] - 2, BUY.cursor[0] + 4)}
        away={ease(frame, BUY.click + 5, BUY.click + 18)}
      />
      <ClickRing x={CARD_W / 2 + 42} y={BTN_Y + 4} t={lin(frame, BUY.click, BUY.click + 10)} />
    </div>
  );
};

const BuyScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '01 / BUY',
      wide: [[{ t: 'One' }, { t: 'signature.' }], [{ t: 'Escrow' }, { t: 'funded.', c: C.accent }]],
      tall: [[{ t: 'One' }, { t: 'signature.' }], [{ t: 'Escrow' }, { t: 'funded.', c: C.accent }]],
      sub: 'Your SOL goes to a program account, not the seller.',
    }}
    card={<CheckoutCard />}
    scale={{ wide: 1.04, tall: 1.14 }}
    tallCardTop={600}
  />
);

const clock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

type VaultState = {
  status: { text: string; tone: Tone };
  amount: number;
  clock: string;
  clockTone: string;
  windowP: number;
  frozen?: number;
  enter?: number;
};

/** The escrow account the program holds: status, deposit, the on-chain release time. */
const VaultCard: React.FC<{ s: VaultState; children?: React.ReactNode }> = ({ s, children }) => {
  const frozen = s.frozen ?? 0;
  const enter = s.enter ?? 1;
  return (
    <Card style={{ width: CARD_W, padding: 32, boxSizing: 'border-box', opacity: enter, transform: `translateY(${(1 - enter) * 40}px)` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label style={{ fontSize: 16 }}>Escrow account · on-chain</Label>
        <Tag tone={s.status.tone} size={18}>
          {s.status.text}
        </Tag>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 22, color: C.text, marginTop: 14 }}>{ESCROW_ACCOUNT}</div>
      <div style={{ fontFamily: MONO, fontSize: 17, color: C.muted, marginTop: 6 }}>
        owned by TrenchMart Escrow · Solana devnet
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 26 }}>
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: 22,
            border: `1.5px solid ${frozen > 0.5 ? C.info : C.accent}`,
            background: C.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 0 36px ${frozen > 0.5 ? C.info : C.accent}30`,
          }}
        >
          <Lock size={46} color={frozen > 0.5 ? C.info : C.accent} />
        </div>
        <div style={{ flex: 1 }}>
          <Label style={{ fontSize: 15 }}>Deposit</Label>
          <div style={{ fontFamily: MONO, fontSize: 52, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>
            {s.amount.toFixed(3)} SOL
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Label style={{ fontSize: 15 }}>{frozen > 0.5 ? 'Release' : 'Releases in'}</Label>
          <div style={{ fontFamily: MONO, fontSize: 42, fontWeight: 600, color: s.clockTone }}>{s.clock}</div>
        </div>
      </div>
      <div style={{ marginTop: 26 }}>
        <div style={{ position: 'relative', height: 10, borderRadius: 5, background: C.border }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${s.windowP * 100}%`,
              borderRadius: 5,
              background: frozen > 0.5 ? C.info : C.accent,
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: MONO, fontSize: 17, color: C.muted }}>
          <span>paid</span>
          <span style={{ color: frozen > 0.5 ? C.info : C.text2 }}>dispute window · 1 hour</span>
          <span>release</span>
        </div>
      </div>
      {children ? <div style={{ marginTop: 24 }}>{children}</div> : null}
    </Card>
  );
};

const Line: React.FC<{ show: number; icon: React.ReactNode; children: React.ReactNode; color?: string }> = ({
  show,
  icon,
  children,
  color = C.text2,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      fontFamily: SANS,
      fontSize: 21,
      color,
      opacity: show,
      transform: `translateY(${(1 - show) * 10}px)`,
      minHeight: 40,
    }}
  >
    {icon}
    <span>{children}</span>
  </div>
);

const HoldCard: React.FC = () => {
  const frame = useCurrentFrame();
  const amount = lin(frame, HOLD.count[0], HOLD.count[1], [0, 0.105]);
  const ticking = Math.max(0, frame - HOLD.count[1]) / 30;
  return (
    <VaultCard
      s={{
        status: { text: frame >= HOLD.count[1] ? 'Paid' : 'Funding…', tone: frame >= HOLD.count[1] ? 'ok' : 'info' },
        amount,
        clock: clock(3600 - ticking),
        clockTone: C.text,
        windowP: ease(frame, HOLD.window[0], HOLD.window[1], [0, 0.02]),
        enter: springAt(frame, 0, 18),
      }}
    >
      <div style={{ display: 'grid', gap: 6 }}>
        <Line show={ease(frame, HOLD.download, HOLD.download + 10)} icon={<Download size={24} color={C.accent} />} color={C.text}>
          Download ready in Purchases, right after payment confirms
        </Line>
        <Line show={ease(frame, HOLD.download + 14, HOLD.download + 24)} icon={<Lock size={22} color={C.muted} />}>
          The seller gets nothing until the window ends
        </Line>
      </div>
    </VaultCard>
  );
};

const HoldScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '02 / HOLD',
      wide: [[{ t: 'Held' }, { t: 'by' }, { t: 'the' }], [{ t: 'program.' }], [{ t: 'One' }, { t: 'hour.', c: C.accent }]],
      tall: [[{ t: 'Held' }, { t: 'by' }, { t: 'the' }, { t: 'program.' }], [{ t: 'One' }, { t: 'hour.', c: C.accent }]],
      sub: 'The release time is written on-chain.',
    }}
    card={<HoldCard />}
    scale={{ wide: 1.04, tall: 1.14 }}
    tallCardTop={560}
  />
);

const OUTCOMES = [
  { ix: 'refund', text: 'The resolver refunds you in full', key: 'refund' as const },
  { ix: 'reject_dispute', text: 'or rejects it, and the seller is paid', key: 'reject' as const },
  { ix: 'refund_after_timeout', text: 'Still open 7 days later? Anyone can refund you', key: 'timeout' as const },
];

const DisputeCard: React.FC = () => {
  const frame = useCurrentFrame();
  const open = frame >= DISPUTE.open;
  const frozen = ease(frame, DISPUTE.open, DISPUTE.open + 10);
  const press = frame >= DISPUTE.click && frame < DISPUTE.click + 6 ? 1 : 0;
  const elapsed = 1260 + frame / 30;
  const freezeAt = 1260 + DISPUTE.open / 30;
  const cursorP = ease(frame, DISPUTE.cursor[0], DISPUTE.cursor[1]);
  return (
    <div style={{ position: 'relative' }}>
      <VaultCard
        s={{
          status: open ? { text: 'Disputed', tone: 'danger' } : { text: 'Paid', tone: 'ok' },
          amount: 0.105,
          clock: open ? 'frozen' : clock(3600 - elapsed),
          clockTone: open ? C.info : C.text,
          windowP: (open ? freezeAt : elapsed) / 3600,
          frozen,
        }}
      >
        <div style={{ position: 'relative', height: 156 }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 1 - ease(frame, DISPUTE.open + 6, DISPUTE.open + 16) }}>
            <Button variant="secondary" height={64} press={press} style={{ fontSize: 22, borderColor: C.warnBorder, color: C.warn }}>
              Open a dispute
            </Button>
          </div>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', gap: 8, alignContent: 'start' }}>
            {OUTCOMES.map((o) => {
              const show = ease(frame, DISPUTE[o.key], DISPUTE[o.key] + 10);
              return (
                <div
                  key={o.ix}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    opacity: show,
                    transform: `translateY(${(1 - show) * 10}px)`,
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 17, color: C.info, width: 236, flex: 'none' }}>{o.ix}</span>
                  <span style={{ fontFamily: SANS, fontSize: 21, color: C.text2 }}>{o.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      </VaultCard>
      <Cursor
        x={lin(cursorP, 0, 1, [CARD_W + 40, CARD_W / 2 + 30])}
        y={lin(cursorP, 0, 1, [760, 594])}
        press={press}
        opacity={ease(frame, DISPUTE.cursor[0] - 2, DISPUTE.cursor[0] + 4)}
        away={ease(frame, DISPUTE.click + 5, DISPUTE.click + 18)}
      />
      <ClickRing x={CARD_W / 2 + 32} y={596} t={lin(frame, DISPUTE.click, DISPUTE.click + 10)} />
    </div>
  );
};

const DisputeScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '03 / DISPUTE',
      wide: [[{ t: 'Dispute' }, { t: 'it.' }], [{ t: 'The' }, { t: 'escrow' }], [{ t: 'freezes.', c: C.info }]],
      tall: [[{ t: 'Dispute' }, { t: 'it.' }], [{ t: 'The' }, { t: 'escrow' }, { t: 'freezes.', c: C.info }]],
      sub: 'Release refuses a disputed escrow.',
    }}
    card={<DisputeCard />}
    scale={{ wide: 1.04, tall: 1.14 }}
    tallCardTop={560}
  />
);

const SPLIT = [
  { label: '$TRENCH buyback', pct: 40, sol: 0.002 },
  { label: 'Verification', pct: 25, sol: 0.00125 },
  { label: 'Operations', pct: 20, sol: 0.001 },
  { label: 'Safety fund', pct: 15, sol: 0.00075 },
];

const ReleaseCard: React.FC = () => {
  const frame = useCurrentFrame();
  const released = frame >= RELEASE.released;
  const remaining = lin(frame, RELEASE.ff[0], RELEASE.ff[1], [3598, 0]);
  const seller = ease(frame, RELEASE.seller, RELEASE.seller + 12);
  const split = ease(frame, RELEASE.split[0], RELEASE.split[1]);
  const amount = 0.105 - 0.1 * seller - 0.005 * split;
  return (
    <VaultCard
      s={{
        status: released ? { text: 'Released', tone: 'ok' } : { text: 'Paid', tone: 'ok' },
        amount: Math.max(0, amount),
        clock: clock(remaining),
        clockTone: released ? C.accent : C.text,
        windowP: 1 - remaining / 3600,
      }}
    >
      <div style={{ position: 'relative', height: 176 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: MONO,
            fontSize: 18,
            color: C.muted,
            opacity: ease(frame, RELEASE.ff[0], RELEASE.ff[0] + 6) * (1 - ease(frame, RELEASE.released, RELEASE.released + 8)),
          }}
        >
          ≫ one hour later · no dispute
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', gap: 12, alignContent: 'start' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '12px 18px',
              borderRadius: 12,
              background: C.accentBg,
              border: `1px solid ${C.accentBorder}`,
              opacity: seller,
              transform: `translateX(${(1 - seller) * -20}px)`,
            }}
          >
            <span style={{ fontFamily: SANS, fontSize: 22, color: C.text }}>Seller · full listing price</span>
            <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: C.accent }}>+0.100 SOL</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 26px', opacity: split }}>
            {SPLIT.map((s, i) => {
              const p = ease(frame, RELEASE.split[0] + i * 3, RELEASE.split[0] + 10 + i * 3);
              return (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: SANS, fontSize: 19, color: C.text2, opacity: p }}>
                  <span>
                    {s.label} · {s.pct}%
                  </span>
                  <span style={{ fontFamily: MONO, color: C.text }}>+{s.sol}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </VaultCard>
  );
};

const ReleaseScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '04 / RELEASE',
      wide: [[{ t: 'No' }, { t: 'dispute?' }], [{ t: 'It' }, { t: 'releases' }], [{ t: 'on' }, { t: 'its' }, { t: 'own.', c: C.accent }]],
      tall: [[{ t: 'No' }, { t: 'dispute?' }], [{ t: 'It' }, { t: 'releases' }, { t: 'on' }, { t: 'its' }, { t: 'own.', c: C.accent }]],
      sub: 'The 5% buyer fee is split on-chain in the same instruction.',
    }}
    card={<ReleaseCard />}
    scale={{ wide: 1.04, tall: 1.14 }}
    tallCardTop={560}
  />
);

const ProofCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const bw = tall ? 940 : 960;
  const bh = 560;
  const toTx = ease(frame, PROOF.tx - 4, PROOF.tx + 6);
  const step = frame < PROOF.tx ? 0 : frame < PROOF.zoomC[0] ? 1 : 2;
  const notes = [
    'Program account “TrenchMart Escrow”, executable, on devnet',
    'Payment tx: the escrow account is created and funded',
    'Program logs: Initialize, then Fund, in one transaction',
  ];
  return (
    <div style={{ width: bw }}>
      <Panel style={{ padding: '16px 22px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
        <Label style={{ fontSize: 15, flex: 'none' }}>Escrow program</Label>
        <span style={{ fontFamily: MONO, fontSize: tall ? 23 : 22, color: C.accent, whiteSpace: 'nowrap' }}>{PROGRAM_ID}</span>
      </Panel>
      <div style={{ position: 'relative', height: bh }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - toTx }}>
          <BrowserShot
            src="launch/explorer-program.webp"
            imgW={2866}
            url={`explorer.solana.com/address/${PROGRAM_ID.slice(0, 6)}…?cluster=devnet`}
            width={bw}
            height={bh}
            crops={[
              { at: PROOF.zoomA[0], x: 0, y: 0, w: 2866 },
              { at: PROOF.zoomA[1], x: 440, y: 200, w: 1600 },
            ]}
            highlights={[{ x: 470, y: 598, w: 1560, h: 86, from: PROOF.addr }]}
          />
        </div>
        <div style={{ position: 'absolute', inset: 0, opacity: toTx, transform: `translateY(${(1 - toTx) * 30}px)` }}>
          <BrowserShot
            src="launch/explorer-paytx.webp"
            imgW={2866}
            url="explorer.solana.com/tx/5BZNfy…QK7NWF?cluster=devnet"
            width={bw}
            height={bh}
            crops={[
              { at: PROOF.zoomB[0], x: 300, y: 60, w: 2300 },
              { at: PROOF.zoomB[1], x: 440, y: 120, w: 2000 },
              { at: PROOF.zoomC[0], x: 440, y: 120, w: 2000 },
              { at: PROOF.zoomC[1], x: 1440, y: tall ? 1660 : 1740, w: 1420 },
            ]}
            highlights={[
              { x: 470, y: 352, w: 1940, h: 110, from: PROOF.escrowRow, to: PROOF.zoomC[0] },
              { x: 1480, y: 1903, w: 1340, h: 252, from: PROOF.logs },
              { x: 1480, y: 2238, w: 1340, h: 250, from: PROOF.logs + 6 },
            ]}
          />
        </div>
      </div>
      <div style={{ position: 'relative', height: 40, marginTop: 18 }}>
        {notes.map((n, i) => (
          <div
            key={n}
            style={{
              position: 'absolute',
              inset: 0,
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 22,
              color: C.text2,
              opacity: step === i ? ease(frame, [0, PROOF.tx, PROOF.zoomC[0]][i], [0, PROOF.tx, PROOF.zoomC[0]][i] + 10) : 0,
            }}
          >
            {n}
          </div>
        ))}
      </div>
    </div>
  );
};

const ProofScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '05 / PROOF',
      wide: [[{ t: "Don't" }, { t: 'trust' }, { t: 'us.' }], [{ t: 'Check' }, { t: 'the' }], [{ t: 'chain.', c: C.accent }]],
      tall: [[{ t: "Don't" }, { t: 'trust' }, { t: 'us.' }], [{ t: 'Check' }, { t: 'the' }, { t: 'chain.', c: C.accent }]],
      sub: 'Every escrow is a real account on Solana devnet.',
    }}
    card={<ProofCard />}
    scale={{ wide: 0.98, tall: 1.06 }}
    tallCardTop={610}
  />
);

const Outro: React.FC<SceneProps> = ({ dur }) => (
  <OutroScene dur={dur} tagline={[{ t: 'Your' }, { t: 'SOL,' }, { t: 'held' }, { t: 'on-chain.', c: C.accent }]} />
);

const COMPONENTS = {
  hook: Hook,
  buy: BuyScene,
  hold: HoldScene,
  dispute: DisputeScene,
  release: ReleaseScene,
  proof: ProofScene,
  outro: Outro,
};

export const EscrowVideo: React.FC<LaunchProps> = ({ audio }) => (
  <LaunchShell
    scenes={ESCROW_V.list}
    components={COMPONENTS}
    captions={captions}
    audioFile="audio/launch/escrow.flac"
    audio={audio}
  />
);
