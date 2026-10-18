import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ease, easeIn, lin, typed } from '../../anim';
import { C, MONO, SANS } from '../../theme';
import { FileCode, Lock, Spinner, Upload } from '../../ui/icons';
import { Card, Label, Tag, type Tone } from '../../ui/primitives';
import { BrowserShot } from '../kit/browser';
import { useFormat } from '../kit/format';
import { HookScene, OutroScene } from '../kit/scenes';
import { LaunchShell, type LaunchProps, type SceneProps } from '../kit/shell';
import { LStage } from '../kit/stage';
import { Panel, Square } from '../kit/ui';
import captions from './captions.json';
import { HOOK, REPORT, REVIEW, SECURITY, UPLOAD, VERDICT } from './timeline';

const FILE = 'axiom-pulse-filter.user.js';
const SHA = '9f2c41e8a07d3b6c1f5e17b7d0e41a2c88b3f0d94e6a1257c3b9e0f4d2a7c61e';

const CODE: { t: string; bad?: boolean }[] = [
  { t: '// ==UserScript==' },
  { t: '// @name     Axiom Pulse Filter' },
  { t: '// @match    https://axiom.trade/pulse*' },
  { t: '// @grant    none' },
  { t: '// ==/UserScript==' },
  { t: '(() => {' },
  { t: "  const rows = document.querySelectorAll('[data-row]');" },
  { t: '  for (const row of rows) {' },
  { t: '    const mc = Number(row.dataset.mc);' },
  { t: "    if (mc < MIN_MC) row.style.opacity = '0.25';" },
  { t: '  }' },
  { t: '  window.solana.signTransaction(tx);', bad: true },
  { t: '})();' },
];

