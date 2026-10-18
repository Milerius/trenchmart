'use client';

import { DEFAULT_ESCROW_HOURS, escrowWindowLabel } from '@trenchmart/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { solToLamports } from '@trenchmart/shared';
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  Label,
  Money,
  Panel,
  Skeleton,
  Square,
  StatusTag,
  utc,
} from '@/components/ui';
import { api } from '@/lib/api';
import { submitPayment } from '@/lib/studio';
import { TIER_LABEL, usePublicConfig, useSolUsd } from '@/lib/config';
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
  category: string;
  sales_7d?: number;
  rating_avg?: string | null;
  delisted_at?: string | null;
  version_status: string | null;
  semver: string | null;
};

type Payout = {
  id: string;
  amount: { lamports: string; usdCents: string | null };
  bucket: string;
  status: string;
  created_at?: string;
};

type Payouts = {
  total: { lamports: string; usdCents: string | null };
  payouts: Payout[];
};

export default function StudioPage() {
  const wallet = useWallet();
  const centsPerSol = useSolUsd();
  const config = usePublicConfig();
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [listings, setListings] = useState<StudioListing[] | null>(null);
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [loadError, setLoadError] = useState('');
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

  function reload() {
    setLoadError('');
    void load().catch((err: Error) => setLoadError(err.message));
  }

  useEffect(() => {
    if (wallet.session) reload();
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
    await submitPayment(api, `/studio/bond/${created.bondId}/submitted`, signature);
    setMessage('Bond submitted.');
    await load();
  }

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Creator studio</h1>
        <p className="mt-3 text-ink-2">Connect a wallet to open the studio.</p>
        <p className="mt-1 text-sm text-muted">
          List tooling with 0% commission. Every upload is reviewed live by automated checks.
        </p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }

  const rows = payouts?.payouts ?? [];
  const sum = (filter: (p: Payout) => boolean) =>
    rows.filter(filter).reduce((total, p) => total + BigInt(p.amount.lamports), 0n);
  const paidOut = sum((p) => p.status === 'sent');
  const queued = sum((p) => p.status === 'pending' || p.status === 'proposed');
  const live = (listings ?? []).filter((l) => l.version_status === 'live' && !l.delisted_at);
  const sales = (listings ?? []).reduce((total, l) => total + (l.sales_7d ?? 0), 0);

  return (
    <section data-testid="studio" className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Creator studio</Label>
          <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.03em]">
            {wallet.session.handle ? `@${wallet.session.handle}` : 'Your studio'}
          </h1>
          <p className="m-0 mt-1 text-sm text-ink-2">
            {TIER_LABEL[wallet.session.tier] ?? wallet.session.tier} · 0% creator commission ·
            payouts in SOL from the Squads vault
          </p>
        </div>
        <ButtonLink href="/studio/listings/new" size="lg">
          New listing
        </ButtonLink>
      </header>

      {loadError ? (
        <ErrorState title="Couldn't load the studio" body={loadError} onRetry={reload} />
      ) : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4">
        <Tile label="Paid out">
          {payouts ? (
            <Money lamports={paidOut} centsPerSol={centsPerSol} stacked />
          ) : (
            <Skeleton className="h-7 w-24" />
          )}
        </Tile>
        <Tile label="Queued payouts">
          {payouts ? (
            <Money lamports={queued} centsPerSol={centsPerSol} stacked />
          ) : (
            <Skeleton className="h-7 w-24" />
          )}
        </Tile>
        <Tile label="Live listings">
          {listings ? (
            <span className="text-2xl font-semibold">{live.length}</span>
          ) : (
            <Skeleton className="h-7 w-10" />
          )}
        </Tile>
        <Tile label="Sales, last 7 days">
          {listings ? (
            <span className="text-2xl font-semibold">{sales}</span>
          ) : (
            <Skeleton className="h-7 w-10" />
          )}
        </Tile>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-panel border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
              <h2 className="m-0 text-base font-semibold">Listings</h2>
              <span className="text-xs text-muted">{listings?.length ?? 0} total</span>
            </div>
            {listings && listings.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No listings yet"
                  body="Upload a file and automated review runs live: static scan, sandbox run and verdict."
                  action={
                    <ButtonLink href="/studio/listings/new">Create your first listing</ButtonLink>
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Listing
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Version
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Price
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-medium">
                        Sales 7d
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(listings ?? []).map((listing) => (
                      <tr key={listing.id} className="border-t border-line-soft">
                        <td className="px-5 py-3">
                          <Link
                            href={`/l/${listing.slug}`}
                            className="font-medium hover:text-accent-hover"
                          >
                            {listing.title}
                          </Link>
                          <Link
                            href={`/studio/listings/${listing.id}/content`}
                            className="mt-0.5 block text-xs text-muted hover:text-ink"
                          >
                            Edit page: images, README, install guide →
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-2">
                            <StatusTag
                              status={
                                listing.delisted_at
                                  ? 'delisted'
                                  : (listing.version_status ?? 'draft')
                              }
                            />
                            {listing.semver ? (
                              <span className="font-mono text-xs text-muted">
                                v{listing.semver}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Money lamports={listing.price} centsPerSol={centsPerSol} stacked />
                        </td>
                        <td className="tabular px-5 py-3 text-right font-mono">
                          {listing.sales_7d ?? 0}
                        </td>
                      </tr>
                    ))}
                    {listings === null
                      ? [0, 1].map((key) => (
                          <tr key={key} className="border-t border-line-soft">
                            <td colSpan={4} className="px-5 py-3">
                              <Skeleton className="h-5 w-full" />
                            </td>
                          </tr>
                        ))
                      : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <section
            data-testid="dashboard"
            className="overflow-hidden rounded-panel border border-line bg-surface"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-soft px-5 py-3">
              <h2 className="m-0 text-base font-semibold">Payouts</h2>
              <span className="text-sm text-ink-2">
                Total{' '}
                {payouts ? (
                  <Money
                    lamports={payouts.total.lamports}
                    usdCents={payouts.total.usdCents}
                    strong
                  />
                ) : (
                  '—'
                )}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="m-0 px-5 py-4 text-sm text-muted">
                No payouts yet. A sale pays out after its{' '}
                {escrowWindowLabel(config?.escrowHours ?? DEFAULT_ESCROW_HOURS)} escrow releases
                with no dispute.
              </p>
            ) : (
              <ul className="m-0 p-0">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-3 first:border-t-0"
                  >
                    <span className="flex items-center gap-3">
                      <StatusTag status={row.status} kind="payout" />
                      <span className="text-sm text-ink-2">
                        {row.bucket === 'creator'
                          ? 'Sale'
                          : row.bucket === 'refund'
                            ? 'Refund'
                            : row.bucket}
                        {row.created_at ? (
                          <span className="text-muted"> · {utc(row.created_at)}</span>
                        ) : null}
                      </span>
                    </span>
                    <Money lamports={row.amount.lamports} usdCents={row.amount.usdCents} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-panel border border-line bg-surface p-5">
            <h2 className="m-0 text-base font-semibold">Ready to sell</h2>
            {requirements ? (
              <ul className="m-0 mt-4 space-y-3 p-0 text-sm">
                <Requirement ok title="Wallet signed in" />
                <Requirement ok={requirements.xLinked} title="X account linked">
                  {!requirements.xLinked ? (
                    <form
                      className="mt-2 flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void linkX().catch((err: Error) => setMessage(err.message));
                      }}
                    >
                      <input
                        className="h-9 min-w-0 flex-1 rounded-ctl border border-line-control bg-inset px-3 text-sm"
                        placeholder="X handle"
                        aria-label="X handle"
                        value={handle}
                        onChange={(event) => setHandle(event.target.value)}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Link X
                      </Button>
                    </form>
                  ) : null}
                </Requirement>
                <Requirement ok={requirements.bondOk} title="Creator bond">
                  <span className="mt-1 block text-[13px] text-ink-2">
                    <Money lamports={requirements.bondActive} centsPerSol={centsPerSol} /> of{' '}
                    <Money lamports={requirements.bondRequired} centsPerSol={centsPerSol} />{' '}
                    required
                  </span>
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void stakeBond().catch((err: Error) => setMessage(err.message));
                    }}
                  >
                    <input
                      className="h-9 w-24 rounded-ctl border border-line-control bg-inset px-3 font-mono text-sm"
                      value={bond}
                      inputMode="decimal"
                      onChange={(event) => setBond(event.target.value)}
                      aria-label="Bond SOL"
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      Stake bond
                    </Button>
                  </form>
                </Requirement>
                <Requirement ok title="Verification fee">
                  <span className="mt-1 block text-[13px] text-ink-2">
                    {requirements.verificationFee === '0' ? (
                      'Free right now'
                    ) : requirements.feeWaived ? (
                      'Waived for your tier'
                    ) : (
                      <>
                        <Money lamports={requirements.verificationFee} centsPerSol={centsPerSol} />{' '}
                        per version
                      </>
                    )}
                  </span>
                </Requirement>
              </ul>
            ) : (
              <div className="mt-4 space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            )}
          </div>
          <Panel tone="info" className="p-4 text-[13px] text-ink-2">
            Uploads are reviewed live: static scan, sandbox run, rules verdict. Most finish in
            seconds, and you watch every step.
          </Panel>
          {message ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {message}
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-5">
      <Label>{label}</Label>
      <div className="tabular mt-1 flex flex-col font-mono">{children}</div>
    </div>
  );
}

function Requirement({
  ok,
  title,
  children,
}: {
  ok: boolean;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex list-none gap-3">
      <Square tone={ok ? 'ok' : 'warn'}>{ok ? '✓' : '!'}</Square>
      <div className="min-w-0 flex-1">
        <span className="font-medium">{title}</span>
        <span className="sr-only">{ok ? ' (done)' : ' (needed)'}</span>
        {children}
      </div>
    </li>
  );
}
