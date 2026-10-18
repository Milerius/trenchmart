'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  ButtonLink,
  DownloadButton,
  EmptyState,
  ErrorState,
  Label,
  Money,
  Panel,
  Skeleton,
  StatusTag,
  remaining,
  utc,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { TIER_LABEL } from '@/lib/config';
import { solText } from '@/lib/money';
import { explorerAddress, explorerTx, shortKey } from '@/lib/protocol-facts';
import { submitPayment } from '@/lib/studio';
import { updateBanner, updatesStatus, type OrderUpdates } from '@/lib/updates';
import { useWallet } from '@/lib/wallet';
import { ReviewDialog, Stars } from '@/components/reviews';

type Order = {
  id: string;
  title: string;
  slug: string;
  status: string;
  escrow_until: string | null;
  expires_at?: string | null;
  paid_at?: string | null;
  released_at?: string | null;
  created_at?: string;
  tier_at_purchase?: string;
  tx_sig?: string | null;
  escrow_address?: string | null;
  release_sig?: string | null;
  refund_sig?: string | null;
  cover?: { url: string; alt: string } | null;
  amount: { lamports: string; usdCents: string | null };
  updates?: OrderUpdates | null;
};

type TabKey = 'active' | 'completed' | 'closed';
const TABS: { key: TabKey; label: string; statuses: string[]; empty: string }[] = [
  {
    key: 'active',
    label: 'Active',
    statuses: ['pending', 'paid', 'disputed'],
    empty: 'Nothing in escrow right now.',
  },
  {
    key: 'completed',
    label: 'Completed',
    statuses: ['released'],
    empty: 'Released orders show here once the escrow window ends.',
  },
  {
    key: 'closed',
    label: 'Expired & refunded',
    statuses: ['expired', 'refunded'],
    empty: 'No expired or refunded orders.',
  },
];
const ATTENTION: Record<string, number> = { disputed: 0, paid: 1, pending: 2 };

type MyReview = {
  id: string;
  orderId: string;
  rating: number;
  hidden: boolean;
  editableUntil: string;
};

