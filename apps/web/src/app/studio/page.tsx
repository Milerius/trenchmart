'use client';

import { categoryMeta } from '@trenchmart/shared/categories';
import { DEFAULT_ESCROW_HOURS } from '@trenchmart/shared/config';
import { escrowWindowLabel } from '@trenchmart/shared/escrow';
import { solToLamports } from '@trenchmart/shared/money';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { preload } from 'react-dom';
import { Avatar, VerifiedBadge } from '@/components/profile';
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
  Tag,
  utc,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  actionFor,
  barShare,
  bucketOf,
  sparkPoints,
  statusNote,
  statusOf,
  type Bucket,
  type Overview,
  type OverviewListing,
} from '@/lib/dashboard';
import { monthYear, shortWallet } from '@/lib/profile-format';
import { submitPayment } from '@/lib/studio';
import { readStudioCache, writeStudioCache } from '@/lib/studio-cache';
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

const TABS: { key: Bucket | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'review', label: 'In review' },
  { key: 'draft', label: 'Drafts' },
];

// The dashboard reads start with the HTML (same URL and credentials mode as api(), so the
// browser hands the preloaded responses to the fetches below instead of asking again).
const STUDIO_READS = ['/studio/requirements', '/studio/overview', '/studio/payouts'] as const;

type CachedSession = { wallet: string; handle: string | null; tier: string };

