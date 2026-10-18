'use client';

import { categoryMeta, rankBadge, utcDay } from '@trenchmart/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ListingCard, type Listing } from '@/components/listings';
import { Button, EmptyState, ErrorState, Money, Skeleton, Tag, type Tone } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { solText } from '@/lib/money';
import { explorerTx } from '@/lib/protocol-facts';
import { submitPayment } from '@/lib/studio';
import { useWallet } from '@/lib/wallet';

type Kind = 'home' | 'category' | 'band';
const KINDS: Kind[] = ['home', 'category', 'band'];
const KIND_HINT: Record<Kind, string> = {
  home: 'Top of the home page, under live stats',
  category: 'First row of your listing’s category',
  band: 'One chip in the home marquee',
};

type Problem = { code: string; message: string };
type Slot = { perDay: number; lamportsPerDay: string; label: string };
type FeatureConfig = {
  slots: Record<Kind, Slot>;
  discountBps: Record<string, number>;
  rules: {
    maxConsecutiveDays: number;
    maxDaysAhead: number;
    minRatingX10: number;
    holdMinutes: number;
    cancelHours: number;
    homePerCreatorPerDay: number;
  };
};
type Booking = {
  id: string;
  listingId: string;
  title: string;
  slug: string;
  kind: Kind;
  startDay: string;
  days: number;
  subtotal: string;
  discountBps: number;
  total: string;
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'pulled' | 'completed';
  txSig: string | null;
  refundLamports: string;
  refundReason: string | null;
};
type Facts = {
  semver: string | null;
  reviewedAt: string | null;
  versionLive: boolean;
  openDisputes: number;
  disputes30d: number;
  ratingAvg: number | null;
  ratingCount: number;
  minRatingX10: number;
  bondLamports: string;
  bondRequired: string;
};
type StudioListing = {
  id: string;
  slug: string;
  title: string;
  category: string;
  price: string | null;
  problems: Problem[];
  facts?: Facts;
  card: (Listing & { rank?: Listing['rank'] }) | null;
};
type Overview = {
  tier: string;
  config: FeatureConfig;
  listings: StudioListing[];
  bookings: Booking[];
};
type Calendar = { capacity: number; days: { day: string; booked: number; free: number }[] };
type Quote = {
  quote: {
    subtotal: string;
    discountBps: number;
    discount: string;
    total: string;
    tier: string;
    days: number;
  };
  problems: Problem[];
};

const STATUS: Record<Booking['status'], [string, Tone]> = {
  pending: ['AWAITING PAYMENT', 'warn'],
  paid: ['BOOKED', 'ok'],
  completed: ['DONE', 'neutral'],
  cancelled: ['CANCELLED', 'neutral'],
  pulled: ['PULLED · REFUNDED', 'danger'],
  expired: ['EXPIRED', 'neutral'],
};

function addDays(day: string, n: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
}

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

const SIG_KEY = 'tm:featuring:pending-sigs';