export default function PurchasesPage() {
  const wallet = useWallet();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<TabKey>('active');
  const [reviews, setReviews] = useState<Record<string, MyReview>>({});
  const [reviewing, setReviewing] = useState('');

  function load() {
    setLoadError('');
    void api<{ orders: Order[] }>('/me/orders')
      .then((body) => setOrders(body.orders))
      .catch((err: Error) => setLoadError(err.message));
    void api<MyReview[]>('/me/reviews')
      .then((rows) => setReviews(Object.fromEntries(rows.map((r) => [r.orderId, r]))))
      .catch(() => setReviews({}));
  }

  // "Write a review" on a listing links here with ?review=<orderId>.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('review');
    if (wanted && wallet.session) {
      setTab('completed');
      setReviewing(wanted);
    }
  }, [wallet.session]);

  useEffect(() => {
    if (wallet.session) load();
  }, [wallet.session]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function download(id: string, versionId?: string) {
    setMessage('');
    setBusyId(id);
    try {
      const result = await api<{ url: string }>(`/orders/${id}/download`, {
        method: 'POST',
        ...(versionId ? { body: JSON.stringify({ versionId }) } : {}),
      });
      window.location.href = result.url;
    } catch (err) {
      setMessage(
        err instanceof ApiError && err.code === 'ESCROW_LOCKED'
          ? 'Downloads open once payment is confirmed in escrow, and pause during a dispute.'
          : err instanceof Error
            ? err.message
            : 'Download failed',
      );
    } finally {
      setBusyId('');
    }
  }

  /** Renew updates: quote, then a vault transfer the wallet signs, verified by the API. */
  async function renew(id: string) {
    setMessage('');
    setBusyId(`renew:${id}`);
    try {
      const created = await api<{ renewalId: string; txBase64: string }>(
        `/orders/${id}/updates/renew`,
        { method: 'POST' },
      );
      const signature = await wallet.signAndSend(created.txBase64);
      await submitPayment(api, `/orders/${id}/updates/${created.renewalId}/submitted`, signature);
      setMessage('Updates renewed. The latest version is ready to download.');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Renewal failed');
    } finally {
      setBusyId('');
    }
  }

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Purchases</h1>
        <p className="mt-3 text-ink-2">Connect a wallet to see purchases.</p>
        <p className="mt-1 text-sm text-muted">
          Every order shows its escrow timer here, and its download once payment is confirmed.
        </p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }

  const all = orders ?? [];
  const inEscrow = all.filter((o) => o.status === 'paid' || o.status === 'disputed');
  const ready = all.filter((o) => o.status === 'released' || o.status === 'paid');
  const escrowTotal = inEscrow.reduce((sum, o) => sum + BigInt(o.amount.lamports), 0n);
  const centsPerSol = escrowCents(inEscrow);
  const byTab = Object.fromEntries(
    TABS.map((item) => [item.key, all.filter((o) => item.statuses.includes(o.status))]),
  ) as Record<TabKey, Order[]>;
  const current = TABS.find((item) => item.key === tab)!;
  const shown =
    tab === 'active'
      ? [...byTab.active].sort((a, b) => (ATTENTION[a.status] ?? 3) - (ATTENTION[b.status] ?? 3))
      : byTab[tab];

  return (
    <section data-testid="dashboard" className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[32px] font-semibold tracking-[-0.03em]">Purchases</h1>
          <p className="mt-2 max-w-2xl text-ink-2">
            Download as soon as payment is confirmed in escrow. The creator is paid only when the
            escrow window ends with no dispute.
          </p>
        </div>
        <ButtonLink href="/search" variant="secondary">
          Browse the market
        </ButtonLink>
      </div>

      {orders && orders.length ? (
        <div className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3">
          <Tile label="In escrow">
            <Money lamports={escrowTotal} usdCents={centsPerSol(escrowTotal)} stacked />
            <span className="text-xs text-muted">
              {inEscrow.length} order{inEscrow.length === 1 ? '' : 's'}
            </span>
          </Tile>
          <Tile label="Ready to download">
            <span className="text-2xl font-semibold">{ready.length}</span>
          </Tile>
          <Tile label="All orders">
            <span className="text-2xl font-semibold">{orders.length}</span>
          </Tile>
        </div>
      ) : null}

      {message ? (
        <Panel tone="info" role="status" data-testid="toast" className="toast p-3 text-sm">
          {message}
        </Panel>
      ) : null}

      {loadError ? (
        <ErrorState title="Couldn't load your purchases" body={loadError} onRetry={load} />
      ) : orders === null ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-28 w-full" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No purchases yet"
          body="Everything you buy shows up here with its escrow timer."
          action={<ButtonLink href="/search">Browse the market</ButtonLink>}
        />
      ) : (
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label="Orders"
            data-testid="purchase-tabs"
            className="flex gap-1 overflow-x-auto border-b border-line-soft"
          >
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`tab-${item.key}`}
                aria-selected={tab === item.key}
                aria-controls="purchase-panel"
                onClick={() => setTab(item.key)}
                className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  tab === item.key
                    ? 'border-accent text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {item.label}
                <span
                  className={`rounded-tag border px-1.5 font-mono text-[11px] ${
                    tab === item.key ? 'border-accent-line text-accent' : 'border-line text-muted'
                  }`}
                >
                  {byTab[item.key].length}
                </span>
              </button>
            ))}
          </div>
          <div id="purchase-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {shown.length === 0 ? (
              <p className="m-0 rounded-card border border-line bg-surface p-5 text-sm text-muted">
                {current.empty}
              </p>
            ) : tab === 'closed' ? (
              <ul
                data-testid="closed-orders"
                className="m-0 overflow-hidden rounded-card border border-line bg-surface p-0"
              >
                {shown.map((order) => (
                  <ClosedRow key={order.id} order={order} />
                ))}
              </ul>
            ) : (
              <ul className="m-0 space-y-3 p-0">
                {shown.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    now={now}
                    busy={busyId === order.id}
                    renewing={busyId === `renew:${order.id}`}
                    onDownload={(versionId) => void download(order.id, versionId)}
                    onRenew={() => void renew(order.id)}
                    review={reviews[order.id] ?? null}
                    onReview={() => setReviewing(order.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {reviewing ? (
        <ReviewDialog
          orderId={reviewing}
          onClose={() => {
            setReviewing('');
            if (window.location.search.includes('review='))
              window.history.replaceState(null, '', '/me/purchases');
          }}
          onPosted={(text) => {
            setMessage(text);
            load();
          }}
        />
      ) : null}
    </section>
  );
}

function escrowCents(orders: Order[]) {
  const sample = orders.find((o) => o.amount.usdCents && BigInt(o.amount.lamports) > 0n);
  return (lamports: bigint): string | null => {
    if (!sample) return null;
    return (
      (lamports * BigInt(sample.amount.usdCents!)) /
      BigInt(sample.amount.lamports)
    ).toString();
  };
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-5">
      <Label>{label}</Label>
      <div className="tabular mt-1 flex flex-col font-mono">{children}</div>
    </div>
  );
}

function Thumb({ order, size }: { order: Order; size: 'md' | 'sm' }) {
  const box = size === 'md' ? 'h-[68px] w-[108px]' : 'h-9 w-14';
  return (
    <span
      className={`${box} block shrink-0 overflow-hidden rounded-ctl border border-line bg-inset`}
      aria-hidden="true"
    >
      {order.cover ? (
        <img src={order.cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center font-mono text-xs text-faint">
          {order.title.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function OrderCard({
  order,
  now,
  busy,
  renewing,
  onDownload,
  onRenew,
  review,
  onReview,
}: {
  order: Order;
  now: number;
  busy: boolean;
  renewing: boolean;
  onDownload: (versionId?: string) => void;
  onRenew: () => void;
  review: MyReview | null;
  onReview: () => void;
}) {
  const canEdit = review ? new Date(review.editableUntil).getTime() > now : false;
  return (
    <li
      data-testid="order-card"
      className="list-none rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex gap-4">
        <span className="hidden sm:block">
          <Thumb order={order} size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <Link
                href={`/l/${order.slug}`}
                className="block text-[17px] font-semibold hover:text-accent-hover"
              >
                {order.title}
              </Link>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusTag status={order.status} />
                {order.tier_at_purchase && order.tier_at_purchase !== 'none' ? (
                  <span className="text-xs text-muted">
                    bought as {TIER_LABEL[order.tier_at_purchase] ?? order.tier_at_purchase}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <Money
                lamports={order.amount.lamports}
                usdCents={order.amount.usdCents}
                strong
                stacked
              />
            </div>
          </div>
        </div>
      </div>
      <EscrowTimeline order={order} now={now} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <DownloadButton
          status={order.status}
          escrowUntil={order.escrow_until}
          busy={busy}
          onDownload={() => onDownload()}
        />
        {order.status === 'paid' ? (
          <ButtonLink href={`/me/purchases/${order.id}/dispute`} variant="secondary">
            Open a dispute
          </ButtonLink>
        ) : null}
        {order.status === 'released' && !review ? (
          <Button data-testid="write-review" variant="secondary" onClick={onReview}>
            ★ Write a review
          </Button>
        ) : null}
        {review ? (
          <span
            data-testid="my-review"
            className="inline-flex items-center gap-2 text-sm text-ink-2"
          >
            <Stars value={review.rating} className="text-xs" />
            {review.hidden ? 'Hidden pending moderation' : 'Your review'}
            {canEdit ? (
              <button type="button" className="text-accent hover:underline" onClick={onReview}>
                Edit
              </button>
            ) : null}
          </span>
        ) : null}
        {order.status === 'paid' ? (
          <span className="text-[13px] text-muted">Reviews open when escrow releases.</span>
        ) : null}
        {order.status === 'disputed' ? (
          <span className="text-sm text-ink-2">
            Release is paused. If upheld you are refunded; if rejected the creator is paid.
          </span>
        ) : null}
        <span className="ml-auto text-[13px] text-muted">
          Order {order.id.slice(0, 8)}
          {order.tx_sig ? (
            <>
              {' · '}
              <a
                href={explorerTx(order.tx_sig)}
                target="_blank"
                rel="noreferrer"
                className="text-ink-2 underline-offset-4 hover:underline"
              >
                Payment tx ↗
              </a>
            </>
          ) : null}
        </span>
      </div>
      {order.updates && (order.status === 'paid' || order.status === 'released') ? (
        <UpdatesBlock
          updates={order.updates}
          now={now}
          busy={busy}
          renewing={renewing}
          onDownload={onDownload}
          onRenew={onRenew}
        />
      ) : null}
      {order.escrow_address ? <OnChainReceipt order={order} /> : null}
    </li>
  );
}

/** "Update available vX → vY" with its changelog, the renewal offer, and older downloads. */
function UpdatesBlock({
  updates,
  now,
  busy,
  renewing,
  onDownload,
  onRenew,
}: {
  updates: OrderUpdates;
  now: number;
  busy: boolean;
  renewing: boolean;
  onDownload: (versionId?: string) => void;
  onRenew: () => void;
}) {
  const banner = updateBanner(updates);
  const latestEntitled = updates.latestEntitled;
  const purchased = updates.purchased;
  return (
    <div data-testid="order-updates" className="mt-4 space-y-3">
      {banner.kind !== 'none' ? (
        <Panel
          tone={banner.kind === 'included' ? 'info' : 'warn'}
          data-testid="update-available"
          data-state={banner.kind}
          className="p-3 text-sm sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 font-semibold">
              Update available{' '}
              <span className="font-mono">
                v{banner.from} → v{banner.to}
              </span>
            </p>
            {banner.kind === 'included' ? (
              <Button
                size="sm"
                data-testid="download-latest"
                disabled={busy}
                onClick={() => onDownload(updates.latest?.id)}
              >
                Download v{banner.to}
              </Button>
            ) : (
              <Button
                size="sm"
                data-testid="renew-updates"
                disabled={renewing}
                aria-busy={renewing || undefined}
                onClick={onRenew}
              >
                {renewing
                  ? 'Check your wallet…'
                  : `Renew updates for ${solText(banner.price)}/month`}
              </Button>
            )}
          </div>
          {updates.changes.length ? (
            <ul
              data-testid="update-changelog"
              className="m-0 mt-2 space-y-1 p-0 text-[13px] text-ink-2"
            >
              {updates.changes.map((change) => (
                <li key={change.semver} className="list-none">
                  <span className="font-mono text-ink">v{change.semver}</span>{' '}
                  <span className="whitespace-pre-line">{change.changelog}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {banner.kind === 'renew' ? (
            <p className="m-0 mt-2 text-[13px] text-ink-2">
              Your free updates ended. Renewing adds {updates.periodDays} days of updates; the
              platform fee is included and your $TRENCH tier discount applies.
            </p>
          ) : null}
        </Panel>
      ) : null}
      <p
        data-testid="updates-status"
        className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2"
      >
        <span>
          <span className="text-muted">Updates:</span> {updatesStatus(updates, now)}
          {latestEntitled ? (
            <span className="font-mono text-muted"> · yours up to v{latestEntitled.semver}</span>
          ) : null}
        </span>
        {purchased && latestEntitled && purchased.id !== latestEntitled.id ? (
          <button
            type="button"
            data-testid="download-purchased"
            disabled={busy}
            onClick={() => onDownload(purchased.id)}
            className="text-ink-2 underline underline-offset-4 hover:text-ink"
          >
            Download purchased v{purchased.semver}
          </button>
        ) : null}
      </p>
    </div>
  );
}

function ClosedRow({ order }: { order: Order }) {
  const when =
    order.status === 'refunded'
      ? order.released_at
      : (order.expires_at ?? order.created_at ?? null);
  return (
    <li
      data-testid="closed-order"
      className="flex list-none flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft px-4 py-3 first:border-t-0"
    >
      <Thumb order={order} size="sm" />
      <Link
        href={`/l/${order.slug}`}
        className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent-hover"
      >
        {order.title}
      </Link>
      <span className="w-28">
        <StatusTag status={order.status} />
      </span>
      <span className="tabular w-28 text-right font-mono text-[13px] text-ink-2">
        {solText(order.amount.lamports)}
      </span>
      <span className="w-36 text-right font-mono text-xs text-muted">{when ? utc(when) : '—'}</span>
      <span className="w-20 text-right">
        {order.refund_sig ? (
          <a
            href={explorerTx(order.refund_sig)}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-ink-2 underline-offset-4 hover:underline"
          >
            Refund tx ↗
          </a>
        ) : null}
      </span>
    </li>
  );
}

/** Paid → In escrow → Released, with a progress bar for the escrow window. */
function EscrowTimeline({ order, now }: { order: Order; now: number }) {
  if (!['pending', 'paid', 'disputed', 'released'].includes(order.status)) return null;
  const start = order.paid_at ? new Date(order.paid_at).getTime() : null;
  const end = order.escrow_until ? new Date(order.escrow_until).getTime() : null;
  const released = order.status === 'released';
  const progress =
    order.status === 'pending'
      ? 0
      : released || !start || !end
        ? 1
        : Math.min(1, Math.max(0, (now - start) / (end - start)));
  const download =
    order.status === 'paid' || released
      ? 'Available'
      : order.status === 'disputed'
        ? 'Paused during the dispute'
        : 'Once payment is confirmed';
  const steps: { label: string; detail: string; state: 'done' | 'now' | 'next' }[] = [
    {
      label: 'Paid',
      detail: order.paid_at ? utc(order.paid_at) : 'Awaiting payment',
      state: order.paid_at ? 'done' : 'now',
    },
    {
      label: order.status === 'disputed' ? 'Disputed · release paused' : 'In escrow',
      detail:
        order.status === 'paid' && order.escrow_until
          ? `${remaining(order.escrow_until, now)} left · dispute any time`
          : order.escrow_until
            ? `until ${utc(order.escrow_until)}`
            : '—',
      state: released ? 'done' : order.paid_at ? 'now' : 'next',
    },
    {
      label: 'Released',
      detail: order.released_at
        ? utc(order.released_at)
        : order.status === 'disputed'
          ? 'After the dispute is settled'
          : order.escrow_until
            ? `Scheduled ${utc(order.escrow_until)}`
            : '—',
      state: released ? 'done' : 'next',
    },
  ];
  return (
    <div data-testid="escrow-timeline" className="mt-5">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Escrow progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className={`h-full rounded-full ${order.status === 'disputed' ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <ol className="m-0 mt-3 grid gap-3 p-0 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.label} className="flex list-none gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[10px] ${
                step.state === 'done'
                  ? 'border-accent bg-accent text-onaccent'
                  : step.state === 'now'
                    ? order.status === 'disputed'
                      ? 'border-danger text-danger'
                      : 'border-accent text-accent'
                    : 'border-line-strong text-muted'
              }`}
            >
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            <span>
              <span
                className={`block text-[13px] font-medium ${step.state === 'next' ? 'text-muted' : 'text-ink'}`}
              >
                {step.label}
              </span>
              <span className="block font-mono text-xs text-muted">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p data-testid="download-state" className="m-0 mt-3 text-[13px] text-ink-2">
        <span className="text-muted">Download:</span> {download}
      </p>
    </div>
  );
}

type EscrowProof = {
  programId: string | null;
  address: string | null;
  txSig: string | null;
  releaseSig: string | null;
  refundSig: string | null;
  onChain:
    | { exists: false }
    | {
        exists: true;
        status: string;
        price: string;
        deposit: string;
        escrowUntil: string;
        seller: string;
      }
    | null;
};

/** Reads the order's escrow account from devnet so the buyer can check the server's claims. */
function OnChainReceipt({ order }: { order: Order }) {
  const [proof, setProof] = useState<EscrowProof | null>(null);
  const [error, setError] = useState('');
  function load() {
    if (proof || error) return;
    void api<EscrowProof>(`/orders/${order.id}/escrow`)
      .then(setProof)
      .catch((err: Error) => setError(err.message));
  }
  const chain = proof?.onChain;
  const link = (href: string, text: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-ink-2 underline-offset-4 hover:underline"
    >
      {text} ↗
    </a>
  );
  return (
    <details
      data-testid="onchain-receipt"
      className="mt-4 rounded-card border border-line-soft bg-inset p-3 text-[13px]"
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) load();
      }}
    >
      <summary className="cursor-pointer font-medium text-ink">On-chain proof</summary>
      {error ? <p className="m-0 mt-2 text-danger">{error}</p> : null}
      {!proof && !error ? <p className="m-0 mt-2 text-muted">Reading devnet…</p> : null}
      {proof ? (
        <dl className="m-0 mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Escrow account</dt>
          <dd className="m-0">
            {proof.address
              ? link(explorerAddress(proof.address), shortKey(proof.address, 8, 6))
              : '—'}
          </dd>
          <dt className="text-muted">Program</dt>
          <dd className="m-0">
            {proof.programId
              ? link(explorerAddress(proof.programId), shortKey(proof.programId, 8, 6))
              : '—'}
          </dd>
          {chain && chain.exists ? (
            <>
              <dt className="text-muted">On-chain status</dt>
              <dd className="m-0 font-mono text-ink-2">{chain.status}</dd>
              <dt className="text-muted">Locked</dt>
              <dd className="m-0 font-mono text-ink-2">
                {solText(chain.deposit)} (price {solText(chain.price)})
              </dd>
              <dt className="text-muted">Releasable after</dt>
              <dd className="m-0 font-mono text-ink-2">
                {utc(chain.escrowUntil)} · read from the account
              </dd>
            </>
          ) : (
            <>
              <dt className="text-muted">On-chain status</dt>
              <dd className="m-0 text-ink-2">
                {chain === null
                  ? 'Not readable right now'
                  : 'Account closed (settled) or not created'}
              </dd>
            </>
          )}
          {proof.txSig ? (
            <>
              <dt className="text-muted">Payment</dt>
              <dd className="m-0">{link(explorerTx(proof.txSig), shortKey(proof.txSig, 8, 6))}</dd>
            </>
          ) : null}
          {proof.releaseSig ? (
            <>
              <dt className="text-muted">Release</dt>
              <dd className="m-0">
                {link(explorerTx(proof.releaseSig), shortKey(proof.releaseSig, 8, 6))}
              </dd>
            </>
          ) : null}
          {proof.refundSig ? (
            <>
              <dt className="text-muted">Refund</dt>
              <dd className="m-0">
                {link(explorerTx(proof.refundSig), shortKey(proof.refundSig, 8, 6))}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </details>
  );
}
