'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';

type Alert = { level: 'warn' | 'critical'; code: string; message: string };
type HistoryRow = {
  code: string;
  level: string;
  message: string;
  first_at: string;
  last_at: string;
  notified_at: string | null;
  resolved_at: string | null;
};
type Status = {
  checkedAt: string;
  ok: boolean;
  alerts: Alert[];
  history: HistoryRow[];
  events24h: { kind: string; n: number }[];
  channels: Record<string, boolean>;
  codes: string[];
};

/** Internal status dashboard: the same checks the 5-minute cron alerts on (docs/ops/monitoring.md). */
export default function AdminStatusPage() {
  const wallet = useWallet();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const isAdmin = Boolean(wallet.session?.roles.includes('admin'));

  const load = useCallback(() => {
    setMessage('');
    void api<Status>('/admin/ops')
      .then(setStatus)
      .catch((err: Error) => setMessage(err.message));
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!wallet.session) return <p>Connect an admin wallet.</p>;
  if (!isAdmin) return <p>This wallet is not an admin.</p>;

  const firing = new Set(status?.alerts.map((a) => a.code));
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">Status</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/admin" className="underline">
            Admin
          </Link>
          <button type="button" className="rounded-md border border-line px-3 py-1" onClick={load}>
            Refresh
          </button>
        </div>
      </div>
      {message && <p className="text-sm text-warn">{message}</p>}
      {status && (
        <>
          <p data-testid="ops-overall" className="text-lg">
            {status.ok ? 'All critical checks passing' : 'Critical alerts firing'} ·{' '}
            <span className="text-sm text-muted">
              checked {new Date(status.checkedAt).toLocaleString()}
            </span>
          </p>
          <ul data-testid="ops-alerts" className="space-y-2">
            {status.alerts.map((alert, i) => (
              <li key={`${alert.code}-${i}`} className="rounded-xl border border-line p-3">
                <span className="font-mono text-sm">
                  {alert.level.toUpperCase()} {alert.code}
                </span>
                <p className="text-sm">{alert.message}</p>
              </li>
            ))}
          </ul>
          <div>
            <h2 className="text-xl">Checks</h2>
            <ul data-testid="ops-checks" className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {status.codes.map((code) => (
                <li key={code} className="font-mono">
                  {firing.has(code) ? '✗' : '✓'} {code}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xl">Alert delivery</h2>
            <p data-testid="ops-channels" className="text-sm">
              {Object.entries(status.channels)
                .map(([name, on]) => `${name}: ${on ? 'on' : 'off'}`)
                .join(' · ')}
            </p>
          </div>
          <div>
            <h2 className="text-xl">Errors, last 24 h</h2>
            <p data-testid="ops-events" className="text-sm">
              {status.events24h.length === 0
                ? 'none'
                : status.events24h.map((e) => `${e.kind}: ${e.n}`).join(' · ')}
            </p>
          </div>
          <div>
            <h2 className="text-xl">Alert history</h2>
            <ul data-testid="ops-history" className="mt-2 space-y-1 text-sm">
              {status.history.map((row) => (
                <li key={row.code}>
                  <span className="font-mono">{row.code}</span> ·{' '}
                  {row.resolved_at
                    ? `resolved ${new Date(row.resolved_at).toLocaleString()}`
                    : `open since ${new Date(row.first_at).toLocaleString()}`}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