function readSigs(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SIG_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function storeSigs(sigs: Record<string, string>) {
  try {
    window.localStorage.setItem(SIG_KEY, JSON.stringify(sigs));
  } catch {
    /* storage unavailable: the signature stays in memory for this visit */
  }
}

function canCancel(booking: Booking, cancelHours: number): boolean {
  if (booking.status === 'pending') return true;
  if (booking.status !== 'paid') return false;
  return Date.parse(`${booking.startDay}T00:00:00Z`) - Date.now() >= cancelHours * 3_600_000;
}

const TIERS = ['none', 'scout', 'trencher', 'og'] as const;
const TIER_LABEL: Record<string, string> = {
  none: 'None',
  scout: 'Scout',
  trencher: 'Trencher',
  og: 'OG',
};
const WINDOW_DAYS = 14;
const PREVIEW_NAME: Record<Kind, string> = {
  home: 'Home',
  category: 'Category',
  band: 'Live band',
};

function mondayOf(day: string): string {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-surface" aria-labelledby={`step-${n}`}>
      <header className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-bg font-mono text-[12px] text-accent">
          {n}
        </span>
        <div>
          <h2 id={`step-${n}`} className="m-0 text-[15px] font-semibold">
            {title}
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">{hint}</p>
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Check({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-ctl border p-3 ${ok ? 'border-line' : 'border-danger-line bg-danger-bg'}`}
      data-testid="feature-check"
      data-ok={ok}
    >
      <span
        aria-hidden="true"
        className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] font-bold ${
          ok ? 'bg-accent text-onaccent' : 'bg-danger text-onaccent'
        }`}
      >
        {ok ? '✓' : '✕'}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        <span className="block font-mono text-[11px] text-muted">{detail}</span>
      </span>
    </div>
  );
}

/** Small sketches of where each placement sits. */
function PlacementSketch({ kind }: { kind: Kind }) {
  const box = 'rounded-[3px] border border-line-strong bg-surface-2';
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-20 flex-col gap-1 rounded-ctl border border-line bg-inset p-1.5"
    >
      {kind === 'home' ? (
        <>
          <span className="h-1 w-8 rounded bg-line-strong" />
          <span className="flex flex-1 gap-1">
            <span className={`flex-1 border-accent ${box}`} />
            <span className={`flex-1 ${box}`} />
            <span className={`flex-1 ${box}`} />
          </span>
        </>
      ) : kind === 'category' ? (
        <>
          <span className="h-1 w-10 rounded bg-line-strong" />
          <span className={`h-3 w-full border-accent ${box}`} />
          <span className={`h-2 w-full ${box}`} />
        </>
      ) : (
        <span className="flex flex-1 items-center gap-1">
          <span className={`h-2.5 flex-1 rounded-full ${box}`} />
          <span className="h-2.5 flex-1 rounded-full border border-accent bg-accent-bg" />
          <span className={`h-2.5 flex-1 rounded-full ${box}`} />
        </span>
      )}
    </span>
  );
}

