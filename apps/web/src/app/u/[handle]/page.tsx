'use client';

import { CATEGORIES, type ContactChannel, type Socials } from '@trenchmart/shared';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ListingGrid, type Listing } from '@/components/listings';
import {
  ago,
  Avatar,
  Banner,
  ContactList,
  monthYear,
  shortWallet,
  SocialChips,
  VerifiedBadge,
  type ProfileImage,
} from '@/components/profile';
import { Button, ButtonLink, EmptyState, Label, Skeleton, Square, Tag } from '@/components/ui';
import { api } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { solText } from '@/lib/money';
import { useWallet } from '@/lib/wallet';

type Stats = {
  sales: number;
  sales30d: number;
  ratingCount: number;
  ratingAvg: number | null;
  liveListings: number;
  versionsShipped: number;
  disputesUpheld: number;
  disputesResolved: number;
};

type Review = {
  rating: number;
  body: string;
  createdAt: string;
  listing: { title: string; slug: string };
  buyer: string;
};

export type PublicProfile = {
  handle: string | null;
  wallet: string;
  displayName?: string | null;
  bio?: string | null;
  avatar?: ProfileImage;
  banner?: ProfileImage;
  xHandle: string | null;
  xVerified?: boolean;
  socials?: Socials;
  contact?: ContactChannel[];
  contactHiddenForBuyers?: boolean;
  memberSince?: string;
  bond: string;
  escrowHours?: number;
  stats?: Stats;
  reviews?: Review[];
  isOwner?: boolean;
  listings: Listing[];
};

const n = (value: number) => value.toLocaleString('en-US');

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <Label>{label}</Label>
      <div className="tabular mt-1 font-mono text-[22px] font-semibold tracking-[-0.02em]">
        {value}
      </div>
      {sub ? <div className="text-[12px] text-muted">{sub}</div> : null}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-accent" aria-label={`${rating} of 5`}>
      {'★'.repeat(rating)}
      <span className="text-decor">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

