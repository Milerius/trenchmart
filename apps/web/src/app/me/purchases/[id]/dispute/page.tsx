'use client';

import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';

export default function DisputePage() {
  const params = useParams<{ id: string }>();
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await api<{ disputeId: string }>(`/orders/${params.id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({
        reason: String(data.get('reason') ?? 'other'),
        details: String(data.get('details') ?? ''),
      }),
    });
    setMessage(`Dispute ${result.disputeId} opened. The download stays locked.`);
  }

  return (
    <form
      data-testid="dispute"
      className="mx-auto max-w-xl space-y-3"
      onSubmit={(event) => void submit(event).catch((err: Error) => setMessage(err.message))}
    >
      <h1 className="text-3xl">Open a dispute</h1>
      <p className="text-sm text-muted">
        Escrow stays locked while the dispute is open. A rejected dispute returns the order to
        payout. An upheld dispute refunds you.
      </p>
      <fieldset className="space-y-1 text-sm">
        {['malicious', 'not_as_described', 'broken', 'other'].map((reason) => (
          <label key={reason} className="block">
            <input
              type="radio"
              name="reason"
              value={reason}
              defaultChecked={reason === 'not_as_described'}
            />{' '}
            {reason}
          </label>
        ))}
      </fieldset>
      <textarea
        name="details"
        required
        minLength={10}
        className="w-full rounded-md border border-line bg-inset px-3 py-2"
        placeholder="What went wrong"
      />
      <button type="submit" className="rounded-md bg-accent px-4 py-2 text-onaccent">
        Submit dispute
      </button>
      {message ? <p>{message}</p> : null}
    </form>
  );
}