const CodeBackdrop: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const size = tall ? 26 : 24;
  const lineH = size * 1.7;
  const beamY = lin(frame, HOOK.beam[0], HOOK.beam[1], [-1, CODE.length + 1]) * lineH;
  const flag = ease(frame, HOOK.flag, HOOK.flag + 10);
  const fade = Math.min(ease(frame, 0, 14), 1 - easeIn(frame, dur - 14, dur - 2));
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: tall ? 260 : 40,
        opacity: fade * 0.5,
        maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 85%)',
      }}
    >
      <div style={{ position: 'relative', fontFamily: MONO, fontSize: size, lineHeight: `${lineH}px` }}>
        {CODE.map((l, i) => {
          const passed = beamY > (i + 0.5) * lineH;
          const bad = l.bad && passed;
          return (
            <div key={i} style={{ whiteSpace: 'pre', color: bad ? C.danger : passed ? C.accentLabel : C.decor }}>
              {l.t}
              {bad ? (
                <span style={{ color: C.danger, opacity: flag, marginLeft: 24 }}>✕ no-sign-transaction</span>
              ) : null}
            </div>
          );
        })}
        <div
          style={{
            position: 'absolute',
            left: -60,
            right: -60,
            top: beamY,
            height: 2,
            background: C.accent,
            boxShadow: `0 0 24px 6px rgba(198,244,50,0.45)`,
            opacity: frame > HOOK.beam[0] && frame < HOOK.beam[1] ? 1 : 0,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const Hook: React.FC<SceneProps> = ({ dur }) => (
  <HookScene
    dur={dur}
    label="SECURITY REVIEW"
    wide={[[{ t: 'Nothing' }, { t: 'goes' }, { t: 'live' }], [{ t: 'unchecked.', c: C.accent }]]}
    tall={[[{ t: 'Nothing' }, { t: 'goes' }], [{ t: 'live' }], [{ t: 'unchecked.', c: C.accent }]]}
    backdrop={<CodeBackdrop dur={dur} />}
  />
);

const UploadCard: React.FC = () => {
  const frame = useCurrentFrame();
  const fly = ease(frame, UPLOAD.fly[0], UPLOAD.fly[1]);
  const landed = frame >= UPLOAD.fly[1];
  const progress = lin(frame, UPLOAD.progress[0], UPLOAD.progress[1]);
  const pinned = ease(frame, UPLOAD.pinned, UPLOAD.pinned + 8);
  const scanning = ease(frame, UPLOAD.scanning, UPLOAD.scanning + 8);
  return (
    <Card style={{ width: 820, padding: 30 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label style={{ fontSize: 15 }}>Studio · new version</Label>
        <Tag size={14}>v1.2.0</Tag>
      </div>
      <div
        style={{
          marginTop: 20,
          height: 200,
          borderRadius: 14,
          border: `2px dashed ${landed ? C.accentBorder : C.borderStrong}`,
          background: landed ? 'rgba(198,244,50,0.03)' : C.inset,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            color: C.muted,
            fontFamily: SANS,
            fontSize: 20,
            opacity: 1 - ease(frame, UPLOAD.fly[1] - 6, UPLOAD.fly[1]),
          }}
        >
          <Upload size={34} color={C.muted} />
          Drop your file
        </div>
        <div
          style={{
            position: 'absolute',
            left: 60,
            right: 60,
            top: 52,
            padding: '18px 22px',
            borderRadius: 12,
            background: C.surface2,
            border: `1px solid ${C.borderStrong}`,
            boxShadow: '0 18px 40px rgba(0,0,0,0.5)',
            opacity: lin(frame, UPLOAD.fly[0], UPLOAD.fly[0] + 4),
            transform: `translate(${(1 - fly) * -260}px, ${(1 - fly) * -300}px) rotate(${(1 - fly) * -12}deg) scale(${1 + 0.15 * (1 - fly)})`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <FileCode size={30} color={C.accent} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 20, color: C.text }}>{FILE}</div>
              <div style={{ fontFamily: MONO, fontSize: 15, color: C.muted, marginTop: 4 }}>
                {progress < 1 ? `uploading · ${(38.4 * progress).toFixed(1)} KB` : 'uploaded · 38.4 KB'}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14, height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: C.accent }} />
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 22,
          padding: '16px 18px',
          borderRadius: 12,
          background: C.inset,
          border: `1px solid ${pinned > 0.5 ? C.accentBorder : C.border}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label style={{ fontSize: 14 }}>SHA-256</Label>
          <span style={{ opacity: pinned, transform: `scale(${0.8 + 0.2 * pinned})` }}>
            <Tag tone="ok" size={14}>
              <Lock size={14} color={C.accent} /> pinned
            </Tag>
          </span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 17, color: C.text, marginTop: 10, wordBreak: 'break-all', minHeight: 48, lineHeight: 1.4 }}>
          {typed(frame, SHA, UPLOAD.sha[0], UPLOAD.sha[1])}
        </div>
      </div>
      <div
        style={{
          marginTop: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          opacity: scanning,
          transform: `translateY(${(1 - scanning) * 8}px)`,
        }}
      >
        <Tag tone="info" size={15}>
          <Spinner size={14} frame={frame} color={C.info} /> scanning
        </Tag>
        <span style={{ fontFamily: SANS, fontSize: 18, color: C.text2 }}>
          Review starts the moment it lands
        </span>
      </div>
    </Card>
  );
};

const UploadScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '01 / UPLOAD',
      wide: [[{ t: 'Pinned' }, { t: 'the' }], [{ t: 'second' }, { t: 'it' }, { t: 'lands.', c: C.accent }]],
      tall: [[{ t: 'Pinned' }, { t: 'the' }, { t: 'second' }], [{ t: 'it' }, { t: 'lands.', c: C.accent }]],
      sub: 'Every version is stored under its SHA-256.',
    }}
    card={<UploadCard />}
    scale={{ wide: 1.02, tall: 1.12 }}
  />
);

const CHECKS = [
  'Userscript header',
  'No eval',
  'No remote code',
  'No obfuscation',
  'No transaction signing',
  'No key access',
  'No clipboard read',
  'Declared network',
  'DOM wallet tamper',
  'Minimal grants',
];

type StepState = { status: 'queued' | 'running' | 'done'; tone: Tone };

const stepState = (frame: number, run: number, done: number): StepState =>
  frame < run
    ? { status: 'queued', tone: 'neutral' }
    : frame < done
      ? { status: 'running', tone: 'info' }
      : { status: 'done', tone: 'ok' };

const ReviewStep: React.FC<{
  n: number;
  title: string;
  desc: string;
  doneText: string;
  verdict: string;
  timing: string;
  state: StepState;
  frame: number;
  extra?: React.ReactNode;
}> = ({ n, title, desc, doneText, verdict, timing, state, frame, extra }) => {
  const running = state.status === 'running';
  const done = state.status === 'done';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: 16,
        padding: '16px 20px',
        borderRadius: 12,
        border: `1px solid ${running ? C.infoBorder : state.status === 'queued' ? C.borderSoft : C.border}`,
        background: running ? C.infoBg : state.status === 'queued' ? 'transparent' : C.surface,
        opacity: state.status === 'queued' ? 0.75 : 1,
      }}
    >
      <Square tone={state.tone} size={40}>
        {running ? <Spinner size={20} frame={frame} color={C.info} /> : done ? '✓' : n}
      </Square>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 600, color: C.text }}>
          {title}
          {state.status !== 'queued' ? (
            <span style={{ fontWeight: 400, color: C.text2 }}>
              {' '}
              · {state.status}
              {done ? ` · ${verdict}` : ''}
            </span>
          ) : null}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 16, color: C.muted, marginTop: 4, lineHeight: 1.35 }}>
          {done ? doneText : desc}
        </div>
        {extra}
      </div>
      <span style={{ fontFamily: MONO, fontSize: 17, color: C.text2 }}>
        {running ? 'running…' : done ? timing : ''}
      </span>
    </div>
  );
};

const LOG = ['egress blocked', 'timeout 15000ms', 'memory 128mb', 'timers run 14', 'interrupt ticks 2'];

const ReviewCard: React.FC = () => {
  const frame = useCurrentFrame();
  const st = stepState(frame, REVIEW.staticRun, REVIEW.staticDone);
  const sb = stepState(frame, REVIEW.sandboxRun, REVIEW.sandboxDone);
  const ai = stepState(frame, REVIEW.verdictRun, REVIEW.verdictDone);
  const live = frame >= REVIEW.live;
  const elapsed =
    frame < REVIEW.staticRun
      ? 0
      : frame < REVIEW.verdictRun
        ? lin(frame, REVIEW.staticRun, REVIEW.verdictRun, [0, 2.3])
        : lin(frame, REVIEW.verdictRun, REVIEW.verdictDone, [2.3, 24.6]);
  const checkIdx = Math.floor(lin(frame, REVIEW.staticRun, REVIEW.staticDone, [0, CHECKS.length - 0.01]));
  const logLines = Math.floor(lin(frame, REVIEW.logs[0], REVIEW.logs[1], [0, LOG.length + 0.99]));
  const logIn = ease(frame, REVIEW.logs[0] - 6, REVIEW.logs[0] + 4);
  const liveIn = ease(frame, REVIEW.live, REVIEW.live + 10);
  return (
    <Card style={{ width: 860, padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontFamily: SANS, fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', color: C.text }}>
          Live review
        </div>
        <div style={{ textAlign: 'right' }}>
          <Label style={{ fontSize: 13 }}>{ai.status === 'done' ? 'Review time' : 'Elapsed'}</Label>
          <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 600, color: C.text }}>{elapsed.toFixed(1)}s</div>
        </div>
      </div>
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 16px',
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          background: C.surface2,
          fontFamily: MONO,
          fontSize: 15,
        }}
      >
        <span style={{ color: C.text }}>{FILE}</span>
        <span style={{ color: C.muted }}>v1.2.0</span>
        <span style={{ color: C.muted }}>sha256 {SHA.slice(0, 10)}…</span>
        <span style={{ marginLeft: 'auto' }}>
          {live ? (
            <Tag tone="ok" size={13}>
              ✓ live
            </Tag>
          ) : (
            <Tag tone="info" size={13}>
              scanning
            </Tag>
          )}
        </span>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        <ReviewStep
          n={1}
          title="Static checks"
          desc="Rules for eval, remote code, key access, obfuscation and declared hosts"
          doneText="All checks passed"
          verdict="pass"
          timing="0.4s"
          state={st}
          frame={frame}
          extra={
            st.status === 'running' ? (
              <div style={{ fontFamily: MONO, fontSize: 14, color: C.info, marginTop: 6 }}>
                ✓ {CHECKS[checkIdx]}
              </div>
            ) : null
          }
        />
        <ReviewStep
          n={2}
          title="Sandbox"
          desc="Runs in an isolated browser sandbox; every request and wallet call is logged"
          doneText="All checks passed"
          verdict="pass"
          timing="1.9s"
          state={sb}
          frame={frame}
        />
        <ReviewStep
          n={3}
          title="Verdict"
          desc="The rules engine and an LLM weigh the code, the checks and your note"
          doneText="Approved: behaviour matches the listing"
          verdict="approve"
          timing="22.3s"
          state={ai}
          frame={frame}
        />
      </div>
      <div style={{ position: 'relative', marginTop: 14, height: 150 }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: C.inset,
            overflow: 'hidden',
            opacity: logIn * (1 - liveIn),
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.borderSoft}` }}>
            <Label style={{ fontSize: 13 }}>Sandbox log</Label>
            <Tag tone="warn" size={12}>
              egress blocked
            </Tag>
            <Tag tone="ok" size={12}>
              0 wallet calls
            </Tag>
            <Tag size={12}>0 hosts</Tag>
          </div>
          <div style={{ padding: '8px 14px', fontFamily: MONO, fontSize: 14, lineHeight: 1.5, color: C.text2 }}>
            {LOG.slice(0, logLines).join('  ·  ')}
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
            opacity: liveIn,
            transform: `scale(${0.96 + 0.04 * liveIn})`,
          }}
        >
          <Square tone="ok" size={48}>
            ✓
          </Square>
          <div>
            <div style={{ fontFamily: SANS, fontSize: 24, fontWeight: 600, color: C.text }}>Approved and live</div>
            <div style={{ fontFamily: SANS, fontSize: 17, color: C.accentBody, marginTop: 4 }}>
              Buyers see the checks and the pinned hash on your listing.
            </div>
          </div>
        </Panel>
      </div>
    </Card>
  );
};

const ReviewScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '02 / LIVE REVIEW',
      wide: [[{ t: 'Scanned.' }], [{ t: 'Sandboxed.' }], [{ t: 'Reviewed.', c: C.accent }]],
      tall: [[{ t: 'Scanned.' }, { t: 'Sandboxed.' }], [{ t: 'Reviewed.', c: C.accent }]],
      sub: 'Streamed step by step while you watch.',
    }}
    card={<ReviewCard />}
    scale={{ wide: 0.97, tall: 1.08 }}
    tallCardTop={600}
  />
);

const Thinking: React.FC<{ frame: number }> = ({ frame }) => (
  <span style={{ display: 'inline-flex', gap: 6 }}>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          width: 9,
          height: 9,
          borderRadius: 5,
          background: C.text2,
          opacity: 0.3 + 0.7 * Math.max(0, Math.sin((frame - i * 4) / 4)),
        }}
      />
    ))}
  </span>
);

const VerdictCard: React.FC = () => {
  const frame = useCurrentFrame();
  const rulesIn = ease(frame, VERDICT.rules, VERDICT.rules + 12);
  const llmIn = ease(frame, VERDICT.llm, VERDICT.llm + 12);
  const rulesP = ease(frame, VERDICT.rulesDecide, VERDICT.rulesDecide + 8);
  const llmP = ease(frame, VERDICT.llmDecide, VERDICT.llmDecide + 8);
  const merge = ease(frame, VERDICT.merge[0], VERDICT.merge[1]);
  const finalP = ease(frame, VERDICT.final, VERDICT.final + 12);
  const marker = ease(frame, VERDICT.final + 6, VERDICT.final + 26);
  const note = ease(frame, VERDICT.note, VERDICT.note + 12);
  const col = (who: string, engine: string, p: number, enter: number, verdict: React.ReactNode, why: string, pending: boolean) => (
    <Card
      style={{
        flex: 1,
        padding: 22,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 30}px)`,
      }}
    >
      <Label style={{ fontSize: 14 }}>{who}</Label>
      <div style={{ fontFamily: MONO, fontSize: 15, color: C.muted, marginTop: 6 }}>{engine}</div>
      <div style={{ marginTop: 20, height: 46, display: 'flex', alignItems: 'center' }}>
        {pending ? (
          <Thinking frame={frame} />
        ) : (
          <span style={{ opacity: p, transform: `scale(${0.85 + 0.15 * p})`, display: 'inline-block' }}>{verdict}</span>
        )}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 17, color: C.text2, marginTop: 12, lineHeight: 1.35, opacity: p, minHeight: 46 }}>
        {why}
      </div>
    </Card>
  );
  const levels = ['approve', 'request changes', 'reject'];
  return (
    <div style={{ width: 860 }}>
      <div style={{ display: 'flex', gap: 18 }}>
        {col(
          'Rules engine',
          'rules@1.0.0',
          rulesP,
          rulesIn,
          <Tag tone="ok" size={22}>
            ✓ approve
          </Tag>,
          'Creator note explains the warning.',
          frame < VERDICT.rulesDecide,
        )}
        {col(
          'LLM',
          'gpt-5.6-luna · reasoning medium',
          llmP,
          llmIn,
          <Tag tone="warn" size={22}>
            ! request changes
          </Tag>,
          'Sends POST requests the listing does not explain.',
          frame < VERDICT.llmDecide,
        )}
      </div>
      <svg width={860} height={70} style={{ display: 'block' }}>
        {[215, 645].map((x) => (
          <path
            key={x}
            d={`M${x} 0 C ${x} 40, 430 30, 430 70`}
            fill="none"
            stroke={C.warn}
            strokeWidth={3}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - merge}
            opacity={0.8}
          />
        ))}
      </svg>
      <Panel
        tone="warn"
        style={{
          padding: '22px 26px',
          opacity: finalP,
          transform: `translateY(${(1 - finalP) * 20}px)`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Label style={{ fontSize: 14, color: C.warn }}>Final verdict · stricter wins</Label>
            <div style={{ fontFamily: SANS, fontSize: 34, fontWeight: 700, color: C.text, marginTop: 6, letterSpacing: '-0.02em' }}>
              Changes requested
            </div>
          </div>
          <Square tone="warn" size={56}>
            !
          </Square>
        </div>
        <div style={{ position: 'relative', marginTop: 22, height: 54 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 4, borderRadius: 2, background: `linear-gradient(90deg, ${C.accent}, ${C.warn}, ${C.danger})`, opacity: 0.7 }} />
          {levels.map((l, i) => (
            <div
              key={l}
              style={{
                position: 'absolute',
                left: `${i * 50}%`,
                top: 24,
                transform: `translateX(${i === 0 ? 0 : i === 2 ? -100 : -50}%)`,
                fontFamily: MONO,
                fontSize: 15,
                color: i === 1 ? C.warn : C.muted,
                whiteSpace: 'nowrap',
              }}
            >
              {l}
            </div>
          ))}
          <div
            style={{
              position: 'absolute',
              top: 2,
              left: `${marker * 50}%`,
              width: 20,
              height: 20,
              borderRadius: 10,
              background: C.text,
              border: `3px solid ${marker > 0.5 ? C.warn : C.accent}`,
              transform: 'translateX(-50%)',
            }}
          />
        </div>
      </Panel>
      <div
        style={{
          marginTop: 16,
          fontFamily: SANS,
          fontSize: 19,
          color: C.text2,
          textAlign: 'center',
          opacity: note,
        }}
      >
        The model can make a verdict stricter, never looser.
      </div>
    </div>
  );
};

const VerdictScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '03 / VERDICT',
      wide: [[{ t: 'They' }, { t: 'disagree?' }], [{ t: 'Stricter' }, { t: 'wins.', c: C.accent }]],
      tall: [[{ t: 'They' }, { t: 'disagree?' }], [{ t: 'Stricter' }, { t: 'wins.', c: C.accent }]],
      sub: 'Rules engine and LLM, combined.',
    }}
    card={<VerdictCard />}
    scale={{ wide: 0.98, tall: 1.08 }}
    tallCardTop={610}
  />
);

const JSON_LINES: { k: string; v: string; ind?: number }[] = [
  { k: '"schema"', v: '"trenchmart.scan-report/v1"' },
  { k: '"cluster"', v: '"devnet"' },
  { k: '"file"', v: '"trojan-trenches-intel.user.js"' },
  { k: '"sha256"', v: '"bd0406ba…c41c20"' },
  { k: '"steps"', v: '["static", "sandbox"]' },
  { k: '"reviews"', v: '[… "rules@1.0.0+llm": "approve"]' },
  { k: '"signature.alg"', v: '"ed25519"' },
  { k: '"publicKey"', v: '"A2S6Ba…1LxCXL"' },
];

const ReportCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const shown = Math.floor(lin(frame, REPORT.json[0], REPORT.json[1], [0, JSON_LINES.length + 0.99]));
  const sign = ease(frame, REPORT.sign, REPORT.sign + 8);
  const browser = ease(frame, REPORT.browser[0], REPORT.browser[1]);
  const bw = tall ? 900 : 960;
  const bh = tall ? 640 : 600;
  return (
    <div style={{ width: bw, height: bh + 60, position: 'relative' }}>
      <Card
        style={{
          position: 'absolute',
          left: tall ? 40 : 60,
          right: tall ? 40 : 60,
          top: 0,
          padding: '24px 28px',
          opacity: 1 - 0.65 * browser,
          transform: `translateY(${-30 * browser}px) scale(${1 - 0.08 * browser})`,
          filter: browser > 0.01 ? `blur(${browser * 3}px)` : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label style={{ fontSize: 14 }}>scan-report.json · Trojan Trenches Intel v1.4.1</Label>
          <span style={{ opacity: sign, transform: `scale(${1.4 - 0.4 * sign}) rotate(${(1 - sign) * -8}deg)`, display: 'inline-block' }}>
            <Tag tone="ok" size={14}>
              ✓ signed · ed25519
            </Tag>
          </span>
        </div>
        <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 18, lineHeight: 1.65 }}>
          {JSON_LINES.slice(0, shown).map((l) => (
            <div key={l.k} style={{ whiteSpace: 'nowrap' }}>
              <span style={{ color: C.info }}>{l.k}</span>
              <span style={{ color: C.muted }}>: </span>
              <span style={{ color: C.accentBody }}>{l.v}</span>
            </div>
          ))}
        </div>
      </Card>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 60,
          opacity: browser,
          transform: `translateY(${(1 - browser) * 120}px)`,
        }}
      >
        <BrowserShot
          src="launch/verify-report.webp"
          imgW={2880}
          url="trenchmart.fun/verify"
          width={bw}
          height={bh}
          crops={[
            { at: REPORT.zoom[0], x: 560, y: 0, w: 1760 },
            { at: REPORT.zoom[1], x: 610, y: 930, w: 1660 },
          ]}
          highlights={[{ x: 670, y: 1424, w: 1536, h: 110, from: REPORT.valid }]}
        />
      </div>
    </div>
  );
};

const ReportScene: React.FC<SceneProps> = ({ dur }) => (
  <LStage
    dur={dur}
    headline={{
      label: '04 / SIGNED REPORT',
      wide: [[{ t: 'Signed.' }, { t: 'Checkable' }], [{ t: 'on' }, { t: '/verify.', c: C.accent }]],
      tall: [[{ t: 'Signed.' }, { t: 'Checkable' }], [{ t: 'on' }, { t: '/verify.', c: C.accent }]],
      sub: 'The check runs in your browser.',
    }}
    card={<ReportCard />}
    scale={{ wide: 0.9, tall: 1.04 }}
    tallCardTop={600}
  />
);

const Outro: React.FC<SceneProps> = ({ dur }) => (
  <OutroScene
    dur={dur}
    tagline={[{ t: 'Reviewed,' }, { t: 'then' }, { t: 'listed.', c: C.accent }]}
  />
);

const COMPONENTS = {
  hook: Hook,
  upload: UploadScene,
  review: ReviewScene,
  verdict: VerdictScene,
  report: ReportScene,
  outro: Outro,
};

export const SecurityVideo: React.FC<LaunchProps> = ({ audio }) => (
  <LaunchShell
    scenes={SECURITY.list}
    components={COMPONENTS}
    captions={captions}
    audioFile="audio/launch/security.flac"
    audio={audio}
  />
);