export default function CreatorPage() {
  const params = useParams<{ handle: string }>();
  const wallet = useWallet();
  const config = usePublicConfig();
  const cents = useSolUsd();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api<PublicProfile>(`/creators/${params.handle}`)
      .then(setProfile)
      .catch(() => setMissing(true));
  }, [params.handle, wallet.session?.id]);

  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const listing of profile?.listings ?? [])
      counts.set(listing.category, (counts.get(listing.category) ?? 0) + 1);
    return CATEGORIES.filter((c) => counts.has(c.code)).map((c) => ({
      code: c.code,
      label: c.label,
      count: counts.get(c.code)!,
    }));
  }, [profile]);

  if (missing) {
    return (
      <EmptyState
        title="Creator not found."
        body="The handle may have changed."
        action={<ButtonLink href="/creators">All creators</ButtonLink>}
      />
    );
  }
  if (!profile) {
    return (
      <div className="space-y-4" aria-busy="true">
        <p className="sr-only">Loading creator…</p>
        <Skeleton className="h-60 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const stats = profile.stats;
  const reviews = profile.reviews ?? [];
  const contact = profile.contact ?? [];
  const handleText = profile.handle ? `@${profile.handle}` : `@${profile.wallet.slice(0, 4)}`;
  const title = profile.displayName || handleText;
  const bond = BigInt(profile.bond || '0');
  const since = monthYear(profile.memberSince);
  const shown =
    category === 'all' ? profile.listings : profile.listings.filter((l) => l.category === category);
  const escrow = profile.escrowHours ?? config?.escrowHours;

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const trust: [string, string][] = [];
  if (profile.xVerified && profile.xHandle)
    trust.push(['X account verified', `Signed in with X as @${profile.xHandle}`]);
  if (bond > 0n) trust.push(['Bond on-chain', `${solText(bond)} locked, slashed on proven fraud`]);
  if (stats && stats.versionsShipped > 0)
    trust.push([
      'Every version reviewed',
      `${n(stats.versionsShipped)} version${stats.versionsShipped === 1 ? '' : 's'} passed static, sandbox and AI checks`,
    ]);
  if (escrow)
    trust.push([
      'Escrow on every order',
      `${escrow} h window before the seller is paid${
        stats && stats.disputesResolved > 0 ? ` · ${n(stats.disputesUpheld)} disputes upheld` : ''
      }`,
    ]);

  // Tiles without backing data are left out, so the grid fits the ones that remain.
  const tileCount = stats
    ? 3 + (stats.ratingCount > 0 && stats.ratingAvg != null ? 1 : 0) + (since ? 1 : 0)
    : 0;
  return (
    <section className="space-y-6" data-testid="creator-profile">
      <div className="relative overflow-hidden rounded-panel border border-line bg-surface">
        <Banner image={profile.banner ?? null} className="h-[120px] sm:h-[168px]" />
        <div className="relative px-5 pb-6 sm:px-6">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-4 sm:-mt-14">
            <Avatar
              image={profile.avatar}
              name={profile.displayName}
              fallback={profile.handle ?? profile.wallet}
              className="h-[96px] w-[96px] text-3xl sm:h-[112px] sm:w-[112px]"
              ring="ring-[6px] ring-bg"
            />
            <div className="flex items-center gap-2 pb-1">
              <Button variant="secondary" onClick={() => void share()}>
                {copied ? 'Link copied' : 'Share'}
              </Button>
              {profile.isOwner ? (
                <ButtonLink href="/studio/profile" variant="secondary">
                  Edit profile
                </ButtonLink>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[34px]">
              {title}
            </h1>
            {profile.xVerified ? <VerifiedBadge className="h-6 w-6" /> : null}
            <Tag tone="ok">CREATOR</Tag>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[13px] text-muted">
            {profile.displayName ? <span className="text-ink-2">{handleText}</span> : null}
            {profile.displayName ? <span className="text-decor">·</span> : null}
            <span title={profile.wallet}>{shortWallet(profile.wallet)}</span>
          </div>
          {profile.bio ? (
            <p className="m-0 mt-3 max-w-[760px] whitespace-pre-line text-[15px] leading-relaxed text-ink-2">
              {profile.bio}
            </p>
          ) : null}
          <div className="mt-4">
            <SocialChips
              xHandle={profile.xHandle}
              xVerified={Boolean(profile.xVerified)}
              socials={profile.socials ?? {}}
            />
          </div>
        </div>
      </div>

      {stats ? (
        <div
          data-testid="creator-stats"
          data-tiles={tileCount}
          className={`grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line ${STAT_COLS[tileCount] ?? 'md:grid-cols-5'} ${tileCount % 2 ? '[&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1' : ''}`}
        >
          <Stat
            label="Sales"
            value={n(stats.sales)}
            sub={stats.sales30d ? `${n(stats.sales30d)} in the last 30 days` : undefined}
          />
          {stats.ratingCount > 0 && stats.ratingAvg != null ? (
            <Stat
              label="Rating"
              value={`★ ${stats.ratingAvg.toFixed(1)}`}
              sub={`${n(stats.ratingCount)} review${stats.ratingCount === 1 ? '' : 's'}`}
            />
          ) : null}
          <Stat
            label="Live listings"
            value={n(stats.liveListings)}
            sub={stats.liveListings ? 'all passed automated review' : undefined}
          />
          <Stat
            label="Bond staked"
            value={bond > 0n ? solText(bond) : 'None'}
            sub={bond > 0n ? 'on-chain, slashable' : undefined}
          />
          {since ? (
            <Stat
              label="Member since"
              value={since}
              sub={
                stats.versionsShipped
                  ? `${n(stats.versionsShipped)} version${stats.versionsShipped === 1 ? '' : 's'} shipped`
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : (
        <div className="flex justify-end">
          <div className="text-right">
            <Label>Bond posted</Label>
            <div className="mt-1 font-mono">{solText(bond)}</div>
          </div>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {tabs.length > 1 ? (
            <div role="tablist" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
              {[{ code: 'all', label: 'All', count: profile.listings.length }, ...tabs].map(
                (tab) => (
                  <button
                    key={tab.code}
                    type="button"
                    role="tab"
                    aria-selected={category === tab.code}
                    onClick={() => setCategory(tab.code)}
                    className={`rounded-lg px-3 py-2 ${category === tab.code ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}
                  >
                    {tab.label}{' '}
                    <span className="font-mono text-[11px] text-muted">{tab.count}</span>
                  </button>
                ),
              )}
            </div>
          ) : null}
          <ListingGrid
            listings={shown}
            centsPerSol={cents}
            config={config}
            tier={wallet.session?.tier}
            emptyTitle="No live listings yet"
            emptyBody="This creator has nothing on sale right now."
          />
        </div>
        <aside className="space-y-4">
          {contact.length || profile.contactHiddenForBuyers ? (
            <div className="rounded-panel border border-line bg-surface p-5" data-testid="contact">
              <h2 className="m-0 text-base font-semibold">Contact</h2>
              <p className="m-0 mt-1 text-[13px] text-muted">
                Only channels {profile.displayName || handleText} opted to show.
              </p>
              {contact.length ? (
                <div className="mt-4">
                  <ContactList channels={contact} />
                </div>
              ) : null}
              {profile.contactHiddenForBuyers ? (
                <p className="m-0 mt-3 text-[12px] text-muted">
                  More contact options show after you buy from this creator.
                </p>
              ) : null}
              <div className="mt-3 rounded-ctl border border-warn-line bg-warn-bg p-3 text-[12px] text-ink-2">
                <span className="font-semibold text-warn">Stay in escrow.</span> Pay only through
                TrenchMart. No real creator will ask for your seed phrase or a side payment.
              </div>
            </div>
          ) : null}
          {trust.length ? (
            <div className="rounded-panel border border-line bg-surface p-5" data-testid="trust">
              <h2 className="m-0 text-base font-semibold">Why you can trust this seller</h2>
              <ul className="m-0 mt-4 space-y-3 p-0 text-sm">
                {trust.map(([head, body]) => (
                  <li key={head} className="flex list-none gap-3">
                    <Square tone="ok">✓</Square>
                    <span>
                      <span className="block font-medium">{head}</span>
                      <span className="block text-[13px] text-muted">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {reviews.length ? (
            <div className="rounded-panel border border-line bg-surface p-5" data-testid="reviews">
              <div className="flex items-baseline justify-between">
                <h2 className="m-0 text-base font-semibold">Latest reviews</h2>
                <span className="text-[13px] text-muted">
                  {n(stats?.ratingCount ?? reviews.length)} total
                </span>
              </div>
              <ul className="m-0 mt-3 space-y-3 p-0">
                {reviews.map((review, index) => (
                  <li
                    key={index}
                    className="list-none border-t border-line-soft pt-3 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] text-muted">
                      <Stars rating={review.rating} />
                      <span>{ago(review.createdAt)} ago</span>
                    </div>
                    {review.body ? (
                      <p className="m-0 mt-1 text-[13px] text-ink">{review.body}</p>
                    ) : null}
                    <p className="m-0 mt-0.5 text-[12px] text-muted">
                      <span className="font-mono">{review.buyer}</span> ·{' '}
                      <a href={`/l/${review.listing.slug}`} className="hover:text-ink">
                        {review.listing.title}
                      </a>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

const STAT_COLS: Record<number, string> = {
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
};
