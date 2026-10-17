'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Button,
  ButtonLink,
  Label,
  Panel,
  Skeleton,
  Square,
  StatusTag,
  Tag,
  type Tone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { ensureVerificationFee } from '@/lib/studio';
import { useWallet } from '@/lib/wallet';

type SandboxLog = {
  requests?: { host: string; method: string; count: number }[];
  walletCalls?: string[];
  errors?: string[];
  log?: string[];
  egress?: string;
  durationMs?: number;
};

type ReviewEvent = {
  step: string;
  status: string;
  durationMs?: number;
  summary?: string;
  verdict?: string;
  decision?: string;
  versionStatus?: string;
  reason?: string;
  resumeStep?: string | null;
  log?: SandboxLog;
};

type VersionView = {
  version: {
    status: string;
    semver: string;
    file_name: string;
    sha256: string;
    creator_note: string | null;
    resume_step?: string | null;
    vfee_lamports?: string | null;
    vfee_sig?: string | null;
  };
  checks: { rule_id: string; result: string; title: string; detail: string; kind: string }[];
  review: { agent_id: string; decision: string; notes: string } | null;
};

const STEP_LABEL: Record<string, string> = {
  static: 'Static checks',
  sandbox: 'Sandbox',
  ai: 'Verdict',
  done: 'Done',
};

const PIPELINE: [string, string][] = [
  ['static', 'Rules for eval, remote code, key access, obfuscation and declared hosts'],
  ['sandbox', 'Runs in an isolated browser sandbox; every request and wallet call is logged'],
  ['ai', 'The rules engine weighs the checks and your note on any warning'],
];

