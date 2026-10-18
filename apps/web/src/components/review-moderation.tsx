'use client';

import { useEffect, useState } from 'react';
import { Button, Tag, utc } from '@/components/ui';
import { api } from '@/lib/api';

type Flagged = {
  id: string;
  rating: number;
  body: string;
  title: string;
  slug: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  reports: number;
  counted_reports: number;
  reasons: string[] | null;
};

/** Admin queue: reported or hidden reviews. Hide or restore; either settles the open reports. */
export function ReviewModeration() {
  const [rows, setRows] = useState<Flagged[] | null>(null);
  const [error, setError] = useState('');

  function load() {
    void api<Flagged[]>('/admin/reviews')
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }
  useEffect(load, []);

  async function moderate(id: string, action: 'hide' | 'restore') {
    try {
      await api(`/admin/reviews/${id}/moderate`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Moderation failed');
    }
  }

  return (
    <div data-testid="review-moderation" className="space-y-3">
      <h2 className="m-0 text-xl font-semibold">Reported reviews</h2>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {rows && rows.length === 0 ? <p className="m-0 text-muted">No reported reviews.</p> : null}
      <ul className="m-0 space-y-3 p-0">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="list-none rounded-card border border-line bg-surface p-4">
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
              <a
                href={`/l/${row.slug}`}
                className="font-semibold underline-offset-4 hover:underline"
              >
                {row.title}
              </a>
              <span className="font-mono text-accent">{'★'.repeat(row.rating)}</span>
              {row.hidden_at ? (
                <Tag tone="warn">HIDDEN · {row.hidden_reason ?? 'moderation'}</Tag>
              ) : (
                <Tag tone="ok">VISIBLE</Tag>
              )}
              <span className="text-muted">
                {row.reports} open report{row.reports === 1 ? '' : 's'} ({row.counted_reports}{' '}
                counted){row.reasons?.length ? ` · ${row.reasons.join(', ')}` : ''}
              </span>
              {row.hidden_at ? (
                <span className="text-[12px] text-muted">since {utc(row.hidden_at)}</span>
              ) : null}
            </p>
            <p className="m-0 mt-2 whitespace-pre-wrap text-sm text-ink-2">{row.body}</p>
            <div className="mt-3 flex gap-2">
              {row.hidden_at ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void moderate(row.id, 'restore')}
                >
                  Restore
                </Button>
              ) : (
                <Button size="sm" variant="danger" onClick={() => void moderate(row.id, 'hide')}>
                  Hide
                </Button>
              )}
              {row.hidden_at ? null : (
                <Button size="sm" variant="ghost" onClick={() => void moderate(row.id, 'restore')}>
                  Dismiss reports
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
