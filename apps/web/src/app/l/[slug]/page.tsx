'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { moneyText, solText } from '@/lib/money';
import { useWallet } from '@/lib/wallet';

type Listing = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  terminals: string[];
  price: string;
  license: string;
  holderOnly: boolean;
  security: {
    semver: string;
    sha256: string;
    summary: string;
    checks: { ruleId: string; result: string; title: string; detail: string }[];
    review: { agentId: string; decision: string } | null;
  } | null;
  creator: { handle: string | null; wallet: string; bondLamports: string };
  preview: string | null;
};

type Quote = {
  price: string;
  fee: string;
  rebate: string;
  total: string;
  tier: string;
  totalUsd: { usdCents: string | null };
};

export default function ListingPage() {
  const params = useParams<{ slug: string }>();
  const wallet = useWallet();
  const [listing, setListing] = useState<Listing | null>(null);
  const [tab, setTab] = useState<'security' | 'overview' | 'reviews'>('security');
  const [reviews, setReviews] = useState<{ rating: number; body: string }[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState('');

  useEffect(() => {
    void api<Listing>(`/listings/${params.slug}`)
      .then(setListing)
      .catch(() => setListing(null));
    void api<{ rating: number; body: string }[]>(`/listings/${params.slug}/reviews`)
      .then(setReviews)
      .catch(() => setReviews([]));
  }, [params.slug]);

  async function buy() {
    if (!listing) return;
    setMessage('');
    try {
      if (!wallet.session) await wallet.connect();
      const priced = await api<Quote>('/orders/quote', {
        method: 'POST',
        body: JSON.stringify({ listingId: listing.id }),
      });
      setQuote(priced);
      const created = await api<{ orderId: string; txBase64: string; total: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify({ listingId: listing.id }),
      });
      setOrderId(created.orderId);
      const signature = await wallet.signAndSend(created.txBase64);
      await api(`/orders/${created.orderId}/submitted`, {
        method: 'POST',
        body: JSON.stringify({ txSig: signature }),
      });
      setMessage('Payment seen. Download unlocks after escrow releases.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'checkout failed');
    }
  }

  if (!listing) return <p>Loading listing…</p>;

  return (
    <article className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <p className="text-sm text-muted">
          <Link href="/">Explore</Link> /{' '}
          <Link href={`/c/${listing.category}`}>{listing.category}</Link>
        </p>
        <h1 className="mt-3 text-3xl">{listing.title}</h1>
        <p className="mt-2 text-muted">{listing.summary}</p>
        <p className="mt-2 text-sm">
          {listing.security?.review ? `AI verified · v${listing.security.semver}` : 'Not verified'}
          {listing.terminals.length ? ` · ${listing.terminals.join(', ')}` : ''}
        </p>
        <div className="mt-6 flex gap-2">
          {(['security', 'overview', 'reviews'] as const).map((name) => (
            <button
              key={name}
              type="button"
              className="rounded-md border border-line px-3 py-1 text-sm"
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        {tab === 'security' ? (
          <ul className="mt-4 space-y-2">
            {(listing.security?.checks ?? []).map((check) => (
              <li key={check.ruleId} className="rounded-lg border border-line p-3 text-sm">
                <span className="font-mono text-xs">{check.result}</span> {check.title}
                <p className="text-muted">{check.detail}</p>
              </li>
            ))}
            {listing.preview ? (
              <pre className="mt-4 overflow-auto text-xs text-muted">{listing.preview}</pre>
            ) : null}
          </ul>
        ) : null}
        {tab === 'overview' ? (
          <p className="mt-4 whitespace-pre-wrap">{listing.description}</p>
        ) : null}
        {tab === 'reviews' ? (
          <ul className="mt-4 space-y-2">
            <li className="text-sm text-muted">
              Only wallets that bought this listing can review it.
            </li>
            {reviews.map((review, index) => (
              <li key={index} className="rounded-lg border border-line p-3">
                {review.rating}/5 — {review.body}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <aside data-testid="checkout" className="h-fit rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-2xl">{solText(listing.price)}</p>
        {quote ? (
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>List</dt>
              <dd>{solText(quote.price)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Fee</dt>
              <dd>{solText(quote.fee)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Rebate</dt>
              <dd>{solText(quote.rebate)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>You pay</dt>
              <dd>{moneyText(quote.total, quote.totalUsd.usdCents)}</dd>
            </div>
            <p data-testid="tier-pill" className="text-xs text-muted">
              Tier {quote.tier}
            </p>
          </dl>
        ) : null}
        <button
          data-testid="buy"
          type="button"
          className="mt-4 w-full rounded-md bg-accent py-3 text-onaccent"
          onClick={() => void buy()}
        >
          Buy with SOL
        </button>
        <p className="mt-3 text-xs text-muted">
          Escrow holds funds until the trade finishes. The file stays locked until release.
        </p>
        {listing.holderOnly ? <p className="mt-2 text-xs">Holder-only listing.</p> : null}
        <p className="mt-2 text-xs">License: {listing.license}</p>
        {orderId ? (
          <p className="mt-3 text-sm">
            Order <Link href="/me/purchases">{orderId.slice(0, 8)}</Link>
          </p>
        ) : null}
        {message ? <p className="mt-3 text-sm">{message}</p> : null}
        {message && orderId && !message.includes('Payment') ? null : null}
        <CreatorLink creator={listing.creator} />
      </aside>
    </article>
  );
}

function CreatorLink({ creator }: { creator: Listing['creator'] }) {
  const handle = creator.handle ?? creator.wallet;
  return (
    <p className="mt-4 text-sm">
      <Link href={`/u/${handle}`}>@{creator.handle ?? handle.slice(0, 4)}</Link>
      <span className="text-muted"> · bond {solText(creator.bondLamports)}</span>
    </p>
  );
}
