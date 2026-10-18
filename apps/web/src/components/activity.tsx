'use client';

import { categoryMeta, type PublicIdentity } from '@trenchmart/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { solText } from '@/lib/money';

/** Live marketplace events (sales, reviews, new listings, updates). Real rows only. */

export type ActivityEvent = {
  kind: 'sale' | 'review' | 'new' | 'update' | 'featured';
  at: string;
  listing: { title: string; slug: string; category: string };
  amountLamports: string | null;
  rating: number | null;
  semver: string | null;
  placement?: string | null;
  creator?: PublicIdentity | null;
};

/** Paid band slots for today; always shown first and labelled. */
export type SponsoredChip = {
  bookingId: string;
  listing: { title: string; slug: string; category: string };
};

export type Activity = { events: ActivityEvent[]; sponsored: SponsoredChip[] };

export const ACTIVITY_LABEL: Record<ActivityEvent['kind'], string> = {
  sale: 'SALE',
  review: 'REVIEW',
  new: 'NEW',
  update: 'UPDATE',
  featured: 'SPONSORED',
};

export function activityDetail(event: ActivityEvent): string {
  if (event.kind === 'sale' && event.amountLamports) return solText(event.amountLamports);
  if (event.kind === 'review' && event.rating) return `${'★'.repeat(event.rating)}`;
  if (event.kind === 'new' && event.amountLamports) return solText(event.amountLamports);
  if (event.kind === 'update' && event.semver) return `v${event.semver}`;
  if (event.kind === 'featured') return 'Featured · Sponsored';
  return '';
}

export function activityText(event: ActivityEvent): string {
  const detail = activityDetail(event);
  return `${ACTIVITY_LABEL[event.kind]} · ${event.listing.title}${detail ? ` · ${detail}` : ''}`;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export function useActivity(limit = 24) {
  const [events, setEvents] = useState<Activity | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      void api<Partial<Activity>>(`/activity?limit=${limit}`)
        .then(
          (body) =>
            !stop &&
            setEvents({
              events: Array.isArray(body?.events) ? body.events : [],
              sponsored: Array.isArray(body?.sponsored) ? body.sponsored : [],
            }),
        )
        .catch(() => !stop && setEvents((prev) => prev ?? { events: [], sponsored: [] }));
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [limit]);
  return events;
}

const TONE: Record<ActivityEvent['kind'], string> = {
  sale: 'text-accent',
  review: 'text-warn',
  new: 'text-info',
  update: 'text-ink-2',
  featured: 'text-warn',
};

/** Home "Live on TrenchMart" band. Hidden entirely when nothing has happened yet. */
export function ActivityBand({ activity }: { activity: Activity | null }) {
  if (!activity || (activity.events.length === 0 && activity.sponsored.length === 0)) return null;
  const { events, sponsored } = activity;
  const row = (copy: string) => [
    ...sponsored.map((chip) => {
      const meta = categoryMeta(chip.listing.category);
      return (
        <Link
          key={`${copy}-s-${chip.bookingId}`}
          href={`/l/${chip.listing.slug}`}
          tabIndex={copy === 'b' ? -1 : undefined}
          data-testid={copy === 'a' ? 'band-sponsored' : undefined}
          title="Paid placement. Never affects ranking."
          className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-ctl border border-warn-line bg-warn-bg px-3 py-2"
        >
          <span className="font-mono text-[11px] font-semibold text-warn">
            FEATURED · SPONSORED
          </span>
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0 rounded"
            style={{ background: meta.bg, border: `1px solid ${meta.color}` }}
          />
          <span className="text-[13px] text-ink">{chip.listing.title}</span>
        </Link>
      );
    }),
    ...events.map((event, index) => {
      const meta = categoryMeta(event.listing.category);
      return (
        <Link
          key={`${copy}-${index}`}
          href={`/l/${event.listing.slug}`}
          tabIndex={copy === 'b' ? -1 : undefined}
          className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-ctl border border-line bg-surface px-3 py-2 hover:border-line-strong"
        >
          <span className={`font-mono text-[11px] font-semibold ${TONE[event.kind]}`}>
            {ACTIVITY_LABEL[event.kind]}
          </span>
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0 rounded"
            style={{ background: meta.bg, border: `1px solid ${meta.color}` }}
          />
          <span className="text-[13px] text-ink">{event.listing.title}</span>
          {activityDetail(event) ? (
            <span className="font-mono text-[12px] text-ink-2">{activityDetail(event)}</span>
          ) : null}
          <span className="font-mono text-[11px] text-muted">{ago(event.at)}</span>
        </Link>
      );
    }),
  ];
  return (
    <section data-testid="activity-band" aria-label="Live on TrenchMart" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-accent">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          Live on TrenchMart
          <span className="hidden normal-case tracking-normal text-muted sm:inline">
            · sales, reviews, launches and updates
          </span>
        </p>
      </div>
      <div className="activity-band relative overflow-hidden">
        <div className="activity-track flex w-max gap-3">
          <div className="flex gap-3">{row('a')}</div>
          <div className="flex gap-3" aria-hidden="true">
            {row('b')}
          </div>
        </div>
      </div>
    </section>
  );
}
