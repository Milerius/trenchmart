'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Panel } from '@/components/ui';
import { api } from '@/lib/api';

const REASONS: [string, string, string][] = [
  ['not_as_described', 'Not as described', 'The listing page promised something this does not do.'],
  ['broken', 'Broken or changed', 'It does not work, or the listing changed after I paid.'],
  [
    'malicious',
    'Malicious or unsafe',
    'It reads keys, signs transactions or calls hosts it did not declare.',
  ],
  ['other', 'Something else', 'Explain below.'],
];

export default function DisputePage() {
  const params = useParams<{ id: string }>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ disputeId: string }>(`/orders/${params.id}/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          reason: String(data.get('reason') ?? 'other'),
          details: String(data.get('details') ?? ''),
        }),
      });
      setMessage(`Dispute ${result.disputeId} opened. The download stays locked.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the dispute');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      data-testid="dispute"
      className="mx-auto max-w-xl space-y-6"
      onSubmit={(event) => void submit(event)}
    >
      <div>
        <Link href="/me/purchases" className="text-sm text-muted hover:text-ink">
          ← Purchases
        </Link>
        <h1 className="mt-3 text-[28px]">Open a dispute</h1>
        <p className="mt-2 text-ink-2">
          Release is paused as soon as you submit, and the download stays locked. If the dispute is
          upheld you are refunded. If it is rejected, the order returns to payout.
        </p>
      </div>
      <fieldset className="m-0 space-y-2 border-0 p-0">
        <legend className="mb-2 text-sm font-medium">What went wrong?</legend>
        {REASONS.map(([value, label, hint]) => (
          <label
            key={value}
            className="flex cursor-pointer gap-3 rounded-card border border-line bg-surface p-3 has-[:checked]:border-accent-line has-[:checked]:bg-accent-bg"
          >
            <input
              type="radio"
              name="reason"
              value={value}
              defaultChecked={value === 'not_as_described'}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-[13px] text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="details" className="text-sm font-medium">
          Details
        </label>
        <textarea
          id="details"
          name="details"
          required
          minLength={10}
          rows={5}
          aria-describedby="details-hint"
          className="mt-2 w-full rounded-ctl border border-line-control bg-inset px-3 py-2 text-sm"
          placeholder="What you expected, what happened, and anything that helps check it"
        />
        <p id="details-hint" className="mt-1 text-xs text-muted">
          At least 10 characters.
        </p>
      </div>
      <Button type="submit" size="lg" disabled={busy || !!message}>
        {busy ? 'Opening dispute…' : 'Submit dispute'}
      </Button>
      {message ? (
        <Panel tone="ok" role="status" className="p-3 text-sm">
          {message}
        </Panel>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
