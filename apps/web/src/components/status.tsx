'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocHeader, DocSection } from '@/components/doc';
import {
  Button,
  Card,
  ErrorState,
  Label,
  Panel,
  Serif,
  Skeleton,
  Tag,
  utc,
  type Tone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { PayoutsCard } from '@/components/payouts';

// Public status page over GET /api/v1/status (docs/ops/status-page.md). Every number here comes
// from the 5-minute probes; days without a probe are drawn grey ("no data"), never guessed.

type State = 'operational' | 'degraded' | 'down' | 'unknown';
type DayState = 'operational' | 'degraded' | 'down' | 'none';
type Day = { date: string; state: DayState; uptime: number | null; samples: number };
type Component = {
  id: string;
  name: string;
  state: State;
  checkedAt: string | null;
  latencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  uptime90: number | null;
  days: Day[];
};
type Incident = {
  id: number;
  component: string;
  componentName: string;
  title: string;
  impact: 'minor' | 'major';
  status: 'ongoing' | 'resolved';
  startedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
};
export type PublicStatus = {
  checkedAt: string | null;
  generatedAt: string;
  cluster: string;
  overall: State;
  intervalMinutes: number;
  windowDays: number;
  components: Component[];
  incidents: Incident[];
};

const REFRESH_MS = 60_000;

const WHAT: Record<string, string> = {
  web: 'trenchmart.fun, checked from outside our infrastructure',
  api: 'api.trenchmart.fun, checked from outside our infrastructure',
  rpc: 'the Solana devnet RPC the app reads and sends through',
  escrow: 'escrow program reachable, releases and refunds on time',
  db: 'reads and writes',
  uploads: 'file storage and the automated review pipeline',
  auth: 'wallet sign-in',
};

const STATE: Record<State, [string, Tone]> = {
  operational: ['Operational', 'ok'],
  degraded: ['Degraded', 'warn'],
  down: ['Down', 'danger'],
  unknown: ['No recent data', 'neutral'],
};

const DAY_CLASS: Record<DayState, string> = {
  operational: 'bg-accent/80',
  degraded: 'bg-warn',
  down: 'bg-danger',
  none: 'bg-line-strong',
};
const DAY_LABEL: Record<DayState, string> = {
  operational: 'operational',
  degraded: 'degraded',
  down: 'outage',
  none: 'no data',
};

function ms(value: number | null): string {
  if (value === null) return '–';
  return value >= 10_000 ? `${(value / 1000).toFixed(0)} s` : `${value} ms`;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function Dot({ state, size = 'sm' }: { state: State; size?: 'sm' | 'lg' }) {
  const bg =
    state === 'operational'
      ? 'bg-accent'
      : state === 'degraded'
        ? 'bg-warn'
        : state === 'down'
          ? 'bg-danger'
          : 'bg-line-control';
  return (
    <span
      aria-hidden="true"
      className={`${state === 'unknown' ? '' : 'live-dot'} block shrink-0 rounded-full ${bg} ${
        size === 'lg'
          ? `h-3 w-3 ${state === 'operational' ? 'shadow-[0_0_16px_var(--color-accent)]' : ''}`
          : 'h-2 w-2'
      }`}
    />
  );
}

function UptimeBar({ component }: { component: Component }) {
  const days = component.days;
  const withData = days.filter((d) => d.state !== 'none').length;
  return (
    <div>
      <div
        role="img"
        aria-label={`${component.name}: ${withData} of ${days.length} days with data`}
        data-testid={`bar-${component.id}`}
        className="flex h-8 gap-[2px]"
      >
        {days.map((d, i) => (
          <span
            key={d.date}
            data-state={d.state}
            title={`${d.date}: ${DAY_LABEL[d.state]}${d.uptime !== null ? ` · ${d.uptime}% up · ${d.samples} checks` : ''}`}
            className={`min-w-0 flex-1 rounded-[2px] ${DAY_CLASS[d.state]} ${i < days.length - 30 ? 'hidden sm:block' : ''}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-faint">
        <span className="hidden sm:inline">{days.length} days ago</span>
        <span className="sm:hidden">30 days ago</span>
        <span>today</span>
      </div>
    </div>
  );
}

function ComponentRow({ c }: { c: Component }) {
  const [label, tone] = STATE[c.state];
  return (
    <div className="p-4 sm:p-5" data-testid={`status-${c.id}`} data-state={c.state}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-2">
            <Dot state={c.state} />
          </span>
          <div className="min-w-0">
            <h3 className="m-0 text-[15px] font-semibold">{c.name}</h3>
            <p className="m-0 text-[13px] text-muted">{WHAT[c.id] ?? ''}</p>
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-4 pl-5 sm:w-auto sm:pl-0">
          <div className="font-mono text-[12px] leading-5 sm:text-right">
            <span className="block text-muted">
              {c.latencyMs !== null ? `last ${ms(c.latencyMs)}` : 'latency, 24 h'}
            </span>
            <span className="tabular whitespace-nowrap text-ink" data-testid={`latency-${c.id}`}>
              {c.p50Ms === null ? 'no data yet' : `p50 ${ms(c.p50Ms)} · p95 ${ms(c.p95Ms)}`}
            </span>
          </div>
          <Tag tone={tone}>{label.toUpperCase()}</Tag>
        </div>
      </div>
      <div className="mt-3 flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <UptimeBar component={c} />
        </div>
        <span
          className="tabular w-16 pb-5 text-right font-mono text-[13px] text-ink-2"
          data-testid={`uptime-${c.id}`}
        >
          {c.uptime90 === null ? '–' : `${c.uptime90}%`}
        </span>
      </div>
    </div>
  );
}

function Overall({ status }: { status: PublicStatus }) {
  const bad = status.components.filter((c) => c.state === 'down' || c.state === 'degraded');
  const tone: Tone =
    status.overall === 'down'
      ? 'danger'
      : status.overall === 'degraded'
        ? 'warn'
        : status.overall === 'operational'
          ? 'ok'
          : 'neutral';
  const title =
    status.overall === 'unknown'
      ? 'No recent checks'
      : bad.length === 0
        ? 'All systems operational'
        : `${bad.map((c) => c.name).join(', ')} ${bad.length === 1 ? 'is' : 'are'} ${
            bad.some((c) => c.state === 'down') ? 'having an outage' : 'degraded'
          }`;
  const body =
    status.overall === 'unknown'
      ? 'The 5-minute checks have not reported in the last 20 minutes, so there is nothing current to show.'
      : bad.length === 0
        ? 'Every component answered its last check normally.'
        : 'Everything else answered its last check normally. Funds in escrow are safe either way: a buyer can always refund on chain after the timeout.';
  return (
    <Panel
      tone={tone}
      className="relative mt-8 flex items-start gap-3 overflow-hidden !rounded-[26px] p-6 sm:p-7"
      data-testid="status-overall"
    >
      {tone === 'ok' ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-10 h-60 w-60 rounded-full bg-accent/20 blur-3xl"
        />
      ) : null}
      <span className="relative mt-3">
        <Dot state={status.overall} size="lg" />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="m-0 text-2xl font-semibold tracking-[-0.02em]">{title}</p>
        <p className="m-0 mt-2 text-ink-2">{body}</p>
        <p className="m-0 mt-3 font-mono text-xs text-faint" data-testid="status-checked">
          {status.checkedAt ? `last check ${utc(status.checkedAt)}` : 'no checks yet'} · every{' '}
          {status.intervalMinutes} min · {status.cluster}
        </p>
      </div>
    </Panel>
  );
}

function Summary({ status }: { status: PublicStatus }) {
  const covered = status.components.filter((c) => c.uptime90 !== null);
  const uptime = covered.length
    ? `${Math.min(...covered.map((c) => c.uptime90 as number))}%`
    : 'No data yet';
  const apiRow = status.components.find((c) => c.id === 'api');
  const historyDays = Math.max(
    0,
    ...status.components.map((c) => c.days.filter((d) => d.state !== 'none').length),
  );
  const open = status.incidents.filter((i) => i.status === 'ongoing').length;
  const tiles: [string, string, string][] = [
    ['90-day uptime · lowest', uptime, 'summary-uptime'],
    [
      'API p50 / p95 · 24 h',
      apiRow?.p50Ms != null ? `${ms(apiRow.p50Ms)} / ${ms(apiRow.p95Ms)}` : 'No data yet',
      'summary-api',
    ],
    ['Open incidents', String(open), 'summary-open'],
    ['Days of history', `${historyDays} of ${status.windowDays}`, 'summary-history'],
  ];
  return (
    <dl className="m-0 mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(([label, value, id]) => (
        <div key={id} className="min-w-0 rounded-card border border-line bg-surface p-4">
          <dt>
            <Label>{label}</Label>
          </dt>
          <dd className="tabular m-0 mt-1 text-lg font-semibold" data-testid={id}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Incidents({ status }: { status: PublicStatus }) {
  if (status.incidents.length === 0)
    return (
      <p
        className="m-0 mt-4 rounded-card border border-line bg-inset p-5 text-sm text-ink-2"
        data-testid="incidents-empty"
      >
        No incidents in the last {status.windowDays} days of recorded history.
      </p>
    );
  return (
    <ol className="m-0 mt-4 list-none space-y-3 p-0" data-testid="incidents">
      {status.incidents.map((inc) => (
        <li key={inc.id}>
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Label>{utc(inc.startedAt)}</Label>
              <Tag tone={inc.status === 'ongoing' ? 'warn' : 'neutral'}>
                {inc.status === 'ongoing' ? 'ONGOING' : 'RESOLVED'}
              </Tag>
              <Tag tone={inc.impact === 'major' ? 'danger' : 'warn'}>
                {inc.impact.toUpperCase()}
              </Tag>
              <span className="ml-auto font-mono text-[12px] text-muted">
                {inc.status === 'ongoing' ? 'for ' : ''}
                {duration(inc.durationMinutes)}
              </span>
            </div>
            <p className="m-0 mt-2 font-semibold">{inc.title}</p>
            <p className="m-0 mt-0.5 text-[13px] text-muted">
              {inc.status === 'ongoing'
                ? `Started ${utc(inc.startedAt)}, still not normal at the last check. Checks run every 5 minutes.`
                : `${utc(inc.startedAt)} to ${utc(inc.resolvedAt as string)}.`}
            </p>
          </Card>
        </li>
      ))}
    </ol>
  );
}

export function StatusBoard() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<PublicStatus>('/status')
      .then((s) => {
        setStatus(s);
        setError('');
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const firstData = status?.components
    .flatMap((c) => c.days.filter((d) => d.state !== 'none').map((d) => d.date))
    .sort()[0];
  const shortHistory =
    status !== null &&
    status.components.some((c) => c.days.slice(0, 1).every((d) => d.state === 'none'));

  return (
    <article className="mx-auto max-w-5xl sm:py-4">
      <DocHeader
        kicker="Status"
        title={
          <>
            System <Serif>status</Serif>
          </>
        }
        lede="Health and speed of the TrenchMart website, API, Solana devnet RPC, escrow, database, uploads and sign-in. Checked every 5 minutes, the website, API and RPC from outside our own infrastructure. Every time is UTC."
      />
      {error && !status ? (
        <div className="mt-6">
          <ErrorState
            title="Couldn't load the status"
            body={`${error}. If the API itself is down, this page cannot reach it either.`}
            onRetry={load}
          />
        </div>
      ) : null}
      {!status && !error ? (
        <div className="mt-6 space-y-3" data-testid="status-loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}
      {status ? (
        <>
          <Overall status={status} />
          <Summary status={status} />
          <section className="mt-10" aria-labelledby="components-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="components-heading" className="m-0 text-xl font-semibold tracking-[-0.02em]">
                Components
              </h2>
              <Button variant="secondary" size="sm" onClick={load}>
                Refresh
              </Button>
            </div>
            <p className="m-0 mt-1 text-sm text-ink-2">
              Latency is the last 24 h of checks. A day is amber if any check that day was slow or
              degraded, red if one failed, and grey if there is no data for it.
              {shortHistory && firstData ? (
                <span data-testid="history-note">
                  {' '}
                  History starts {firstData}; earlier days are grey because nothing was recorded
                  yet.
                </span>
              ) : null}
            </p>
            <Card className="mt-4 divide-y divide-line-soft" data-testid="status-components">
              {status.components.map((c) => (
                <ComponentRow key={c.id} c={c} />
              ))}
            </Card>
          </section>
          <section className="mt-10" aria-labelledby="incidents-heading">
            <h2 id="incidents-heading" className="m-0 text-xl font-semibold tracking-[-0.02em]">
              Incident history
            </h2>
            <p className="m-0 mt-1 text-sm text-ink-2">
              Opened automatically when a component stops answering normally for more than one
              check, closed when it recovers.
            </p>
            <Incidents status={status} />
          </section>
        </>
      ) : null}
      <div className="mt-10">
        <PayoutsCard />
      </div>
      <DocSection id="how" title="How to read this">
        <p>
          <strong className="text-ink">Operational</strong> means the last check got a normal
          answer. <strong className="text-ink">Degraded</strong> means it answered but slower than
          its threshold, or a background step (scans, releases) is running late.{' '}
          <strong className="text-ink">Down</strong> means an error or no answer.{' '}
          <strong className="text-ink">No recent data</strong> means the checks themselves have not
          reported for 20 minutes.
        </p>
        <p>
          Funds never depend on this page: paid orders sit in an on-chain escrow, and a buyer can
          always refund after the timeout, even while the API is down.
        </p>
        <p>
          The same summary is public as JSON at{' '}
          <a
            className="font-mono text-ink underline"
            href="https://api.trenchmart.fun/api/v1/status"
          >
            api.trenchmart.fun/api/v1/status
          </a>
          , cached for 60 seconds.
        </p>
      </DocSection>
    </article>
  );
}
