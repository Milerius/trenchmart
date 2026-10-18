'use client';

import {
  cleanReviewText,
  replyTextProblem,
  REVIEW_REPORT_REASONS,
  reviewMessage,
  reviewTextProblem,
  SOCIAL_DEFAULTS,
  type PublicIdentity,
} from '@trenchmart/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar, VerifiedBadge } from '@/components/profile';
import { Button, ButtonLink, Label, Panel, Skeleton, Tag, utc } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';

/** Verified-buyer reviews: listing section, review cards, and the sign-to-post dialog. */

type Sort = 'helpful' | 'newest' | 'lowest' | 'highest';
type Filter = 'all' | '5' | 'critical' | 'replied' | 'current';

export type ReviewItem = {
  id: string;
  rating: number;
  body: string;
  terminal: string | null;
  createdAt: string;
  editedAt: string | null;
  version: { semver: string; current: boolean } | null;
  reviewer: PublicIdentity;
  order: { ref: string; releasedAt: string | null };
  helpful: { count: number; unhelpful: number; score: number };
  reply: {
    body: string;
    createdAt: string;
    editedAt: string | null;
    creator: PublicIdentity;
  } | null;
  viewer: {
    vote: boolean | null;
    mine: boolean;
    editableUntil: string | null;
    canReply: boolean;
  } | null;
};

export type ReviewPage = {
  summary: {
    count: number;
    avg: number | null;
    histogram: Record<'1' | '2' | '3' | '4' | '5', number>;
    hidden: number;
    byVersion: { semver: string; current: boolean; count: number; avg: number | null }[];
  };
  counts: Record<Filter, number>;
  reviews: ReviewItem[];
  viewer: { eligibleOrderId: string | null; ownReviewId: string | null; isCreator: boolean } | null;
};

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['5', '5★'],
  ['critical', 'Critical (1–3★)'],
  ['replied', 'Creator replied'],
  ['current', 'Current version'],
];
const SORTS: [Sort, string][] = [
  ['helpful', 'Most helpful'],
  ['newest', 'Newest'],
  ['lowest', 'Lowest rated'],
  ['highest', 'Highest rated'],
];
const PAGE = 10;
const RATING_WORD = ['', 'Poor', 'Weak', 'OK', 'Great', 'Best in class'];
const REASON_LABEL: Record<(typeof REVIEW_REPORT_REASONS)[number], string> = {
  spam: 'Spam',
  off_topic: 'Off topic',
  abuse: 'Abuse',
  contact_info: 'Contact info or links',
  other: 'Other',
};

export function Stars({ value, className = '' }: { value: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span className={`font-mono tracking-[0.08em] ${className}`}>
      <span aria-hidden="true">
        <span className="text-accent">{'★'.repeat(full)}</span>
        <span className="text-line-strong">{'★'.repeat(Math.max(0, 5 - full))}</span>
      </span>
      <span className="sr-only">{value.toFixed(1)} out of 5</span>
    </span>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86_400 * 60) return `${Math.round(s / 86_400)}d ago`;
  return utc(iso).slice(0, 10);
}

export function IdentityName({ who, testId }: { who: PublicIdentity; testId?: string }) {
  const body = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className={`truncate font-semibold text-ink ${who.kind === 'wallet' ? 'font-mono text-[13px]' : ''}`}
      >
        {who.name}
      </span>
      {who.kind === 'x' ? <VerifiedBadge className="h-4 w-4" /> : null}
    </span>
  );
  return who.handle ? (
    <Link data-testid={testId} href={`/u/${who.handle}`} className="min-w-0 hover:underline">
      {body}
    </Link>
  ) : (
    <span data-testid={testId} className="min-w-0">
      {body}
    </span>
  );
}