export default function StudioPage() {
  for (const path of STUDIO_READS)
    preload(`/api/v1${path}`, { as: 'fetch', crossOrigin: 'use-credentials' });
  const wallet = useWallet();
  const router = useRouter();
  const centsPerSol = useSolUsd();
  const config = usePublicConfig();
  // Last data from this tab: shown at once on a repeat visit, refreshed in the background.
  const [cached] = useState(() =>
    readStudioCache<Requirements, Overview, Payouts>(wallet.session?.wallet ?? null),
  );
  const [requirements, setRequirements] = useState<Requirements | null>(
    cached?.requirements ?? null,
  );
  const [overview, setOverview] = useState<Overview | null>(cached?.overview ?? null);
  const [payouts, setPayouts] = useState<Payouts | null>(cached?.payouts ?? null);
  const [loadError, setLoadError] = useState('');
  const [bond, setBond] = useState('1');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<Bucket | 'all'>('all');
  const inflight = useRef(false);
  const [dropped, setDropped] = useState(0);
  const sessionWallet = wallet.session?.wallet ?? null;
  // The latest session for async callbacks; written in an effect (declared before the mount
  // load below, so it is current when that load settles).
  const sessionRef = useRef({ wallet: sessionWallet, checked: wallet.checked });
  useEffect(() => {
    sessionRef.current = { wallet: sessionWallet, checked: wallet.checked };
  }, [sessionWallet, wallet.checked]);

  async function load() {
    inflight.current = true;
    const startedFor = sessionRef.current.wallet;
    try {
      const [req, view, pay] = await Promise.all([
        api<Requirements>('/studio/requirements'),
        api<Overview>('/studio/overview'),
        api<Payouts>('/studio/payouts'),
      ]);
      // Drop answers that no longer belong to the session (signed out or switched wallet
      // while they were in flight). While the first session check is pending, keep them.
      const now = sessionRef.current;
      if (now.wallet ? now.wallet !== view.creator.wallet : now.checked) {
        // The session changed meanwhile: let the session effect read again for it (once per
        // change, so a cookie that answers for another wallet cannot loop).
        if (now.wallet !== startedFor) setDropped((n) => n + 1);
        return;
      }
      setRequirements(req);
      setOverview(view);
      setPayouts(pay);
      writeStudioCache(view.creator.wallet, { requirements: req, overview: view, payouts: pay });
    } finally {
      inflight.current = false;
    }
  }

  function reload() {
    setLoadError('');
    void load().catch((err: Error) => setLoadError(err.message));
  }

  // Start the reads on mount, in parallel with the session check (the cookie decides who is
  // asking), instead of waiting for /me first. Signed out, they are 401s and are ignored.
  useEffect(() => {
    void load().catch((err: Error) => {
      if (sessionRef.current.wallet) setLoadError(err.message);
    });
  }, []);

  // Once the session is known: keep data that belongs to it, otherwise (another wallet, or
  // the early read failed) read again.
  useEffect(() => {
    if (!sessionWallet || inflight.current) return;
    if (overview?.creator.wallet === sessionWallet) return;
    if (overview) {
      setOverview(null);
      setRequirements(null);
      setPayouts(null);
    }
    reload();
  }, [sessionWallet, overview, dropped]);

  // X linking lives on the profile now; older X callbacks still land here, so forward them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('x');
    if (!result) return;
    const forward = new URLSearchParams({ x: result });
    const reason = params.get('reason');
    if (reason) forward.set('reason', reason);
    router.replace(`/studio/profile?${forward.toString()}`);
  }, [router]);

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

  // Session not known yet: render the studio straight away (from this tab's last data, or
  // skeletons) rather than a "Connect wallet" screen that flips a moment later.
  const pendingSession: CachedSession | null =
    !wallet.session && !wallet.checked
      ? {
          wallet: overview?.creator.wallet ?? '',
          handle: overview?.creator.handle ?? null,
          tier: '',
        }
      : null;

  if (!wallet.session && !pendingSession) {
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

  const session = wallet.session ?? pendingSession!;
  const creator = overview?.creator;
  const listings = overview?.listings ?? null;
  const escrowLabel = escrowWindowLabel(config?.escrowHours ?? DEFAULT_ESCROW_HOURS);
  const name = creator?.displayName || (session.handle ? `@${session.handle}` : 'Your studio');
  const publicHref = `/u/${session.handle ?? session.wallet}`;
  const waiting = (listings ?? []).filter((l) => statusOf(l) === 'needs_creator');
  const counts = (key: Bucket | 'all') =>
    key === 'all'
      ? (listings ?? []).length
      : (listings ?? []).filter((l) => bucketOf(l) === key).length;
  const shown = (listings ?? []).filter((l) => tab === 'all' || bucketOf(l) === tab);
  const rows = payouts?.payouts ?? [];
  const subscribed = (listings ?? []).filter((l) => l.subscribers > 0);

  return (
    <section data-testid="studio" className="min-w-0 max-w-full space-y-6">
      <header
        data-testid="studio-header"
        className="flex flex-wrap items-center justify-between gap-5 rounded-panel border border-line bg-surface p-5 sm:p-6"
      >
        <div className="flex min-w-0 items-center gap-4">
          <Avatar
            image={creator?.avatarUrl ?? null}
            name={creator?.displayName ?? session.handle}
            fallback={session.wallet}
            className="h-16 w-16 text-xl"
            ring="ring-2 ring-line"
          />
          <div className="min-w-0">
            <Label>Creator studio</Label>
            <h1 className="m-0 mt-0.5 flex items-center gap-2 truncate text-[26px] font-semibold tracking-[-0.03em]">
              {name}
              {creator?.xVerified ? <VerifiedBadge /> : null}
            </h1>
            <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
              {session.handle && creator?.displayName ? <span>@{session.handle}</span> : null}
              <span data-testid="studio-x">
                {creator?.xHandle
                  ? creator.xVerified
                    ? `X @${creator.xHandle} · verified`
                    : `X @${creator.xHandle} · not verified`
                  : 'X not linked'}
              </span>
              <span>{TIER_LABEL[session.tier] ?? session.tier}</span>
              {creator?.memberSince ? (
                <span>Member since {monthYear(creator.memberSince)}</span>
              ) : null}
              <span className="font-mono text-muted">{shortWallet(session.wallet)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={publicHref} variant="ghost">
            View public profile
          </ButtonLink>
          <ButtonLink href="/studio/profile" variant="secondary">
            Edit profile
          </ButtonLink>
          <ButtonLink href="/studio/featuring" variant="secondary">
            Feature a listing
          </ButtonLink>
          <ButtonLink href="/studio/api-keys" variant="secondary">
            API keys
          </ButtonLink>
          <ButtonLink href="/studio/listings/new">+ New listing</ButtonLink>
        </div>
      </header>

      {loadError ? (
        <ErrorState title="Couldn't load the studio" body={loadError} onRetry={reload} />
      ) : null}

      {waiting.map((l) => (
        <Panel
          key={l.id}
          tone="warn"
          className="flex flex-wrap items-center justify-between gap-3 p-4"
          data-testid="needs-note"
        >
          <div>
            <p className="m-0 text-sm font-semibold">
              {l.title} v{l.latest?.semver} needs your note
            </p>
            <p className="m-0 mt-0.5 text-[13px] text-ink-2">
              The review flagged something it wants explained.
              {l.live ? ` v${l.live.semver} stays live for buyers meanwhile.` : ''}
            </p>
          </div>
          <ButtonLink
            href={`/studio/listings/${l.id}/versions/${l.latest?.id}`}
            variant="secondary"
            size="sm"
          >
            Add review note →
          </ButtonLink>
        </Panel>
      ))}

      <Stats overview={overview} centsPerSol={centsPerSol} escrowLabel={escrowLabel} />

      <Checklist
        requirements={requirements}
        overview={overview}
        centsPerSol={centsPerSol}
        bond={bond}
        setBond={setBond}
        onStake={() => void stakeBond().catch((err: Error) => setMessage(err.message))}
        wallet={session.wallet}
      />

      {message ? (
        <p role="status" className="m-0 text-sm text-ink-2">
          {message}
        </p>
      ) : null}

      <div className="relative min-w-0 overflow-hidden rounded-panel border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="m-0 text-base font-semibold">Listings</h2>
            <div role="tablist" aria-label="Filter listings" className="flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-ctl px-2.5 py-1 text-[13px] ${tab === t.key ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {t.label}{' '}
                  <span className="font-mono text-[11px] text-muted">{counts(t.key)}</span>
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs text-muted">Newest first</span>
        </div>
        {listings && listings.length > 0 ? (
          <ul className="m-0 p-0 sm:hidden" data-testid="studio-listing-cards">
            {shown.map((l) => (
              <ListingCard key={l.id} listing={l} centsPerSol={centsPerSol} />
            ))}
            {shown.length === 0 ? (
              <li className="list-none px-5 py-6 text-center text-sm text-muted">Nothing here.</li>
            ) : null}
          </ul>
        ) : null}
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
          <div className="relative hidden overflow-x-auto sm:block">
            <table
              data-testid="studio-listings"
              className="w-full min-w-[860px] border-collapse text-sm"
            >
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    Listing
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Version
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Price
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Sales 7d
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Subs
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Rating
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <ListingRow key={l.id} listing={l} centsPerSol={centsPerSol} />
                ))}
                {listings === null
                  ? [0, 1, 2].map((key) => (
                      <tr key={key} className="border-t border-line-soft">
                        <td colSpan={8} className="px-5 py-3">
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))
                  : null}
                {listings && listings.length > 0 && shown.length === 0 ? (
                  <tr className="border-t border-line-soft">
                    <td colSpan={8} className="px-5 py-6 text-center text-sm text-muted">
                      Nothing here.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <section
          data-testid="dashboard"
          className="overflow-hidden rounded-panel border border-line bg-surface"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-soft px-5 py-3">
            <h2 className="m-0 text-base font-semibold">Payouts</h2>
            <span className="text-sm text-ink-2">
              Total{' '}
              {payouts ? (
                <Money lamports={payouts.total.lamports} usdCents={payouts.total.usdCents} strong />
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-px border-b border-line-soft bg-line-soft sm:grid-cols-3">
            <PayoutCell label="Sent" note="from the Squads vault">
              {overview ? (
                <Money lamports={overview.payouts.sent} centsPerSol={centsPerSol} />
              ) : null}
            </PayoutCell>
            <PayoutCell label="In multisig" note="queued or awaiting signatures">
              {overview ? (
                <Money
                  lamports={(
                    BigInt(overview.payouts.inMultisig) + BigInt(overview.payouts.queued)
                  ).toString()}
                  centsPerSol={centsPerSol}
                />
              ) : null}
            </PayoutCell>
            <PayoutCell
              label="In escrow"
              note={
                overview?.payouts.nextRelease
                  ? `next release ${utc(overview.payouts.nextRelease)}`
                  : `releases ${escrowLabel} after a sale, no dispute`
              }
            >
              {overview ? (
                <Money lamports={overview.payouts.inEscrow} centsPerSol={centsPerSol} />
              ) : null}
            </PayoutCell>
          </div>
          {rows.length === 0 ? (
            <p className="m-0 px-5 py-4 text-sm text-muted">
              No payouts yet. A sale pays out after its {escrowLabel} escrow releases with no
              dispute.
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
                        ? 'Sale or renewal'
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

        <aside className="space-y-4">
          <div
            data-testid="updates-card"
            className="rounded-panel border border-line bg-surface p-5"
          >
            <Label>Update subscriptions</Label>
            {overview ? (
              <>
                <p className="m-0 mt-2 font-mono text-2xl font-semibold">
                  <Money lamports={overview.updates.monthly} />
                  <span className="text-sm font-normal text-muted"> / month</span>
                </p>
                <p className="m-0 mt-1 text-[13px] text-ink-2">
                  {overview.updates.paying} paying · {overview.updates.inFreeMonth} in their free
                  first month
                </p>
                {subscribed.length ? (
                  <ul className="m-0 mt-3 space-y-1.5 p-0 text-[13px]">
                    {subscribed.map((l) => (
                      <li key={l.id} className="flex list-none justify-between gap-3">
                        <span className="truncate text-ink-2">{l.title}</span>
                        <span className="font-mono text-ink">{l.subscribers}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <Skeleton className="mt-2 h-8 w-32" />
            )}
          </div>
          <Panel tone="info" className="p-4 text-[13px] text-ink-2">
            Uploading a new version keeps the current one live. Buyers switch over once the new file
            passes review; subscribers get it automatically.
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function Stats({
  overview,
  centsPerSol,
  escrowLabel,
}: {
  overview: Overview | null;
  centsPerSol: string | null;
  escrowLabel: string;
}) {
  if (!overview) {
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="bg-surface p-5">
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    );
  }
  const o = overview;
  const tiles = o.rating ? 5 : 4;
  return (
    <div
      data-testid="studio-stats"
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line ${tiles === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}
    >
      <Tile label={`Revenue · ${o.days}d`} testid="stat-revenue" wide>
        <Money
          lamports={o.revenue.total}
          centsPerSol={centsPerSol}
          stacked
          strong
          className="text-2xl"
        />
        <Spark values={o.revenue.daily} />
      </Tile>
      <Tile label={`Sales · ${o.days}d`} testid="stat-sales">
        <span className="text-2xl font-semibold">{o.sales.total30d}</span>
        <span className="text-[12px] text-muted">{o.sales.last7d} in the last 7 days</span>
        <Spark values={o.sales.daily} />
      </Tile>
      <Tile label="Update subscribers" testid="stat-subs">
        <span className="text-2xl font-semibold">{o.updates.paying}</span>
        <span className="text-[12px] text-muted">
          <Money lamports={o.updates.monthly} /> / month recurring
        </span>
      </Tile>
      {o.rating ? (
        <Tile label="Rating" testid="stat-rating">
          <span className="text-2xl font-semibold">★ {o.rating.avg.toFixed(1)}</span>
          <span className="text-[12px] text-muted">
            {o.rating.count} review{o.rating.count === 1 ? '' : 's'} · {o.disputes.upheld} disputes
            upheld
          </span>
          <ul className="m-0 mt-2 space-y-1 p-0" aria-label="Rating breakdown">
            {o.rating.distribution.map((n, i) => (
              <li key={i} className="flex list-none items-center gap-2 text-[11px] text-muted">
                <span className="w-2">{5 - i}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${barShare(n, o.rating!.distribution)}%` }}
                  />
                </span>
                <span className="w-5 text-right">{n}</span>
              </li>
            ))}
          </ul>
        </Tile>
      ) : null}
      <Tile label="Paid out · all time" testid="stat-paid">
        <Money
          lamports={o.payouts.sent}
          centsPerSol={centsPerSol}
          stacked
          strong
          className="text-2xl"
        />
        <span className="text-[12px] text-muted">
          <Money lamports={o.payouts.inEscrow} /> in {escrowLabel} escrow
        </span>
      </Tile>
    </div>
  );
}

function Spark({ values }: { values: readonly (string | number)[] }) {
  const points = sparkPoints(values, 160, 32);
  if (!points)
    return <span className="mt-2 block h-8 text-[11px] text-faint">No activity yet</span>;
  return (
    <svg
      viewBox="0 0 160 32"
      className="mt-2 h-8 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Tile({
  label,
  testid,
  wide = false,
  children,
}: {
  label: string;
  testid: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      className={`flex min-w-0 flex-col gap-1 bg-surface p-4 sm:p-5 ${wide ? 'col-span-2 lg:col-span-1' : ''}`}
    >
      <Label>{label}</Label>
      <div className="tabular mt-1 flex flex-col gap-0.5 font-mono">{children}</div>
    </div>
  );
}

function Checklist({
  requirements,
  overview,
  centsPerSol,
  bond,
  setBond,
  onStake,
  wallet,
}: {
  requirements: Requirements | null;
  overview: Overview | null;
  centsPerSol: string | null;
  bond: string;
  setBond: (v: string) => void;
  onStake: () => void;
  wallet: string;
}) {
  const filled = overview?.creator.profileFilled;
  const needed = requirements ? [true, requirements.xLinked, requirements.bondOk, true] : [];
  return (
    <section
      aria-labelledby="ready-heading"
      className="rounded-panel border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="ready-heading" className="m-0 text-base font-semibold">
          Ready to sell
        </h2>
        {requirements ? (
          <Tag tone={needed.every(Boolean) ? 'ok' : 'warn'}>
            {needed.filter(Boolean).length} of {needed.length} required
          </Tag>
        ) : null}
      </div>
      {requirements ? (
        <ul className="m-0 mt-4 grid gap-4 p-0 text-sm sm:grid-cols-2 xl:grid-cols-5">
          <Requirement ok title="Wallet signed in">
            <span className="mt-1 block font-mono text-[12px] text-ink-2">
              {shortWallet(wallet)} · payouts land here
            </span>
          </Requirement>
          <Requirement ok={requirements.xLinked} title="X account linked">
            <Link
              href="/studio/profile#socials"
              data-testid="link-x-profile"
              className="mt-1 block text-[13px] text-accent hover:text-accent-hover"
            >
              {requirements.xLinked ? 'Manage in your profile →' : 'Link X in your profile →'}
            </Link>
          </Requirement>
          <Requirement ok={requirements.bondOk} title="Creator bond">
            <span className="mt-1 block text-[13px] text-ink-2">
              <Money lamports={requirements.bondActive} centsPerSol={centsPerSol} /> of{' '}
              <Money lamports={requirements.bondRequired} centsPerSol={centsPerSol} /> required
            </span>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onStake();
              }}
            >
              <input
                className="h-9 w-20 rounded-ctl border border-line-control bg-inset px-3 font-mono text-sm"
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
                  <Money lamports={requirements.verificationFee} centsPerSol={centsPerSol} /> per
                  version, paid at upload
                </>
              )}
            </span>
          </Requirement>
          <li className="flex list-none gap-3 border-line-soft xl:border-l xl:pl-4">
            <span className="font-mono text-[12px] text-muted">
              {filled ? `${filled.done}/${filled.of}` : '–'}
            </span>
            <div className="min-w-0 flex-1">
              <span className="font-medium">Public profile</span>{' '}
              <span className="font-mono text-[11px] text-muted">optional</span>
              <span className="mt-1 block text-[13px] text-ink-2">
                Name, bio, avatar, banner and X.
              </span>
              <Link
                href="/studio/profile"
                className="mt-1 block text-[13px] text-accent hover:text-accent-hover"
              >
                {filled && filled.done === filled.of ? 'Edit profile →' : 'Finish your profile →'}
              </Link>
            </div>
          </li>
        </ul>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
    </section>
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

function PayoutCell({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <Label>{label}</Label>
      <div className="mt-1 text-lg font-semibold">
        {children ?? <Skeleton className="h-6 w-20" />}
      </div>
      <p className="m-0 mt-0.5 text-[12px] text-muted">{note}</p>
    </div>
  );
}

function ListingRow({
  listing: l,
  centsPerSol,
}: {
  listing: OverviewListing;
  centsPerSol: string | null;
}) {
  const action = actionFor(l);
  const meta = categoryMeta(l.category);
  const status = statusOf(l);
  return (
    <tr className="border-t border-line-soft" data-testid="studio-listing-row">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-tag border border-line-soft bg-inset font-mono text-[9px] text-muted">
            {l.coverUrl ? (
              <img
                src={l.coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              meta.tag
            )}
          </span>
          <div className="min-w-0">
            <Link
              href={`/l/${l.slug}`}
              className="block truncate font-medium hover:text-accent-hover"
            >
              {l.title}
            </Link>
            <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <span className="font-mono text-[10px] uppercase tracking-wide">{meta.tag}</span>·
              <Link href={`/studio/listings/${l.id}/content`} className="hover:text-ink">
                Edit page
              </Link>
            </span>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <StatusTag status={status} />
        <span className="mt-1 block text-[11px] text-muted">{statusNote(l)}</span>
      </td>
      <td className="px-3 py-3 font-mono text-xs text-ink-2">
        {l.latest && status !== 'live' && l.latest.semver !== l.live?.semver
          ? `v${l.latest.semver}`
          : l.live
            ? `v${l.live.semver}`
            : '–'}
      </td>
      <td className="px-3 py-3 text-right">
        <Money lamports={l.price} centsPerSol={centsPerSol} stacked />
      </td>
      <td className="tabular px-3 py-3 text-right font-mono">
        {l.sales7d}
        <span className="block text-[11px] text-muted">{l.sales} total</span>
      </td>
      <td className="tabular px-3 py-3 text-right font-mono">{l.subscribers || '–'}</td>
      <td className="tabular px-3 py-3 text-right font-mono">
        {l.rating ? `★ ${l.rating.avg.toFixed(1)}` : '–'}
      </td>
      <td className="px-5 py-3 text-right">
        {action ? (
          <ButtonLink
            href={action.href}
            data-testid={action.testid}
            size="sm"
            variant={action.tone === 'primary' ? 'primary' : 'secondary'}
            className={action.tone === 'warn' ? 'border-warn-line text-warn' : ''}
          >
            {action.label}
          </ButtonLink>
        ) : null}
      </td>
    </tr>
  );
}

function ListingCard({
  listing: l,
  centsPerSol,
}: {
  listing: OverviewListing;
  centsPerSol: string | null;
}) {
  const action = actionFor(l);
  const meta = categoryMeta(l.category);
  return (
    <li className="list-none border-t border-line-soft px-4 py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/l/${l.slug}`} className="block truncate font-medium">
            {l.title}
          </Link>
          <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-wide text-muted">
            {meta.tag}
            {l.live ? <span className="normal-case"> · v{l.live.semver}</span> : null}
          </span>
        </div>
        <Money lamports={l.price} centsPerSol={centsPerSol} className="text-sm" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusTag status={statusOf(l)} />
        <span className="text-[11px] text-muted">{statusNote(l)}</span>
      </div>
      <p className="m-0 mt-2 font-mono text-[12px] text-ink-2">
        {l.sales7d} sales 7d · {l.sales} total
        {l.subscribers ? ` · ${l.subscribers} subs` : ''}
        {l.rating ? ` · ★ ${l.rating.avg.toFixed(1)}` : ''}
      </p>
      <div className="mt-3 flex gap-2">
        {action ? (
          <ButtonLink
            href={action.href}
            data-testid={`${action.testid}-mobile`}
            size="sm"
            variant={action.tone === 'primary' ? 'primary' : 'secondary'}
          >
            {action.label}
          </ButtonLink>
        ) : null}
        <ButtonLink href={`/studio/listings/${l.id}/content`} size="sm" variant="ghost">
          Edit page
        </ButtonLink>
      </div>
    </li>
  );
}
