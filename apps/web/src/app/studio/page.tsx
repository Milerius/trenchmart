'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { solToLamports } from '@trenchmart/shared';
import { api } from '@/lib/api';
import { moneyText, solText } from '@/lib/money';
import { useWallet } from '@/lib/wallet';

type Requirements = {
  xLinked: boolean;
  bondRequired: string;
  bondActive: string;
  bondOk: boolean;
  verificationFee: string;
  feeWaived: boolean;
};

type StudioListing = {
  id: string;
  slug: string;
  title: string;
  price: string;
  version_status: string | null;
  semver: string | null;
};

type Payouts = {
  total: { lamports: string; usdCents: string | null };
  payouts: {
    id: string;
    amount: { lamports: string; usdCents: string | null };
    bucket: string;
    status: string;
  }[];
};

export default function StudioPage() {
  const wallet = useWallet();
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [listings, setListings] = useState<StudioListing[]>([]);
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [handle, setHandle] = useState('');
  const [bond, setBond] = useState('1');
  const [message, setMessage] = useState('');

  async function load() {
    const [req, rows, pay] = await Promise.all([
      api<Requirements>('/studio/requirements'),
      api<StudioListing[]>('/studio/listings'),
      api<Payouts>('/studio/payouts'),
    ]);
    setRequirements(req);
    setListings(rows);
    setPayouts(pay);
  }

  useEffect(() => {
    if (wallet.session) void load().catch((err: Error) => setMessage(err.message));
  }, [wallet.session]);

  async function linkX() {
    await api('/studio/x', { method: 'POST', body: JSON.stringify({ handle }) });
    setMessage('X handle linked for dev.');
    await load();
  }

  async function stakeBond() {
    const lamports = solToLamports(bond).toString();
    const created = await api<{ bondId: string; txBase64: string }>('/studio/bond', {
      method: 'POST',
      body: JSON.stringify({ amount: lamports }),
    });
    const signature = await wallet.signAndSend(created.txBase64);
    await api(`/studio/bond/${created.bondId}/submitted`, {
      method: 'POST',
      body: JSON.stringify({ txSig: signature }),
    });
    setMessage('Bond submitted.');
    await load();
  }

  if (!wallet.session) return <p>Connect a wallet to open the studio.</p>;

  return (
    <section data-testid="studio" className="space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl">Creator studio</h1>
        <Link
          href="/studio/listings/new"
          className="rounded-md bg-accent px-3 py-2 text-sm text-onaccent"
        >
          New listing
        </Link>
      </header>
      {requirements ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          <li className="rounded-xl border border-line p-4">
            X linked: {requirements.xLinked ? 'yes' : 'no'}
          </li>
          <li className="rounded-xl border border-line p-4">
            Bond {solText(requirements.bondActive)} / {solText(requirements.bondRequired)}{' '}
            {requirements.bondOk ? 'ok' : 'short'}
          </li>
          <li className="rounded-xl border border-line p-4">
            Verification fee{' '}
            {requirements.feeWaived ? 'waived' : solText(requirements.verificationFee)}
          </li>
        </ul>
      ) : null}
      {!requirements?.xLinked ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void linkX().catch((err: Error) => setMessage(err.message));
          }}
        >
          <input
            className="rounded-md border border-line bg-inset px-3 py-2"
            placeholder="X handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
          <button type="submit" className="rounded-md border border-line px-3 py-2">
            Link X
          </button>
        </form>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void stakeBond().catch((err: Error) => setMessage(err.message));
        }}
      >
        <input
          className="rounded-md border border-line bg-inset px-3 py-2"
          value={bond}
          onChange={(event) => setBond(event.target.value)}
          aria-label="Bond SOL"
        />
        <button type="submit" className="rounded-md border border-line px-3 py-2">
          Stake bond
        </button>
      </form>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-muted">
            <th>Listing</th>
            <th>Price</th>
            <th>Version</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => (
            <tr key={listing.id} className="border-t border-line">
              <td className="py-2">{listing.title}</td>
              <td className="font-mono">{solText(listing.price)}</td>
              <td>
                {listing.version_status ?? 'draft'} {listing.semver ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section data-testid="dashboard">
        <h2 className="text-xl">Payouts</h2>
        <p className="mt-2 font-mono text-sm">
          {payouts ? moneyText(payouts.total.lamports, payouts.total.usdCents) : '—'}
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {(payouts?.payouts ?? []).map((row) => (
            <li key={row.id}>
              {row.bucket} · {moneyText(row.amount.lamports, row.amount.usdCents)} · {row.status}
            </li>
          ))}
        </ul>
      </section>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
