'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';

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
  const wallet = useWallet();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ disputeId: string; txBase64: string | null }>(
        `/orders/${params.id}/dispute`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: String(data.get('reason') ?? 'other'),
            details: String(data.get('details') ?? ''),
          }),
        },
      );
      if (result.txBase64) {
        // Freeze the on-chain escrow too, so release cannot run when the window ends.
        setMessage(`Dispute ${result.disputeId} opened. Approve the escrow freeze in your wallet.`);
        try {
          await wallet.signAndSend(result.txBase64);
        } catch {
          // Signing can be retried: a fresh transaction comes from /dispute/tx.
          const retry = await api<{ onChain: boolean; txBase64: string | null }>(
            `/orders/${params.id}/dispute/tx`,
            { method: 'POST' },
          );
          if (retry.txBase64) await wallet.signAndSend(retry.txBase64);
        }
      }
      setMessage(`Dispute ${result.disputeId} opened. The escrow is frozen and downloads pause.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the dispute');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      data-testid="dispute"
      className="mx-auto flex max-w-3xl flex-col gap-6 sm:py-4"
      onSubmit={(event) => void submit(event)}
    >
      <div>
        <Link href="/me/purchases" className="text-sm text-muted hover:text-ink">
          ← Purchases
        </Link>
        <h1 className="m-0 mt-4 text-5xl font-semibold tracking-[-0.045em]">Open a dispute</h1>
        <p className="m-0 mt-3 text-ink-2">
          You sign one transaction that freezes the on-chain escrow, so release cannot pay the
          creator. Downloads pause while the dispute is open. If it is upheld the escrow refunds you
          in full; if it is rejected, the order returns to payout.
        </p>
      </div>
      <fieldset
        data-testid="dispute-reasons"
        className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2"
      >
        <legend className="mb-3 font-semibold">What went wrong?</legend>
        {REASONS.map(([value, label, hint]) => (
          <label
            key={value}
            className="flex cursor-pointer gap-3 rounded-2xl border border-line p-4 transition hover:border-line-strong has-[:checked]:border-danger/60 has-[:checked]:bg-danger/[.06]"
          >
            <input
              type="radio"
              name="reason"
              value={value}
              defaultChecked={value === 'not_as_described'}
              className="mt-1 accent-[var(--color-danger)]"
            />
            <span>
              <span className="block font-medium">{label}</span>
              <span className="block text-sm text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="details" className="font-semibold">
          Details
        </label>
        <textarea
          id="details"
          name="details"
          required
          minLength={10}
          rows={5}
          aria-describedby="details-hint"
          className="mt-2 w-full rounded-2xl border border-line bg-inset p-4 outline-none focus:border-accent-line"
          placeholder="What you expected, what happened, and anything that helps check it"
        />
        <p id="details-hint" className="m-0 mt-2 text-sm text-faint">
          At least 10 characters.
        </p>
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={busy || !!message}
        className="self-start !border-danger !bg-danger !text-black hover:brightness-110"
      >
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