function seconds(durationMs: number | undefined): string {
  if (durationMs === undefined) return '';
  return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

const OUTCOME_WORDS: Record<string, string> = {
  pass: 'All checks passed',
  warn: 'Passed with warnings',
  fail: 'Failed checks',
  na: 'Not needed for this file type',
  approve: 'Approved: behaviour matches the listing',
  request_changes: 'Changes requested',
  reject: 'Rejected',
  retry: 'Sandbox unavailable, nothing was decided',
  error: 'Sandbox could not run: retry the review',
};

function describe(event: ReviewEvent | undefined, fallback: string): string {
  if (!event || event.status === 'running') return fallback;
  if (event.status === 'skipped')
    return `Skipped: already passed (${event.summary ?? event.verdict ?? 'pass'})`;
  const key = event.decision ?? event.verdict ?? event.summary;
  return (key && OUTCOME_WORDS[key]) ?? event.summary ?? fallback;
}

function stepTone(event: ReviewEvent | undefined): Tone {
  if (!event) return 'neutral';
  if (event.status === 'running') return 'info';
  const value = (event.verdict ?? event.decision ?? event.status).toLowerCase();
  if (/(fail|reject|error)/.test(value)) return 'danger';
  if (/(warn|needs|changes)/.test(value)) return 'warn';
  return 'ok';
}

export default function VersionPage() {
  const params = useParams<{ id: string; vid: string }>();
  const wallet = useWallet();
  const [view, setView] = useState<VersionView | null>(null);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    setView(await api<VersionView>(`/studio/versions/${params.vid}`));
  }

  async function stream(path: string) {
    setRunning(true);
    setEvents([]);
    setStartedAt(Date.now());
    const response = await fetch(path, {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      credentials: 'include',
    });
    if (!response.ok || !response.body) {
      setMessage('Review did not start');
      setRunning(false);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const dataLine = part.split('\n').find((row) => row.startsWith('data:'));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.replace(/^data:\s?/, '')) as ReviewEvent;
        setEvents((current) => {
          const without = current.filter(
            (item) => item.step !== event.step || item.status === 'running',
          );
          return [
            ...without.filter(
              (item) =>
                !(
                  item.step === event.step &&
                  item.status === 'running' &&
                  event.status !== 'running'
                ),
            ),
            event,
          ];
        });
      }
    }
    setRunning(false);
    setNow(Date.now());
    await load();
  }

  useEffect(() => {
    void load()
      .then(() => undefined)
      .catch((err: Error) => setMessage(err.message));
  }, [params.vid]);

  useEffect(() => {
    if (!view || running || events.length > 0) return;
    if (view.version.status === 'uploading' || view.version.status === 'scanning') {
      const uploading = view.version.status === 'uploading';
      const path = uploading
        ? `/api/v1/studio/versions/${params.vid}/complete?stream=1`
        : `/api/v1/studio/versions/${params.vid}/review?stream=1`;
      // A fee left unpaid (wallet closed, page reloaded) would make /complete fail with
      // FEE_REQUIRED, so settle it first. This is a no-op when it is paid or waived.
      const feeOpen = BigInt(view.version.vfee_lamports ?? '0') > 0n && !view.version.vfee_sig;
      const ready =
        uploading && feeOpen
          ? ensureVerificationFee({ api, versionId: params.vid, signAndSend: wallet.signAndSend })
          : Promise.resolve(false);
      void ready.then(() => stream(path)).catch((err: Error) => setMessage(err.message));
    }
  }, [view, params.vid]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running]);

  async function explain() {
    const result = await api<{ status: string }>(`/studio/versions/${params.vid}/explain`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    setMessage(result.status === 'live' ? 'Approved and live' : `Status ${result.status}`);
    await stream(`/api/v1/studio/versions/${params.vid}/review?stream=1`);
  }

  async function replaceFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await api(`/studio/versions/${params.vid}/reupload`, {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, contentBase64: btoa(binary) }),
    });
    await stream(`/api/v1/studio/versions/${params.vid}/review?stream=1`);
  }

  const outcome = [...events].reverse().find((event) => event.versionStatus);
  const sandbox = [...events].reverse().find((event) => event.log);
  const status = outcome?.versionStatus ?? view?.version.status;
  // An infrastructure failure leaves no sandbox scan and no new AI verdict: offer a retry.
  const sandboxRetry = outcome
    ? outcome.decision === 'retry'
    : view?.version.resume_step === 'sandbox' && !view.checks.some((c) => c.kind === 'sandbox');
  const byStep = new Map(events.filter((e) => e.step !== 'done').map((e) => [e.step, e]));
  const totalMs = events
    .filter((e) => e.step !== 'done' && e.status !== 'running')
    .reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  const elapsed = startedAt ? (running ? now - startedAt : totalMs || now - startedAt) : 0;

  return (
    <section data-testid="studio" className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/studio" className="text-sm text-muted hover:text-ink">
          ← Studio
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[32px] font-semibold tracking-[-0.03em]">Live review</h1>
            <p className="m-0 mt-1 max-w-2xl text-ink-2">
              Your file is checked the moment it lands. Static checks and the sandbox run together,
              then the rules engine gives its verdict. Most reviews finish in seconds.
            </p>
          </div>
          <div className="text-right" aria-live="off">
            <Label>{running ? 'Elapsed' : 'Review time'}</Label>
            <p className="tabular m-0 font-mono text-2xl font-semibold">
              {startedAt ? seconds(elapsed) : '—'}
            </p>
          </div>
        </div>
      </div>

      {view ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface px-4 py-3 font-mono text-[13px]">
          <span className="text-ink">{view.version.file_name}</span>
          <span className="text-muted">v{view.version.semver}</span>
          <span className="text-muted" title={view.version.sha256}>
            sha256 {view.version.sha256.slice(0, 10)}…
          </span>
          <span className="ml-auto">
            <StatusTag status={status ?? view.version.status} />
          </span>
          {view.version.resume_step ? (
            <span className="w-full text-xs text-muted">
              Resumes from {STEP_LABEL[view.version.resume_step] ?? view.version.resume_step}
            </span>
          ) : null}
        </div>
      ) : (
        <Skeleton className="h-12 w-full" />
      )}

      <ol aria-label="Live review" aria-live="polite" className="m-0 space-y-2 p-0">
        {PIPELINE.map(([step, description], index) => {
          const event = byStep.get(step);
          const tone = stepTone(event);
          const isRunning = event?.status === 'running';
          const content = (
            <>
              <Square tone={tone}>
                {isRunning ? (
                  <span className="animate-spin">◑</span>
                ) : tone === 'ok' ? (
                  '✓'
                ) : tone === 'warn' ? (
                  '!'
                ) : tone === 'danger' ? (
                  '×'
                ) : (
                  index + 1
                )}
              </Square>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {STEP_LABEL[step]}
                  {event ? (
                    <span className="font-normal text-ink-2">
                      {' '}
                      · {event.status}
                      {event.verdict ? ` · ${event.verdict}` : ''}
                    </span>
                  ) : null}
                </span>
                <span className="block text-[13px] text-muted">{describe(event, description)}</span>
              </span>
            </>
          );
          return event ? (
            <li
              key={step}
              data-testid="review-step"
              data-step={step}
              data-status={event.status}
              className={`grid list-none grid-cols-[auto_1fr_auto] items-center gap-3 rounded-card border px-4 py-3 ${
                isRunning ? 'border-info-line bg-info-bg' : 'border-line bg-surface'
              }`}
            >
              {content}
              <span data-testid="review-timing" className="tabular font-mono text-sm text-ink-2">
                {isRunning ? 'running…' : seconds(event.durationMs)}
              </span>
            </li>
          ) : (
            <li
              key={step}
              className="grid list-none grid-cols-[auto_1fr_auto] items-center gap-3 rounded-card border border-line-soft px-4 py-3 opacity-80"
            >
              {content}
              <span className="font-mono text-sm text-muted">{running ? 'queued' : ''}</span>
            </li>
          );
        })}
      </ol>

      {sandbox?.log ? (
        <div className="overflow-hidden rounded-card border border-line bg-inset">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2">
            <Label>Sandbox log</Label>
            <Tag tone={sandbox.log.egress === 'blocked' ? 'warn' : 'neutral'}>
              EGRESS {String(sandbox.log.egress ?? 'logged').toUpperCase()}
            </Tag>
            <Tag tone={(sandbox.log.walletCalls ?? []).length ? 'danger' : 'ok'}>
              {(sandbox.log.walletCalls ?? []).length} WALLET CALLS
            </Tag>
            <Tag tone="neutral">{(sandbox.log.requests ?? []).length} HOSTS</Tag>
          </div>
          <pre
            data-testid="sandbox-log"
            className="m-0 max-h-72 overflow-auto p-4 font-mono text-xs leading-relaxed text-ink-2"
          >
            {(sandbox.log.log ?? []).join('\n')}
            {(sandbox.log.walletCalls ?? []).length
              ? `\nwallet ${sandbox.log.walletCalls?.join(', ')}`
              : ''}
            {(sandbox.log.requests ?? [])
              .map((item) => `\n${item.method} ${item.host} blocked`)
              .join('')}
          </pre>
        </div>
      ) : null}

      {status === 'live' ? (
        <Panel
          tone="ok"
          data-testid="review-outcome"
          className="flex flex-wrap items-center gap-4 p-5"
        >
          <Square tone="ok">✓</Square>
          <div className="min-w-0 flex-1">
            <p className="m-0 font-semibold">Approved and live</p>
            <p className="m-0 text-sm text-accent-body">
              Reviewed{totalMs ? ` in ${seconds(totalMs)}` : ''}. Buyers see the checks and the
              pinned hash on your listing.
            </p>
          </div>
          <ButtonLink href="/studio" variant="secondary">
            Back to studio
          </ButtonLink>
        </Panel>
      ) : null}
      {status === 'needs_creator' && sandboxRetry ? (
        <Panel tone="warn" data-testid="review-outcome" className="space-y-3 p-5">
          <p className="m-0 font-semibold">Sandbox unavailable</p>
          <p className="m-0 text-sm text-ink-2">
            {outcome?.reason ??
              'The sandbox could not run this time. This is not a verdict on your file; retry the review.'}
          </p>
          <Button
            data-testid="retry-review"
            disabled={running}
            onClick={() =>
              void stream(`/api/v1/studio/versions/${params.vid}/review?stream=1`).catch(
                (err: Error) => setMessage(err.message),
              )
            }
          >
            Retry review
          </Button>
        </Panel>
      ) : null}
      {status === 'needs_creator' && !sandboxRetry ? (
        <Panel tone="warn" data-testid="review-outcome" className="space-y-4 p-5">
          <div>
            <p className="m-0 font-semibold">Changes requested</p>
            <p className="m-0 mt-1 text-sm text-ink-2">{outcome?.reason ?? view?.review?.notes}</p>
          </div>
          <div>
            <label htmlFor="creator-note" className="text-sm font-medium">
              Explain the warning
            </label>
            <textarea
              id="creator-note"
              rows={3}
              className="mt-2 w-full rounded-ctl border border-line-control bg-inset px-3 py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Explain the warning, at least 20 characters"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={running}
              onClick={() => void explain().catch((err: Error) => setMessage(err.message))}
            >
              Save note and resume
            </Button>
            <label className="text-sm text-ink-2">
              or upload a fixed file
              <input
                type="file"
                className="mt-1 block text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void replaceFile(file).catch((err: Error) => setMessage(err.message));
                }}
              />
            </label>
          </div>
        </Panel>
      ) : null}
      {status === 'rejected' ? (
        <Panel tone="danger" data-testid="review-outcome" className="p-5">
          <p className="m-0 font-semibold">Rejected</p>
          <p className="m-0 mt-1 text-sm text-ink-2">{outcome?.reason ?? view?.review?.notes}</p>
          <p className="m-0 mt-3 text-[13px] text-muted">
            Fix the issue above and upload a new version. Each version is reviewed the same way.
          </p>
        </Panel>
      ) : null}
      {message ? (
        <p role="status" className="m-0 text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
