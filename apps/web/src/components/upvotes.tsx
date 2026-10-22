'use client';

import { useEffect, useState } from 'react';
import { Label, Panel, Tag, utc } from '@/components/ui';
import { api } from '@/lib/api';
import { TIER_LABEL } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

/** Weighted listing upvotes and the ranking breakdown shown on a listing page. */

export type RankParts = {
  sales: number;
  bayes: number | null;
  upvotes: number;
  salesPart: number;
  ratingPart: number;
  upvotesPart: number;
  reviews: number;
  paused: string | null;
  leader: { sales: number; bayes: number | null; upvotes: number };
};

export type UpvoteState = {
  count: number;
  counted: number;
  mix: { buyers: number; holders: number; others: number };
  weights: { buyer: string; holder: string; holderMinTier: string };
  rank: {
    category: number | null;
    overall: number | null;
    categoryLabel: string;
    score: number | null;
    parts: RankParts;
    rankedAt: string;
    weights: { sales: number; rating: number; upvotes: number };
    windowDays: number;
  } | null;
  viewer: {
    upvoted: boolean;
    isCreator: boolean;
    weight: { bps: number; label: string; reason: string } | null;
    usedToday: number;
    perDay: number;
  } | null;
};

export function useUpvotes(slug: string) {
  const wallet = useWallet();
  const [state, setState] = useState<UpvoteState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<UpvoteState>(`/listings/${slug}/upvotes`)
      .then((next) => setState(typeof next?.count === 'number' && next.mix ? next : null))
      .catch(() => setState(null));
  }, [slug, wallet.session?.id]);

  async function toggle() {
    if (!wallet.session) return void wallet.connect();
    setBusy(true);
    setError('');
    try {
      setState(
        await api<UpvoteState>(`/listings/${slug}/upvote`, {
          method: 'POST',
          body: JSON.stringify({ up: !state?.viewer?.upvoted }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upvote failed');
    } finally {
      setBusy(false);
    }
  }
  return { state, busy, error, toggle };
}

type Upvotes = ReturnType<typeof useUpvotes>;

/** Compact header chip: ▲ count, toggles the viewer's upvote. */
export function UpvoteChip({ upvotes }: { upvotes: Upvotes }) {
  const { state, busy, toggle } = upvotes;
  if (!state) return null;
  const on = state.viewer?.upvoted;
  if (state.viewer?.isCreator)
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line px-3 font-mono text-[13px] text-ink-2">
        ▲ {state.count}
      </span>
    );
  return (
    <button
      type="button"
      data-testid="upvote-chip"
      aria-pressed={Boolean(on)}
      disabled={busy}
      onClick={() => void toggle()}
      className={`inline-flex h-8 items-center gap-1.5 rounded-ctl border px-3 font-mono text-[13px] ${
        on
          ? 'border-accent bg-accent text-onaccent'
          : 'border-accent-line text-accent hover:bg-accent-bg'
      }`}
    >
      <span aria-hidden="true">▲</span> {state.count}
      <span className="sr-only">{on ? 'Remove your upvote' : 'Upvote this listing'}</span>
    </button>
  );
}

export function UpvotePanel({ upvotes }: { upvotes: Upvotes }) {
  const { state, busy, error, toggle } = upvotes;
  if (!state) return null;
  const viewer = state.viewer;
  const on = viewer?.upvoted;
  return (
    <section
      data-testid="upvote-panel"
      aria-label="Upvotes"
      className="rounded-panel border border-line bg-surface p-5"
    >
      <div className="flex items-center justify-between">
        <p className="m-0 font-semibold">Upvote</p>
        <span className="font-mono text-[11px] text-muted">1 per wallet</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {viewer?.isCreator ? (
          <p className="m-0 flex-1 text-[13px] text-muted">
            You can&apos;t upvote your own listing.
          </p>
        ) : (
          <button
            type="button"
            data-testid="upvote"
            aria-pressed={Boolean(on)}
            disabled={busy}
            onClick={() => void toggle()}
            className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-ctl border font-semibold ${
              on
                ? 'border-accent bg-accent text-onaccent'
                : 'border-accent-line bg-accent-bg text-accent hover:border-accent'
            }`}
          >
            <span aria-hidden="true">▲</span>{' '}
            {busy ? 'Saving…' : on ? 'Upvoted' : viewer ? 'Upvote' : 'Connect to upvote'}
          </button>
        )}
        <div className="text-right">
          <p data-testid="upvote-count" className="m-0 text-2xl font-semibold leading-none">
            {state.count}
          </p>
          <p className="m-0 mt-1 text-[11px] text-muted">{state.counted} counted</p>
        </div>
      </div>
      {viewer?.weight && !viewer.isCreator ? (
        <p
          data-testid="upvote-weight"
          className="m-0 mt-3 rounded-ctl bg-inset p-2.5 text-[12px] text-ink-2"
        >
          <Tag tone={viewer.weight.bps ? 'ok' : 'neutral'}>{viewer.weight.label}</Tag>{' '}
          {viewer.weight.reason}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <dl className="m-0 mt-4 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-2">Buyers</dt>
          <dd className="m-0 font-mono text-ink">
            {state.mix.buyers} wallet{state.mix.buyers === 1 ? '' : 's'} · {state.weights.buyer}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-2">
            $MART {TIER_LABEL[state.weights.holderMinTier] ?? state.weights.holderMinTier}+ holders
          </dt>
          <dd className="m-0 font-mono text-ink">
            {state.mix.holders} · {state.weights.holder}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-2">Other wallets</dt>
          <dd className="m-0 font-mono text-muted">{state.mix.others} · shown only</dd>
        </div>
      </dl>
      <p className="m-0 mt-3 text-[11px] leading-relaxed text-muted">
        Wallets under 7 days old, wallets the creator funded, and the creator never count.
        {viewer ? ` You've used ${viewer.usedToday} of ${viewer.perDay} upvotes today.` : ''}
      </p>
    </section>
  );
}

function Bar({
  label,
  value,
  part,
  weight,
}: {
  label: string;
  value: string;
  part: number;
  weight: number;
}) {
  return (
    <li className="list-none">
      <div className="flex justify-between gap-3 text-[12px]">
        <span className="text-ink-2">
          {label} · {weight}
        </span>
        <span className="font-mono text-ink">{value}</span>
      </div>
      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-inset">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${Math.round(part * 100)}%` }}
        />
      </span>
    </li>
  );
}

export function RankPanel({ upvotes }: { upvotes: Upvotes }) {
  const rank = upvotes.state?.rank;
  if (!rank) return null;
  const p = rank.parts;
  return (
    <section
      data-testid="rank-panel"
      aria-label="Rank"
      className="rounded-panel border border-line bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 font-semibold">Rank</p>
        {rank.category ? (
          <Tag tone="info">
            #{rank.category} in {rank.categoryLabel}
          </Tag>
        ) : (
          <Tag>{p.paused ? 'PAUSED' : 'UNRANKED'}</Tag>
        )}
      </div>
      {p.paused ? (
        <Panel tone="warn" className="mt-3 p-2.5 text-[12px]">
          Paused from ranking: several buyers were funded by the creator&apos;s wallet.
        </Panel>
      ) : null}
      <ul className="m-0 mt-3 space-y-2.5 p-0">
        <Bar
          label={`Counted sales · ${rank.windowDays}d`}
          weight={rank.weights.sales}
          value={String(p.sales)}
          part={p.salesPart}
        />
        <Bar
          label="Bayesian rating"
          weight={rank.weights.rating}
          value={p.bayes === null ? '–' : p.bayes.toFixed(2)}
          part={p.ratingPart}
        />
        <Bar
          label="Counted upvotes"
          weight={rank.weights.upvotes}
          value={String(p.upvotes)}
          part={p.upvotesPart}
        />
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-line-soft pt-3">
        <Label>Score</Label>
        <span className="font-mono text-sm">
          {rank.score === null ? '–' : rank.score.toFixed(3)}
          {rank.overall ? <span className="text-muted"> · #{rank.overall} overall</span> : null}
        </span>
      </div>
      <p className="m-0 mt-2 text-[11px] leading-relaxed text-muted">
        Each part is normalised against the category leader. Listings rank once they have a counted
        sale or upvote. Paid featuring never changes rank. Updated {utc(rank.rankedAt)}.
      </p>
    </section>
  );
}