export default function StudioFeaturingPage() {
  const wallet = useWallet();
  const cents = useSolUsd();
  const publicConfig = usePublicConfig();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listingId, setListingId] = useState('');
  const [kind, setKind] = useState<Kind>('home');
  const [start, setStart] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [calendars, setCalendars] = useState<Partial<Record<Kind, Calendar>>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pendingSigs, setPendingSigs] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'idle' | 'booking' | 'signing' | 'confirming'>('idle');
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    void api<Overview>('/studio/featuring')
      .then((body) => {
        setOverview(body);
        setListingId(
          (current) =>
            (body.listings.some((l) => l.id === current) ? current : '') ||
            body.listings.find((l) => !l.problems.length)?.id ||
            body.listings[0]?.id ||
            '',
        );
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'failed to load'));
  }, []);

  useEffect(() => {
    if (wallet.session) load();
  }, [wallet.session, load]);

  useEffect(() => setPendingSigs(readSigs()), []);

  const listing = overview?.listings.find((l) => l.id === listingId) ?? null;
  const category = listing?.category;

  useEffect(() => {
    if (!category) return;
    let stop = false;
    setCalendars({});
    for (const value of KINDS) {
      const query = new URLSearchParams({ kind: value, category });
      void api<Calendar>(`/featuring/calendar?${query}`)
        .then((cal) => !stop && setCalendars((prev) => ({ ...prev, [value]: cal })))
        .catch(
          () => !stop && setCalendars((prev) => ({ ...prev, [value]: { capacity: 0, days: [] } })),
        );
    }
    return () => {
      stop = true;
    };
  }, [category, overview]);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!listing || !start) return;
    let stop = false;
    void api<Quote>('/studio/featuring/quote', {
      method: 'POST',
      body: JSON.stringify({ listingId: listing.id, kind, startDay: start, days }),
    })
      .then((body) => !stop && setQuote(body))
      .catch((err: unknown) => {
        if (stop) return;
        setQuote(null);
        setQuoteError(err instanceof Error ? err.message : 'Couldn’t price this run.');
      });
    return () => {
      stop = true;
    };
  }, [listing, kind, start, days]);

  const selected = useMemo(() => {
    if (!start) return new Set<string>();
    return new Set(Array.from({ length: days }, (_, i) => addDays(start, i)));
  }, [start, days]);

  async function book() {
    if (!listing || !start) return;
    setMessage(null);
    try {
      setStep('booking');
      const created = await api<{ booking: Booking; tx: { txBase64: string } }>(
        '/studio/featuring/bookings',
        {
          method: 'POST',
          body: JSON.stringify({ listingId: listing.id, kind, startDay: start, days }),
        },
      );
      setStep('signing');
      const signature = await wallet.signAndSend(created.tx.txBase64);
      // Keep the signature until the API confirms it, so a failed confirmation can be retried.
      rememberSig(created.booking.id, signature);
      setStep('confirming');
      await submitPayment(
        api,
        `/studio/featuring/bookings/${created.booking.id}/submitted`,
        signature,
      );
      forgetSig(created.booking.id);
      setMessage({
        tone: 'ok',
        text: 'Paid and booked. Your listing shows as Featured · Sponsored on those days.',
      });
      setStart(null);
      setDays(1);
      load();
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : 'booking failed' });
      load();
    } finally {
      setStep('idle');
    }
  }

  function rememberSig(bookingId: string, signature: string) {
    setPendingSigs((prev) => {
      const next = { ...prev, [bookingId]: signature };
      storeSigs(next);
      return next;
    });
  }

  function forgetSig(bookingId: string) {
    setPendingSigs((prev) => {
      const next = { ...prev };
      delete next[bookingId];
      storeSigs(next);
      return next;
    });
  }

  async function retryConfirm(booking: Booking) {
    const signature = pendingSigs[booking.id];
    if (!signature) return;
    setMessage(null);
    try {
      setStep('confirming');
      await submitPayment(api, `/studio/featuring/bookings/${booking.id}/submitted`, signature);
      forgetSig(booking.id);
      setMessage({ tone: 'ok', text: 'Payment confirmed.' });
      load();
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : 'confirmation failed',
      });
    } finally {
      setStep('idle');
    }
  }

  async function cancel(booking: Booking) {
    setMessage(null);
    try {
      const result = await api<Booking>(`/studio/featuring/bookings/${booking.id}/cancel`, {
        method: 'POST',
      });
      setMessage({
        tone: 'ok',
        text:
          BigInt(result.refundLamports) > 0n
            ? 'Cancelled. The full amount is queued for refund to your wallet.'
            : 'Cancelled.',
      });
      load();
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof ApiError || err instanceof Error ? err.message : 'cancel failed',
      });
    }
  }

  if (!wallet.session) {
    return (
      <section className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Feature a listing</h1>
        <p className="mt-3 text-ink-2">Connect a wallet to book a Featured · Sponsored slot.</p>
        <Button className="mt-6" onClick={() => void wallet.connect()} disabled={wallet.busy}>
          {wallet.busy ? 'Check your wallet…' : 'Connect wallet'}
        </Button>
      </section>
    );
  }
  if (loadError)
    return <ErrorState title="Couldn’t load featuring" body={loadError} onRetry={load} />;
  if (!overview) return <Skeleton className="h-64 w-full" />;

  const cfg = overview.config;
  const slot = cfg.slots[kind];
  const calendar = calendars[kind] ?? null;
  const problems = [...(listing?.problems ?? []), ...(quote?.problems ?? [])];
  const uniqueProblems = problems.filter(
    (p, i) => problems.findIndex((q) => q.message === p.message) === i,
  );
  const busy = step !== 'idle';
  const meta = listing ? categoryMeta(listing.category) : null;
  const card = listing?.card ?? null;
  const facts = listing?.facts;
  const free = new Map(calendar?.days.map((d) => [d.day, d.free]) ?? []);
  const today = calendar?.days[0]?.day ?? utcDay(new Date());
  const lastDay = calendar?.days.at(-1)?.day ?? addDays(today, cfg.rules.maxDaysAhead);
  const gridStart = mondayOf(today);
  const gridDays: string[] = [];
  for (let d = gridStart; d <= lastDay || gridDays.length % 7 !== 0; d = addDays(d, 1))
    gridDays.push(d);

  const pick = (day: string) => {
    if (start && day === start && days === 1) {
      setStart(null);
      return;
    }
    if (start && day > start) {
      const length = Math.round((Date.parse(day) - Date.parse(start)) / 86_400_000) + 1;
      const run = Array.from({ length }, (_, i) => addDays(start, i));
      if (length <= cfg.rules.maxConsecutiveDays && run.every((d) => (free.get(d) ?? 0) > 0)) {
        setDays(length);
        return;
      }
    }
    setStart(day);
    setDays(1);
  };

  const previewListing: Listing | null = card
    ? { ...card, sponsored: { bookingId: 'preview', placement: kind } }
    : null;

  return (
    <section className="space-y-6" data-testid="studio-featuring">
      <div>
        <Link href="/studio" className="font-mono text-[12px] text-muted hover:text-ink">
          ← Studio
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="m-0 text-[32px] font-semibold tracking-[-0.03em]">Feature a listing</h1>
            <p className="m-0 mt-1 text-ink-2">
              Rent a labeled slot for a few days. Fixed prices in SOL, limited slots, same review as
              everything else.
            </p>
          </div>
          <a href="#featuring-policy" className="text-sm text-accent hover:text-accent-hover">
            Featuring policy →
          </a>
        </div>
      </div>

      {overview.listings.length === 0 ? (
        <EmptyState
          title="No live listings yet."
          body="Featuring opens once a listing has passed review and is live."
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <Step
              n={1}
              title="Listing"
              hint="Only listings whose current version passed review can be featured."
            >
              {listing && meta ? (
                <div className="flex flex-wrap items-center gap-4 rounded-ctl border border-accent-line bg-accent-bg p-3">
                  <span
                    className="h-14 w-24 shrink-0 overflow-hidden rounded-ctl border border-line"
                    style={{ background: meta.bg }}
                  >
                    {card?.cover ? (
                      <img src={card.cover.url} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {listing.title}
                      {rankBadge(card?.rank?.category, meta.label) ? (
                        <Tag tone="ok">{rankBadge(card?.rank?.category, meta.label)}</Tag>
                      ) : null}
                    </p>
                    <p
                      className="m-0 mt-1 font-mono text-[11px] text-muted"
                      data-testid="feature-listing-line"
                    >
                      {meta.tag}
                      {facts?.semver ? ` · v${facts.semver}` : ''}
                      {listing.price ? ` · ${solText(listing.price)}` : ''}
                      {facts?.ratingAvg != null
                        ? ` · ★ ${facts.ratingAvg.toFixed(1)} (${facts.ratingCount})`
                        : ''}
                    </p>
                  </div>
                  <label className="sr-only" htmlFor="feat-listing">
                    Change listing
                  </label>
                  <select
                    id="feat-listing"
                    value={listingId}
                    onChange={(event) => {
                      setListingId(event.target.value);
                      setStart(null);
                      setDays(1);
                    }}
                    className="rounded-ctl border border-line bg-bg px-3 py-1.5 text-sm"
                  >
                    {overview.listings.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                        {l.problems.length ? ' (not eligible)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {facts ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <Check
                    ok={facts.versionLive}
                    title="Version reviewed"
                    detail={
                      facts.versionLive && facts.semver
                        ? `v${facts.semver}${facts.reviewedAt ? ` · ${shortDay(facts.reviewedAt.slice(0, 10))}` : ''}`
                        : 'no live version'
                    }
                  />
                  <Check
                    ok={facts.openDisputes === 0}
                    title="No open disputes"
                    detail={
                      facts.openDisputes
                        ? `${facts.openDisputes} open now`
                        : `${facts.disputes30d} in the last 30d`
                    }
                  />
                  <Check
                    ok={
                      facts.ratingAvg == null ||
                      Math.round(facts.ratingAvg * 10) >= facts.minRatingX10
                    }
                    title={`Rating ≥ ${(facts.minRatingX10 / 10).toFixed(1)}`}
                    detail={
                      facts.ratingAvg == null
                        ? 'no reviews yet'
                        : `${facts.ratingAvg.toFixed(1)} from ${facts.ratingCount} buyer${facts.ratingCount === 1 ? '' : 's'}`
                    }
                  />
                  <Check
                    ok={
                      BigInt(facts.bondLamports) > 0n &&
                      BigInt(facts.bondLamports) >= BigInt(facts.bondRequired)
                    }
                    title="Bond staked"
                    detail={`${solText(facts.bondLamports)} on-chain`}
                  />
                </div>
              ) : null}
              <p className="m-0 mt-3 text-[12px] text-muted">
                If the listing is pulled or paused while featured, the unserved days are refunded
                automatically.
              </p>
            </Step>

            <Step
              n={2}
              title="Placement"
              hint="Fixed daily slots. No bidding, so the price you see is the price."
            >
              <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Placement">
                {KINDS.map((value) => {
                  const cal = calendars[value];
                  const window = cal?.days.slice(0, WINDOW_DAYS) ?? [];
                  const open = window.reduce((n, d) => n + d.free, 0);
                  const soldOutDays = window.filter((d) => d.free <= 0).length;
                  const active = kind === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`placement-${value}`}
                      onClick={() => {
                        setKind(value);
                        setStart(null);
                        setDays(1);
                      }}
                      className={`relative flex flex-col gap-2 rounded-card border p-4 text-left ${
                        active
                          ? 'border-accent bg-accent-bg'
                          : 'border-line hover:border-line-strong'
                      }`}
                    >
                      <span className="flex items-start justify-between">
                        <PlacementSketch kind={value} />
                        <span
                          aria-hidden="true"
                          className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${
                            active ? 'border-accent bg-accent text-onaccent' : 'border-line-control'
                          }`}
                        >
                          {active ? '✓' : ''}
                        </span>
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-ink">
                          {cfg.slots[value].label}
                        </span>
                        <span className="block text-[12px] text-muted">{KIND_HINT[value]}</span>
                      </span>
                      <span className="font-mono text-ink">
                        <span className={`text-xl font-semibold ${active ? 'text-accent' : ''}`}>
                          {solText(cfg.slots[value].lamportsPerDay).replace(' SOL', '')}
                        </span>{' '}
                        <span className="text-[12px] text-muted">SOL / day</span>
                      </span>
                      <span className="flex justify-between border-t border-line-soft pt-2 font-mono text-[11px] text-muted">
                        <span>{cfg.slots[value].perDay} / day</span>
                        {cal ? (
                          soldOutDays ? (
                            <span className="text-warn">
                              {soldOutDays} day{soldOutDays === 1 ? '' : 's'} sold out
                            </span>
                          ) : (
                            <span>
                              {open} free · {WINDOW_DAYS} d
                            </span>
                          )
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Step>

            <Step
              n={3}
              title="Days"
              hint={`Pick up to ${cfg.rules.maxConsecutiveDays} days in a row, up to ${Math.round(cfg.rules.maxDaysAhead / 7)} weeks ahead. Each day runs 00:00–24:00 UTC.`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="m-0 font-mono text-sm text-ink">
                  {shortDay(today)} — {shortDay(lastDay)}, {lastDay.slice(0, 4)}
                </p>
                <p className="m-0 flex items-center gap-3 font-mono text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-accent" /> selected
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-warn" /> last slot
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full border border-line-control" /> sold out
                  </span>
                </p>
              </div>
              {calendar === null ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                // Seven columns fit a phone (cells ~45px wide, short labels); `relative` keeps
                // the screen-reader-only labels inside, or they widen the page sideways.
                <div className="relative overflow-x-auto">
                  <div className="relative overflow-hidden rounded-ctl border border-line">
                    <div className="grid grid-cols-7 border-b border-line bg-inset font-mono text-[11px] uppercase text-muted">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                        <span key={d} className="px-1 py-1.5 sm:px-2">
                          {d}
                        </span>
                      ))}
                    </div>
                    <ol className="m-0 grid grid-cols-7 p-0" data-testid="feature-calendar">
                      {gridDays.map((day) => {
                        const inWindow = free.has(day);
                        const left = free.get(day) ?? 0;
                        const soldOut = inWindow && left <= 0;
                        const isSelected = selected.has(day);
                        const date = new Date(`${day}T00:00:00Z`);
                        const label =
                          date.getUTCDate() === 1 ? shortDay(day) : String(date.getUTCDate());
                        return (
                          <li key={day} className="list-none border-b border-r border-line-soft">
                            <button
                              type="button"
                              disabled={!inWindow || soldOut || busy}
                              aria-pressed={isSelected}
                              onClick={() => pick(day)}
                              className={`relative flex h-14 w-full min-w-0 flex-col items-start justify-between px-1 py-1.5 text-left sm:px-2 ${
                                isSelected
                                  ? 'bg-accent text-onaccent'
                                  : !inWindow || soldOut
                                    ? 'cursor-not-allowed text-faint'
                                    : 'hover:bg-surface-2'
                              }`}
                            >
                              <span
                                className={`flex w-full justify-between font-mono text-[12px] ${!inWindow ? 'line-through' : ''} ${isSelected ? 'font-semibold' : 'text-ink'}`}
                              >
                                <span>
                                  {label}
                                  {label === String(date.getUTCDate()) ? (
                                    <span className="sr-only"> {shortDay(day).split(' ')[1]}:</span>
                                  ) : (
                                    <span className="sr-only">:</span>
                                  )}
                                </span>
                                {isSelected ? <span aria-hidden="true">✓</span> : null}
                              </span>
                              <span
                                className={`font-mono text-[10px] ${
                                  isSelected
                                    ? ''
                                    : soldOut
                                      ? 'text-faint'
                                      : left === 1
                                        ? 'text-warn'
                                        : 'text-muted'
                                }`}
                              >
                                {!inWindow ? (
                                  <span className="sr-only">not bookable</span>
                                ) : (
                                  <>
                                    {/* Phones: short visible label; the full one is still read out. */}
                                    <span aria-hidden="true" className="sm:hidden">
                                      {isSelected
                                        ? ''
                                        : soldOut
                                          ? 'full'
                                          : `${left}/${calendar.capacity}`}
                                    </span>
                                    <span className="sr-only sm:not-sr-only">
                                      {isSelected
                                        ? 'selected'
                                        : soldOut
                                          ? 'sold out'
                                          : `${left} of ${calendar.capacity} left`}
                                    </span>
                                  </>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              )}
              <p className="m-0 mt-3 flex items-start gap-2 rounded-ctl border border-info-line bg-info-bg p-3 text-[12px] text-ink-2">
                <span aria-hidden="true" className="font-mono text-info">
                  i
                </span>
                <span>
                  {kind === 'home'
                    ? `${cfg.rules.homePerCreatorPerDay === 1 ? 'One home slot' : `${cfg.rules.homePerCreatorPerDay} home slots`} per creator per day, so your listings don’t crowd the row. `
                    : ''}
                  Slots on a day rotate order every hour. Click a start day, then a later day to
                  extend the run.
                </span>
              </p>
            </Step>
          </div>

          <aside className="space-y-4">
            <div
              className="rounded-card border border-line bg-surface p-4"
              data-testid="feature-preview"
            >
              <p className="m-0 flex justify-between font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                <span>Preview · {PREVIEW_NAME[kind]}</span>
                <span className="normal-case">as buyers see it</span>
              </p>
              <div className="mt-3">
                {kind === 'band' ? (
                  <span className="inline-flex items-center gap-2.5 whitespace-nowrap rounded-ctl border border-warn-line bg-warn-bg px-3 py-2">
                    <span className="font-mono text-[11px] font-semibold text-warn">
                      FEATURED · SPONSORED
                    </span>
                    <span className="text-[13px] text-ink">{listing?.title}</span>
                  </span>
                ) : previewListing ? (
                  <div className="pointer-events-none">
                    <ListingCard
                      listing={previewListing}
                      pricing={{ centsPerSol: cents, config: publicConfig }}
                    />
                  </div>
                ) : (
                  <p className="m-0 text-sm text-muted">
                    The preview appears once the listing is live.
                  </p>
                )}
              </div>
              <p className="m-0 mt-3 text-[12px] text-muted">
                The <b className="text-warn">Featured · Sponsored</b> label is always on and can’t
                be removed or restyled.
              </p>
            </div>

            <div
              className="rounded-card border border-line bg-surface p-4"
              data-testid="feature-quote"
            >
              <p className="m-0 text-[15px] font-semibold">Summary</p>
              <dl className="m-0 mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{slot.label}</dt>
                  <dd className="m-0 font-mono">{solText(slot.lamportsPerDay)} / day</dd>
                </div>
                {start ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">
                      {shortDay(start)}
                      {days > 1 ? ` – ${shortDay(addDays(start, days - 1))}` : ''} · {days} day
                      {days === 1 ? '' : 's'}
                    </dt>
                    <dd className="m-0 font-mono">{quote ? solText(quote.quote.subtotal) : '…'}</dd>
                  </div>
                ) : (
                  <p className="m-0 text-[13px] text-muted">Pick a start day in the calendar.</p>
                )}
                {quote && quote.quote.discountBps > 0 ? (
                  <div className="flex justify-between gap-3 text-accent">
                    <dt>
                      {TIER_LABEL[quote.quote.tier] ?? quote.quote.tier} tier −
                      {quote.quote.discountBps / 100}%
                    </dt>
                    <dd className="m-0 font-mono">−{solText(quote.quote.discount)}</dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-3">
                  <dt className="font-semibold">Total</dt>
                  <dd className="m-0 text-right text-lg" data-testid="feature-total">
                    {quote ? (
                      <Money lamports={quote.quote.total} centsPerSol={cents} strong stacked />
                    ) : (
                      <span className="font-mono text-muted">—</span>
                    )}
                  </dd>
                </div>
              </dl>
              <div
                className="mt-3 grid grid-cols-4 overflow-hidden rounded-ctl border border-line"
                data-testid="tier-discounts"
              >
                {TIERS.map((tier) => (
                  <span
                    key={tier}
                    className={`px-1 py-1.5 text-center font-mono text-[11px] ${
                      overview.tier === tier ? 'bg-accent-bg text-accent' : 'text-muted'
                    }`}
                  >
                    {TIER_LABEL[tier]}
                    <span className="block">
                      {(cfg.discountBps[tier] ?? 0)
                        ? `−${(cfg.discountBps[tier] ?? 0) / 100}%`
                        : '0%'}
                    </span>
                  </span>
                ))}
              </div>
              <p className="m-0 mt-1.5 text-[11px] text-muted">
                $TRENCH discount from your holder tier.
              </p>
              {quoteError ? (
                <p
                  role="alert"
                  className="m-0 mt-3 text-sm text-danger"
                  data-testid="feature-quote-error"
                >
                  Couldn’t get a price: {quoteError}
                </p>
              ) : null}
              {uniqueProblems.length ? (
                <ul
                  className="m-0 mt-3 space-y-1 pl-4 text-sm text-danger"
                  data-testid="feature-problems"
                >
                  {uniqueProblems.map((p) => (
                    <li key={p.code + p.message}>{p.message}</li>
                  ))}
                </ul>
              ) : null}
              <Button
                className="mt-4 w-full"
                disabled={!listing || !start || !quote || uniqueProblems.length > 0 || busy}
                onClick={() => void book()}
              >
                {step === 'booking'
                  ? 'Holding your slot…'
                  : step === 'signing'
                    ? 'Approve in your wallet…'
                    : step === 'confirming'
                      ? 'Confirming on devnet…'
                      : quote
                        ? `Pay ${solText(quote.quote.total)}`
                        : 'Book and pay'}
              </Button>
              <p className="m-0 mt-2 text-[12px] text-muted">
                Paid on-chain to the TrenchMart vault. Slots are held {cfg.rules.holdMinutes}{' '}
                minutes while you pay. Cancel up to {cfg.rules.cancelHours} h before day one for a
                full refund. If the listing is pulled, unserved days come back automatically.
              </p>
            </div>
            {message ? (
              <p
                role="status"
                className={`m-0 rounded-ctl border p-3 text-sm ${
                  message.tone === 'ok'
                    ? 'border-accent-line text-accent'
                    : 'border-danger-line text-danger'
                }`}
              >
                {message.text}
              </p>
            ) : null}
            <div
              id="featuring-policy"
              className="rounded-card border border-line bg-surface p-4"
              data-testid="featuring-never"
            >
              <p className="m-0 text-[15px] font-semibold">Featuring never changes</p>
              <ul className="m-0 mt-3 space-y-2 p-0 text-[13px] text-ink-2">
                {[
                  'Leaderboard rank or “#N in category”',
                  'Ratings, reviews or upvote counts',
                  'Search order outside the slot',
                  'Security review: same checks, no fast lane',
                ].map((item) => (
                  <li key={item} className="flex list-none items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="grid h-4 w-4 place-items-center rounded border border-line font-mono text-[10px] text-muted"
                    >
                      =
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="m-0 text-lg font-semibold">Your bookings</h2>
        {overview.bookings.length === 0 ? (
          <p className="m-0 text-sm text-muted">No bookings yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table
              className="w-full min-w-[720px] border-collapse text-sm"
              data-testid="feature-bookings"
            >
              <thead>
                <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-3 py-2 font-medium">Listing</th>
                  <th className="px-3 py-2 font-medium">Placement</th>
                  <th className="px-3 py-2 font-medium">Dates (UTC)</th>
                  <th className="px-3 py-2 font-medium">Paid</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {overview.bookings.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-line-soft last:border-0"
                    data-testid="feature-booking"
                  >
                    <td className="px-3 py-2.5">
                      <Link href={`/l/${b.slug}`} className="hover:text-accent">
                        {b.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{cfg.slots[b.kind]?.label ?? b.kind}</td>
                    <td className="px-3 py-2.5 font-mono">
                      {shortDay(b.startDay)}
                      {b.days > 1 ? ` → ${shortDay(addDays(b.startDay, b.days - 1))}` : ''}
                    </td>
                    <td className="px-3 py-2.5">
                      <Money lamports={b.total} centsPerSol={null} />
                      {b.txSig ? (
                        <a
                          href={explorerTx(b.txSig)}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 font-mono text-[11px] text-muted hover:text-ink"
                        >
                          tx ↗
                        </a>
                      ) : null}
                      {BigInt(b.refundLamports) > 0n ? (
                        <span className="block text-[11px] text-accent">
                          refund <Money lamports={b.refundLamports} centsPerSol={null} />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Tag tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Tag>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {b.status === 'pending' && pendingSigs[b.id] ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void retryConfirm(b)}
                        >
                          Confirm payment
                        </Button>
                      ) : null}
                      {canCancel(b, cfg.rules.cancelHours) ? (
                        <Button size="sm" variant="ghost" onClick={() => void cancel(b)}>
                          {b.status === 'pending' ? 'Release hold' : 'Cancel · full refund'}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
