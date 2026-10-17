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
import { useWallet } from '@/lib/wallet';

type Order = {
  id: string;
  title: string;
  slug: string;
  status: string;
  escrow_until: string | null;
  paid_at?: string | null;
  released_at?: string | null;
  created_at?: string;
  tier_at_purchase?: string;
  tx_sig?: string | null;
  amount: { lamports: string; usdCents: string | null };
};

export default function PurchasesPage() {
  const wallet = useWallet();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [now, setNow] = useState(() => Date.now());

  function load() {
    setLoadError('');
    void api<{ orders: Order[] }>('/me/orders')
      .then((body) => setOrders(body.orders))
      .catch((err: Error) => setLoadError(err.message));
  }

  useEffect(() => {
    if (wallet.session) load();
  }, [wallet.session]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function download(id: string) {
    setMessage('');
    setBusyId(id);
    try {
      const result = await api<{ url: string }>(`/orders/${id}/download`, { method: 'POST' });
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

  const inEscrow = (orders ?? []).filter((o) => o.status === 'paid' || o.status === 'disputed');
  const ready = (orders ?? []).filter((o) => o.status === 'released' || o.status === 'paid');
  const escrowTotal = inEscrow.reduce((sum, o) => sum + BigInt(o.amount.lamports), 0n);
  const centsPerSol = escrowCents(inEscrow);

  return (
    <section data-testid="dashboard" className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[32px] font-semibold tracking-[-0.03em]">Purchases</h1>
          <p className="mt-2 max-w-2xl text-ink-2">
            Real totals in SOL with USD beside them. Download as soon as payment is confirmed in
            escrow; the creator is paid only when the escrow window ends with no dispute.
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
        <ul className="m-0 space-y-3 p-0">
          {sortForAttention(orders).map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              now={now}
              busy={busyId === order.id}
              onDownload={() => void download(order.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const ATTENTION: Record<string, number> = { paid: 0, disputed: 1, released: 2 };

/** Orders with live escrow first, so countdowns and disputes are seen before history. */
function sortForAttention(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => (ATTENTION[a.status] ?? 3) - (ATTENTION[b.status] ?? 3));
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

function OrderRow({
  order,
  now,
  busy,
  onDownload,
}: {
  order: Order;
  now: number;
  busy: boolean;
  onDownload: () => void;
}) {
  return (
    <li className="list-none rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag status={order.status} />
            {order.tier_at_purchase && order.tier_at_purchase !== 'none' ? (
              <span className="text-xs text-muted">
                bought as {TIER_LABEL[order.tier_at_purchase] ?? order.tier_at_purchase}
              </span>
            ) : null}
          </div>
          <Link
            href={`/l/${order.slug}`}
            className="mt-2 block text-[17px] font-semibold hover:text-accent-hover"
          >
            {order.title}
          </Link>
          <p className="m-0 mt-1 text-[13px] text-muted">
            Order {order.id.slice(0, 8)}
            {order.paid_at ? ` · paid ${utc(order.paid_at)}` : ''}
            {order.tx_sig ? (
              <>
                {' · '}
                <a
                  href={`https://explorer.solana.com/tx/${order.tx_sig}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-2 underline-offset-4 hover:underline"
                >
                  View transaction
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="text-right">
          <Money lamports={order.amount.lamports} usdCents={order.amount.usdCents} strong stacked />
        </div>
      </div>
      <EscrowTimeline order={order} now={now} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <DownloadButton
          status={order.status}
          escrowUntil={order.escrow_until}
          busy={busy}
          onDownload={onDownload}
        />
        {order.status === 'paid' ? (
          <Link
            href={`/me/purchases/${order.id}/dispute`}
            className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            Open a dispute
          </Link>
        ) : null}
        {order.status === 'disputed' ? (
          <span className="text-sm text-ink-2">
            Release is paused. If upheld you are refunded; if rejected the creator is paid.
          </span>
        ) : null}
      </div>
    </li>
  );
}

function EscrowTimeline({ order, now }: { order: Order; now: number }) {
  if (!['paid', 'disputed', 'released', 'refunded'].includes(order.status)) return null;
  const start = order.paid_at ? new Date(order.paid_at).getTime() : null;
  const end = order.escrow_until ? new Date(order.escrow_until).getTime() : null;
  const finished = order.status === 'released' || order.status === 'refunded';
  const progress =
    finished || !start || !end ? 1 : Math.min(1, Math.max(0, (now - start) / (end - start)));
  const steps: [string, string, boolean][] = [
    ['Paid', order.paid_at ? utc(order.paid_at) : '—', true],
    [
      order.status === 'disputed' ? 'Disputed · release paused' : 'In escrow',
      order.status === 'paid' && order.escrow_until
        ? `${remaining(order.escrow_until, now)} left · dispute any time`
        : order.escrow_until
          ? `until ${utc(order.escrow_until)}`
          : '—',
      true,
    ],
    [
      order.status === 'refunded' ? 'Refunded' : 'Released',
      order.released_at
        ? utc(order.released_at)
        : order.status === 'disputed'
          ? 'After the dispute is settled'
          : order.escrow_until
            ? `Scheduled ${utc(order.escrow_until)}`
            : '—',
      finished,
    ],
    [
      'Download',
      finished && order.status === 'released' ? 'Unlocked' : 'Locked until release',
      finished,
    ],
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
      <ol className="m-0 mt-3 grid grid-cols-2 gap-3 p-0 sm:grid-cols-4">
        {steps.map(([label, detail, reached]) => (
          <li key={label} className="list-none">
            <span
              className={`block text-[13px] font-medium ${reached ? 'text-ink' : 'text-muted'}`}
            >
              {label}
            </span>
            <span className="block font-mono text-xs text-muted">{detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