/** Listing page "Reviews" tab. Real reviews only; an empty state when there are none. */
export function ReviewsPanel({
  slug,
  onCount,
}: {
  slug: string;
  onCount?: (count: number) => void;
}) {
  const wallet = useWallet();
  const [sort, setSort] = useState<Sort>('helpful');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);

  function load(offset = 0) {
    setFailed(false);
    if (offset) setMore(true);
    void api<ReviewPage>(
      `/listings/${slug}/reviews?sort=${sort}&filter=${filter}&limit=${PAGE}&offset=${offset}`,
    )
      .then((next) => {
        if (!next?.summary) throw new Error('unexpected reviews payload');
        setPage((prev) =>
          offset && prev ? { ...next, reviews: [...prev.reviews, ...next.reviews] } : next,
        );
        onCount?.(next.summary.count);
      })
      .catch(() => setFailed(true))
      .finally(() => setMore(false));
  }

  useEffect(() => load(0), [slug, sort, filter, wallet.session?.id]);

  if (failed && !page)
    return (
      <p className="m-0 text-sm text-muted">
        Reviews are not available right now.{' '}
        <button type="button" className="underline" onClick={() => load(0)}>
          Retry
        </button>
      </p>
    );
  if (!page)
    return (
      <div aria-busy="true" className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );

  const { summary, counts, viewer } = page;
  const shown = counts[filter];
  return (
    <div data-testid="listing-reviews" className="space-y-5">
      {summary.count ? <Summary summary={summary} /> : null}

      <Panel tone="info" className="flex flex-wrap items-center gap-3 p-3 text-[13px]">
        <span className="min-w-0 flex-1 text-ink-2">
          <span className="font-semibold text-ink">Only buyers can review.</span> One review per
          released order, signed by the buying wallet. Creators can reply once but can&apos;t hide
          or remove a review.
        </span>
        {viewer?.eligibleOrderId ? (
          <ButtonLink
            data-testid="write-review"
            size="sm"
            href={`/me/purchases?review=${viewer.eligibleOrderId}`}
          >
            Write a review
          </ButtonLink>
        ) : viewer?.ownReviewId ? (
          <Tag tone="ok">YOU REVIEWED THIS</Tag>
        ) : null}
      </Panel>

      {summary.count ? (
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-ctl border px-3 text-[13px] ${
                filter === key
                  ? 'border-accent-line bg-accent-bg text-accent'
                  : 'border-line text-ink-2 hover:text-ink'
              }`}
            >
              {label}
              <span className="font-mono text-[11px] text-muted">{counts[key]}</span>
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-2 text-[13px] text-muted">
            Sort
            <select
              data-testid="review-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="h-8 rounded-ctl border border-line bg-inset px-2 text-ink"
            >
              {SORTS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {page.reviews.length ? (
        <ul className="m-0 space-y-3 p-0">
          {page.reviews.map((review) => (
            <ReviewCard key={review.id} review={review} onChanged={() => load(0)} />
          ))}
        </ul>
      ) : (
        <div
          data-testid="reviews-empty"
          className="rounded-card border border-dashed border-line p-6 text-center"
        >
          <p className="m-0 font-semibold">
            {summary.count ? 'No reviews match this filter.' : 'No reviews yet'}
          </p>
          <p className="m-0 mt-1 text-sm text-muted">
            {summary.count
              ? 'Try another filter.'
              : 'The first verified buyer to review this listing shows up here.'}
          </p>
        </div>
      )}

      {page.reviews.length < shown ? (
        <div className="text-center">
          <Button variant="secondary" disabled={more} onClick={() => load(page.reviews.length)}>
            {more ? 'Loading…' : `Show ${Math.min(PAGE, shown - page.reviews.length)} more`}
          </Button>
        </div>
      ) : null}
      {summary.hidden ? (
        <p className="m-0 text-[13px] text-muted">
          {summary.hidden} review{summary.hidden === 1 ? ' is' : 's are'} hidden while moderation
          checks a report. Negative reviews are never removed for being negative.
        </p>
      ) : null}
    </div>
  );
}

function Summary({ summary }: { summary: ReviewPage['summary'] }) {
  const max = Math.max(1, ...Object.values(summary.histogram));
  return (
    <div
      data-testid="review-summary"
      className="grid gap-6 rounded-card border border-line bg-surface p-5 md:grid-cols-[150px_1fr_220px]"
    >
      <div>
        <p className="m-0 text-[44px] font-semibold leading-none tracking-[-0.03em]">
          {summary.avg?.toFixed(1) ?? '–'}
        </p>
        <Stars value={summary.avg ?? 0} className="mt-2 block text-sm" />
        <p className="m-0 mt-1 text-[13px] text-muted">
          {summary.count} review{summary.count === 1 ? '' : 's'}
        </p>
        <p className="m-0 mt-0.5 text-[13px] text-accent">100% verified buyers</p>
      </div>
      <ul className="m-0 space-y-1.5 p-0" aria-label="Rating breakdown">
        {(['5', '4', '3', '2', '1'] as const).map((star) => (
          <li key={star} className="flex list-none items-center gap-3 font-mono text-xs">
            <span className="w-6 text-muted">{star}★</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${(summary.histogram[star] / max) * 100}%` }}
              />
            </span>
            <span className="w-8 text-right text-ink-2">{summary.histogram[star]}</span>
          </li>
        ))}
      </ul>
      <div className="md:border-l md:border-line-soft md:pl-5">
        <Label>By version</Label>
        <ul className="m-0 mt-2 space-y-1 p-0 font-mono text-xs">
          {summary.byVersion.slice(0, 4).map((v) => (
            <li key={v.semver} className="flex list-none justify-between gap-2">
              <span className={v.current ? 'text-accent' : 'text-ink-2'}>
                v{v.semver}
                {v.current ? ' · current' : ''}
              </span>
              <span className="text-ink-2">
                ★ {v.avg?.toFixed(1)} <span className="text-muted">({v.count})</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 text-[11px] text-muted">
          Each review is tagged with the version the buyer had.
        </p>
      </div>
    </div>
  );
}

function ReviewCard({ review, onChanged }: { review: ReviewItem; onChanged: () => void }) {
  const wallet = useWallet();
  const [vote, setVote] = useState<boolean | null>(review.viewer?.vote ?? null);
  const [counts, setCounts] = useState(review.helpful);
  const [note, setNote] = useState('');
  const [replying, setReplying] = useState(false);
  const [reporting, setReporting] = useState(false);

  async function cast(next: boolean) {
    if (!wallet.session) return void wallet.connect();
    const value = vote === next ? null : next;
    try {
      const result = await api<{ vote: boolean | null; weight?: { reason: string } }>(
        `/reviews/${review.id}/vote`,
        { method: 'POST', body: JSON.stringify({ helpful: value }) },
      );
      setCounts((c) => ({
        ...c,
        count: c.count + (value === true ? 1 : 0) - (vote === true ? 1 : 0),
        unhelpful: c.unhelpful + (value === false ? 1 : 0) - (vote === false ? 1 : 0),
      }));
      setVote(result.vote);
      setNote(result.weight?.reason ?? '');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Vote failed');
    }
  }

  const who = review.reviewer;
  const viewer = review.viewer;
  return (
    <li
      data-testid="review"
      className="list-none rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Avatar
          image={who.avatarUrl}
          name={who.kind === 'wallet' ? null : who.name}
          fallback={who.wallet.slice(0, 2)}
          className="h-9 w-9 text-xs"
          ring=""
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <IdentityName who={who} />
            <Tag tone="ok">✓ VERIFIED BUYER</Tag>
          </div>
          <p className="m-0 mt-0.5 font-mono text-[11px] text-muted">
            order {review.order.ref}
            {review.order.releasedAt
              ? ` · released ${utc(review.order.releasedAt).slice(0, 10)}`
              : ''}
            {' · '}
            {who.kind === 'x' ? 'X verified' : who.kind === 'pseudonym' ? 'pseudonym' : 'wallet'}
          </p>
        </div>
        <div className="text-right">
          <Stars value={review.rating} className="text-sm" />
          <p className="m-0 mt-0.5 flex items-center justify-end gap-2 font-mono text-[11px] text-muted">
            {review.version ? (
              <Tag tone={review.version.current ? 'info' : 'neutral'}>
                v{review.version.semver}
                {review.version.current ? '' : ' · older'}
              </Tag>
            ) : null}
            <span title={utc(review.createdAt)}>{ago(review.createdAt)}</span>
          </p>
        </div>
      </div>
      <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
        {review.body}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        {review.terminal ? <Tag>used on {review.terminal}</Tag> : null}
        {review.editedAt ? <span className="text-muted">edited {ago(review.editedAt)}</span> : null}
        {viewer?.mine ? (
          <>
            <Tag tone="ok">YOUR REVIEW</Tag>
            {viewer.editableUntil && new Date(viewer.editableUntil).getTime() > Date.now() ? (
              <Link href="/me/purchases" className="text-ink-2 underline-offset-4 hover:underline">
                Edit · until {utc(viewer.editableUntil).slice(0, 10)}
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              data-testid="helpful"
              aria-pressed={vote === true}
              onClick={() => void cast(true)}
              className={`inline-flex h-7 items-center gap-1 rounded-ctl border px-2.5 ${
                vote === true
                  ? 'border-accent-line bg-accent-bg text-accent'
                  : 'border-line text-ink-2'
              }`}
            >
              + Helpful {counts.count ? counts.count : ''}
            </button>
            <button
              type="button"
              aria-pressed={vote === false}
              onClick={() => void cast(false)}
              className={`inline-flex h-7 items-center rounded-ctl border px-2.5 ${
                vote === false ? 'border-line-strong bg-inset text-ink' : 'border-line text-muted'
              }`}
            >
              Not helpful
            </button>
          </>
        )}
        <span className="ml-auto text-muted">
          {counts.count + counts.unhelpful
            ? `${counts.count} of ${counts.count + counts.unhelpful} found this helpful`
            : ''}
        </span>
        {!viewer?.mine ? (
          <button
            type="button"
            data-testid="report-review"
            className="text-muted hover:text-ink"
            onClick={() => (wallet.session ? setReporting((v) => !v) : void wallet.connect())}
          >
            Report
          </button>
        ) : null}
      </div>
      {note ? (
        <p role="status" data-testid="vote-note" className="m-0 mt-2 text-[12px] text-accent-label">
          {note}
        </p>
      ) : null}
      {reporting ? <ReportForm reviewId={review.id} onDone={() => setReporting(false)} /> : null}
      {review.reply ? (
        <div
          data-testid="creator-reply"
          className="mt-4 rounded-ctl border-l-2 border-accent-line bg-inset p-3 sm:ml-6"
        >
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <IdentityName who={review.reply.creator} />
            <Tag tone="info">CREATOR</Tag>
            <span className="text-[11px] text-muted">
              replied {ago(review.reply.createdAt)}
              {review.reply.editedAt ? ' · edited' : ''}
            </span>
          </div>
          <p className="m-0 mt-1.5 whitespace-pre-wrap text-sm text-ink-2">{review.reply.body}</p>
        </div>
      ) : null}
      {viewer?.canReply ? (
        replying ? (
          <ReplyForm
            reviewId={review.id}
            initial={review.reply?.body ?? ''}
            onDone={(changed) => {
              setReplying(false);
              if (changed) onChanged();
            }}
          />
        ) : (
          <Button
            data-testid="reply"
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => setReplying(true)}
          >
            {review.reply ? 'Edit your reply' : 'Reply as creator'}
          </Button>
        )
      ) : null}
    </li>
  );
}

function ReplyForm({
  reviewId,
  initial,
  onDone,
}: {
  reviewId: string;
  initial: string;
  onDone: (changed: boolean) => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const problem = replyTextProblem(text);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await api(`/reviews/${reviewId}/reply`, {
        method: 'PUT',
        body: JSON.stringify({ body: text }),
      });
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-2 sm:ml-6">
      <textarea
        data-testid="reply-text"
        aria-label="Your reply"
        value={text}
        maxLength={1000}
        onChange={(event) => setText(event.target.value)}
        className="min-h-20 w-full rounded-ctl border border-line bg-inset p-3 text-sm"
      />
      <p className="m-0 text-[12px] text-muted">
        One public reply per review, editable. No links or contact details.
      </p>
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" data-testid="reply-save" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Post reply'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ReportForm({ reviewId, onDone }: { reviewId: string; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');
  async function report(reason: string) {
    setState('busy');
    try {
      await api(`/reviews/${reviewId}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setState('done');
      setTimeout(onDone, 1500);
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : 'Report failed');
    }
  }
  return (
    <div className="mt-3 rounded-ctl border border-line bg-inset p-3 text-[13px]">
      {state === 'done' ? (
        <p role="status" className="m-0 text-ink-2">
          Thanks. A moderator will look at it.
        </p>
      ) : (
        <>
          <p className="m-0 text-ink-2">Why should a moderator look at this review?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {REVIEW_REPORT_REASONS.map((reason) => (
              <Button
                key={reason}
                size="sm"
                variant="secondary"
                disabled={state === 'busy'}
                onClick={() => void report(reason)}
              >
                {REASON_LABEL[reason]}
              </Button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="m-0 mt-2 text-danger">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

type ReviewForm = {
  order: { id: string; ref: string; status: string; releasedAt: string | null };
  listing: { title: string; slug: string; terminals: string[] };
  creator: PublicIdentity | null;
  poster: PublicIdentity;
  versions: { id: string; semver: string; downloadedAt: string | null }[];
  rules: { minChars: number; maxChars: number; editDays: number };
  canReview: boolean;
  review: {
    id: string;
    rating: number;
    body: string;
    versionId: string | null;
    terminal: string | null;
    editableUntil: string;
  } | null;
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function Check({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 rounded-ctl border border-line bg-inset p-2.5">
      <span
        aria-hidden="true"
        className="grid h-5 w-5 shrink-0 place-items-center rounded bg-accent text-[11px] font-bold text-onaccent"
      >
        ✓
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{title}</span>
        <span className="block truncate font-mono text-[11px] text-muted">{detail}</span>
      </span>
    </div>
  );
}

/** Write or edit the review of a released order. The wallet signs; nothing is sent on chain. */
export function ReviewDialog({
  orderId,
  onClose,
  onPosted,
}: {
  orderId: string;
  onClose: () => void;
  onPosted: (message: string) => void;
}) {
  const wallet = useWallet();
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [versionId, setVersionId] = useState('');
  const [terminal, setTerminal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    void api<ReviewForm>(`/orders/${orderId}/review-form`)
      .then((loaded) => {
        setForm(loaded);
        setRating(loaded.review?.rating ?? 0);
        setText(loaded.review?.body ?? '');
        setVersionId(loaded.review?.versionId ?? loaded.versions[0]?.id ?? '');
        setTerminal(loaded.review?.terminal ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, [orderId]);

  const rules = form?.rules ?? { minChars: 40, maxChars: 1000, editDays: 30 };
  const clean = cleanReviewText(text);
  const problem = reviewTextProblem(text, {
    ...SOCIAL_DEFAULTS,
    reviewMinChars: rules.minChars,
    reviewMaxChars: rules.maxChars,
  });

  async function submit() {
    if (!form) return;
    setError('');
    if (!rating) return setError('Pick a rating.');
    if (problem) return setError(problem);
    const version = form.versions.find((v) => v.id === versionId);
    if (!version) return setError('Pick the version you used.');
    setBusy(true);
    try {
      const message = reviewMessage({
        orderId: form.order.id,
        rating,
        semver: version.semver,
        bodySha256: await sha256Hex(clean),
      });
      const signature = await wallet.signMessage(message);
      await api(`/orders/${form.order.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ rating, body: clean, versionId, terminal, signature }),
      });
      onPosted(form.review ? 'Review updated.' : 'Review posted. Thanks for helping other buyers.');
      dialog.current?.close();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Posting failed');
    } finally {
      setBusy(false);
    }
  }

  let body: ReactNode;
  if (!form) {
    body = error ? (
      <p role="alert" className="m-0 p-6 text-danger">
        {error}
      </p>
    ) : (
      <div className="space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else if (!form.canReview) {
    body = (
      <p className="m-0 p-6 text-ink-2">
        Reviews open once escrow releases this order. Only the buying wallet can review.
      </p>
    );
  } else {
    body = (
      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-2 sm:grid-cols-3">
          <Check
            title="Order released"
            detail={
              form.order.releasedAt
                ? `escrow closed ${utc(form.order.releasedAt).slice(0, 10)}`
                : 'escrow closed'
            }
          />
          <Check
            title="1 review per order"
            detail={form.review ? 'editing yours' : 'none posted yet'}
          />
          <Check title="Signed by buyer" detail={form.poster.name} />
        </div>
        <fieldset className="m-0 border-0 p-0">
          <legend className="text-sm font-medium">Your rating</legend>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                data-testid={`star-${n}`}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                aria-pressed={rating === n}
                onClick={() => setRating(n)}
                className={`grid h-11 w-11 place-items-center rounded-ctl border text-lg ${
                  n <= rating
                    ? 'border-accent-line bg-accent-bg text-accent'
                    : 'border-line text-line-strong'
                }`}
              >
                ★
              </button>
            ))}
            {rating ? (
              <span className="ml-2 text-sm font-semibold">
                {rating} · {RATING_WORD[rating]}
              </span>
            ) : null}
          </div>
        </fieldset>
        <fieldset className="m-0 border-0 p-0">
          <legend className="flex w-full justify-between text-sm font-medium">
            Version you used
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {form.versions.map((v) => (
              <label
                key={v.id}
                className={`flex cursor-pointer items-center gap-2 rounded-ctl border p-2.5 text-[13px] ${
                  versionId === v.id ? 'border-accent-line bg-accent-bg' : 'border-line'
                }`}
              >
                <input
                  type="radio"
                  name="version"
                  checked={versionId === v.id}
                  onChange={() => setVersionId(v.id)}
                />
                <span className="font-mono text-ink">v{v.semver}</span>
                <span className="text-muted">
                  {v.downloadedAt ? `downloaded ${utc(v.downloadedAt).slice(0, 10)}` : 'purchased'}
                </span>
              </label>
            ))}
          </div>
          <p className="m-0 mt-1.5 text-[12px] text-muted">
            Only versions this wallet downloaded are offered. Shown on your review as a tag.
          </p>
        </fieldset>
        <div>
          <label htmlFor="review-text" className="flex justify-between text-sm font-medium">
            Your review
            <span className="font-mono text-[11px] text-muted">
              {clean.length} / {rules.maxChars} · min {rules.minChars}
            </span>
          </label>
          <textarea
            id="review-text"
            data-testid="review-text"
            value={text}
            maxLength={rules.maxChars + 200}
            onChange={(event) => setText(event.target.value)}
            className="mt-2 min-h-28 w-full rounded-ctl border border-line bg-inset p-3 text-sm leading-relaxed"
          />
          {form.listing.terminals.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-muted">Used on</span>
              {form.listing.terminals.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={terminal === t}
                  onClick={() => setTerminal(terminal === t ? null : t)}
                  className={`h-7 rounded-full border px-3 ${
                    terminal === t ? 'border-accent-line text-accent' : 'border-line text-ink-2'
                  }`}
                >
                  {terminal === t ? '✓ ' : '+ '}
                  {t}
                </button>
              ))}
              <span className="ml-auto text-muted">optional</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 rounded-ctl border border-line p-3 text-[13px]">
          <Avatar
            image={form.poster.avatarUrl}
            name={form.poster.kind === 'wallet' ? null : form.poster.name}
            fallback={form.poster.wallet.slice(0, 2)}
            className="h-8 w-8 text-xs"
            ring=""
          />
          <span className="min-w-0 flex-1">
            Posting as <span className="font-mono text-ink">{form.poster.name}</span>
            {form.poster.kind === 'wallet' ? (
              <span className="block text-[12px] text-muted">
                No profile name yet. Add a pseudonym or link X to show a name.
              </span>
            ) : null}
          </span>
          {form.poster.kind === 'wallet' ? (
            <Link href="/studio/profile" className="text-accent">
              Set name →
            </Link>
          ) : null}
        </div>
        <Panel tone="warn" className="p-3 text-[12px] text-ink-2">
          <span className="font-semibold text-warn">Public and permanent.</span> You can edit for{' '}
          {rules.editDays} days; edits are marked. No links, wallet addresses or contact details.
          The creator can reply once. Reviews can&apos;t be bought, and creators can&apos;t hide
          them.
        </Panel>
        {error ? (
          <p role="alert" data-testid="review-error" className="m-0 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <dialog
      ref={dialog}
      data-testid="review-dialog"
      aria-labelledby="review-title"
      onClose={onClose}
      className="m-auto w-[min(720px,calc(100vw-24px))] rounded-panel border border-line bg-surface p-0 text-ink backdrop:bg-black/70"
    >
      <div className="flex items-start gap-4 border-b border-line-soft p-5">
        <div className="min-w-0 flex-1">
          <h2 id="review-title" className="m-0 text-lg font-semibold">
            {form
              ? `${form.review ? 'Edit your review of' : 'Review'} ${form.listing.title}`
              : 'Review'}
          </h2>
          {form ? (
            <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              {form.creator ? <IdentityName who={form.creator} /> : null}
              <span className="font-mono">· order {form.order.ref}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => dialog.current?.close()}
          className="grid h-8 w-8 place-items-center rounded-ctl border border-line text-muted hover:text-ink"
        >
          ×
        </button>
      </div>
      {body}
      {form?.canReview ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft p-5">
          <p className="m-0 min-w-0 flex-1 text-[12px] text-muted">
            Your wallet signs a message with the order ID and review hash. Free, no transaction.
          </p>
          <Button variant="ghost" onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button data-testid="post-review" disabled={busy} onClick={() => void submit()}>
            {busy
              ? 'Check your wallet…'
              : form.review
                ? 'Sign & update review'
                : 'Sign & post review'}
          </Button>
        </div>
      ) : null}
    </dialog>
  );
}
