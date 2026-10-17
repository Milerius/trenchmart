'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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
  };
  checks: { rule_id: string; result: string; title: string; detail: string; kind: string }[];
  review: { agent_id: string; decision: string; notes: string } | null;
};

const STEP_LABEL: Record<string, string> = {
  static: 'Static checks',
  sandbox: 'Sandbox',
  ai: 'AI verdict',
  done: 'Done',
};

function seconds(durationMs: number | undefined): string {
  if (durationMs === undefined) return '';
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default function VersionPage() {
  const params = useParams<{ id: string; vid: string }>();
  const [view, setView] = useState<VersionView | null>(null);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);

  async function load() {
    setView(await api<VersionView>(`/studio/versions/${params.vid}`));
  }

  async function stream(path: string) {
    setRunning(true);
    setEvents([]);
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
      const path =
        view.version.status === 'uploading'
          ? `/api/v1/studio/versions/${params.vid}/complete?stream=1`
          : `/api/v1/studio/versions/${params.vid}/review?stream=1`;
      void stream(path).catch((err: Error) => setMessage(err.message));
    }
  }, [view, params.vid]);

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

  return (
    <section data-testid="studio" className="space-y-4">
      <h1 className="text-3xl">Live AI review</h1>
      <p className="text-sm text-muted">
        The file is checked as soon as it is uploaded. Static checks and the sandbox run together.
        There is no human appeal.
      </p>
      {view ? (
        <p className="text-sm">
          {view.version.file_name} · {view.version.semver} · {view.version.status}
          {view.version.resume_step ? ` · resumes from ${view.version.resume_step}` : ''}
        </p>
      ) : null}
      <ol aria-label="Live AI review" aria-live="polite" className="space-y-2">
        {events
          .filter((event) => event.step !== 'done')
          .map((event) => (
            <li
              key={`${event.step}-${event.status}`}
              data-testid="review-step"
              className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-line px-3 py-2 text-sm"
            >
              <span>
                {STEP_LABEL[event.step] ?? event.step} · {event.status}
                {event.verdict ? ` · ${event.verdict}` : ''}
              </span>
              <span data-testid="review-timing" className="font-mono text-muted">
                {seconds(event.durationMs)}
              </span>
            </li>
          ))}
      </ol>
      {sandbox?.log ? (
        <pre
          data-testid="sandbox-log"
          className="overflow-auto rounded-xl border border-line bg-inset p-3 text-xs"
        >
          {sandbox.log.egress === 'blocked' ? 'egress blocked\n' : ''}
          {(sandbox.log.log ?? []).join('\n')}
          {(sandbox.log.walletCalls ?? []).length
            ? `\nwallet ${sandbox.log.walletCalls?.join(', ')}`
            : ''}
          {(sandbox.log.requests ?? [])
            .map((item) => `\n${item.method} ${item.host} blocked`)
            .join('')}
        </pre>
      ) : null}
      {status === 'live' ? <p data-testid="review-outcome">Approved and live</p> : null}
      {status === 'needs_creator' ? (
        <div data-testid="review-outcome" className="space-y-3">
          <p>Changes requested</p>
          <p className="text-sm">{outcome?.reason ?? view?.review?.notes}</p>
          <textarea
            className="w-full rounded-md border border-line bg-inset px-3 py-2"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Explain the warning, at least 20 characters"
          />
          <button
            type="button"
            className="rounded-md border border-line px-3 py-2"
            onClick={() => void explain().catch((err: Error) => setMessage(err.message))}
          >
            Save note and resume
          </button>
          <label className="block text-sm">
            Upload a fixed file
            <input
              type="file"
              className="mt-1 block"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void replaceFile(file).catch((err: Error) => setMessage(err.message));
              }}
            />
          </label>
        </div>
      ) : null}
      {status === 'rejected' ? (
        <div data-testid="review-outcome">
          <p>Rejected</p>
          <p className="text-sm">{outcome?.reason ?? view?.review?.notes}</p>
        </div>
      ) : null}
      {message ? <p>{message}</p> : null}
    </section>
  );
}
