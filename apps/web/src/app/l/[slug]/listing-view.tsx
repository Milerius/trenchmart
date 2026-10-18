'use client';

import { DEFAULT_ESCROW_HOURS } from '@trenchmart/shared/config';
import { escrowWindowLabel } from '@trenchmart/shared/escrow';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { categoryMeta } from '@trenchmart/shared/categories';
import { quote as quoteFor } from '@trenchmart/shared/fee';
import { specRows, walletCountLabel, type WalletCount } from '@trenchmart/shared/listing-kinds';
import { DEFAULT_FEES, FeeBreakdown } from '@/components/fees';
import { Gallery, type GalleryImage } from '@/components/gallery';
import { Markdown } from '@/components/markdown';
import { VerifiedBadge } from '@/components/profile';
import { ReviewsPanel } from '@/components/reviews';
import { CheckoutElectric, DecryptHash } from '@/components/listing-fx';
import type { Listing as CardListing } from '@/components/listings';
import { TerminalNames } from '@/components/terminal-logo';
import { RankPanel, UpvoteChip, UpvotePanel, useUpvotes } from '@/components/upvotes';
import {
  Button,
  ButtonLink,
  buttonClass,
  EmptyState,
  ErrorState,
  Label,
  Money,
  Panel,
  PreviewNotice,
  Skeleton,
  Square,
  StatusTag,
  Tag,
  utc,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { TIER_LABEL, usePublicConfig, useSolUsd } from '@/lib/config';
import { solText, usdFor, usdText } from '@/lib/money';
import { updatePolicyText } from '@/lib/updates';
import { useWallet } from '@/lib/wallet';
import { ESCROW_PROGRAM_ID, explorerAddress, shortKey } from '@/lib/protocol-facts';
import {
  Check,
  Clock,
  Download,
  Link2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Star,
  Wallet as WalletIcon,
} from 'lucide-react';

// Loaded on demand: keeps the shared home card module out of the listing page's
// first-load graph, so the home bundle is not split into extra chunks.
const ListingCard = dynamic(() => import('@/components/listings').then((m) => m.ListingCard));

export type Listing = {
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
  /** Wizard kind and its structured specs (null for listings made before the wizard). */
  kind?: string | null;
  specs?: Record<string, unknown> | null;
  /** Monthly update price in lamports after the free period; 0 = free updates forever. */
  updatePrice?: string | null;
  sales7d?: number;
  ratingAvg?: string | null;
  ratingCount?: number;
  security: {
    semver: string;
    sha256: string;
    summary: string;
    passed?: number;
    total?: number;
    checks: { ruleId: string; result: string; title: string; detail: string }[];
    declared?: Record<string, string[]>;
    review: { agentId: string; decision: string; signedAt?: string } | null;
  } | null;
  /** Wallet lists: the live version's wallet count, counted from its file by the scan. */
  walletCount?: WalletCount | null;
  creator: {
    handle: string | null;
    wallet: string;
    bondLamports: string;
    xHandle?: string | null;
    xVerified?: boolean;
  };
  preview: string | null;
  /** Approved rich content. Drafts never reach the public listing. */
  content?: {
    readme: string;
    howto: string;
    requirements: string;
    gallery: GalleryImage[];
  } | null;
};

type VersionNote = {
  semver: string;
  changelog: string;
  created_at: string;
  status: string;
  /** Wallet lists: unique Solana addresses the scan counted in this version's file. */
  walletCount?: number | null;
};

type Quote = {
  price: string;
  fee: string;
  rebate: string;
  total: string;
  tier: string;
  totalUsd: { usdCents: string | null };
};

type Step = 'idle' | 'quoting' | 'signing' | 'confirming' | 'done' | 'failed';
type Tab = 'overview' | 'howto' | 'changelog' | 'security' | 'reviews';
const TABS: Tab[] = ['overview', 'howto', 'changelog', 'security', 'reviews'];
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  howto: 'How to use',
  changelog: 'Changelog',
  security: 'Security',
  reviews: 'Reviews',
};

export function ListingView({ initial }: { initial: Listing | null }) {
  const params = useParams<{ slug: string }>();
  const wallet = useWallet();
  const config = usePublicConfig();
  const centsPerSol = useSolUsd();
  // Server-rendered first paint: crawlers and no-JS clients get the listing in the HTML.
  const [listing, setListing] = useState<Listing | null>(initial);
  const [loadError, setLoadError] = useState<'missing' | 'failed' | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [versions, setVersions] = useState<VersionNote[]>([]);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const upvotes = useUpvotes(params.slug);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState('');
  const [related, setRelated] = useState<CardListing[]>([]);

  function load() {
    setLoadError(null);
    void api<Listing>(`/listings/${params.slug}`)
      .then(setListing)
      .catch((err) => {
        setListing(null);
        setLoadError(err instanceof ApiError && err.status === 404 ? 'missing' : 'failed');
      });
    void api<VersionNote[]>(`/listings/${params.slug}/versions`)
      .then(setVersions)
      .catch(() => setVersions([]));
  }

  useEffect(load, [params.slug]);

  // "More from <category>": other live listings in the same category (real data only).
  const relatedCategory = listing?.category;
  useEffect(() => {
    if (!relatedCategory) return;
    let stop = false;
    void api<CardListing[]>(`/listings?category=${encodeURIComponent(relatedCategory)}`)
      .then((rows) => {
        if (!stop && Array.isArray(rows))
          setRelated(rows.filter((row) => row.slug !== params.slug).slice(0, 4));
      })
      .catch(() => !stop && setRelated([]));
    return () => {
      stop = true;
    };
  }, [relatedCategory, params.slug]);

  const [checkoutVisible, setCheckoutVisible] = useState(false);
  useEffect(() => {
    const aside = document.getElementById('checkout');
    if (!aside) return;
    const observer = new IntersectionObserver(([entry]) =>
      setCheckoutVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(aside);
    return () => observer.disconnect();
  }, [listing]);

  async function buy() {
    if (!listing) return;
    setMessage('');
    try {
      if (!wallet.session) {
        await wallet.connect();
        return;
      }
      setStep('quoting');
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
      setStep('signing');
      const signature = await wallet.signAndSend(created.txBase64);
      setStep('confirming');
      await api(`/orders/${created.orderId}/submitted`, {
        method: 'POST',
        body: JSON.stringify({ txSig: signature }),
      });
      setStep('done');
      setMessage('Payment confirmed in escrow. Your download is ready in Purchases.');
    } catch (err) {
      setStep('failed');
      setMessage(err instanceof Error ? err.message : 'checkout failed');
    }
  }

  if (loadError === 'missing') {
    return (
      <EmptyState
        title="Listing not found"
        body="It may have been delisted, or the link is wrong."
        action={<ButtonLink href="/search">Browse the market</ButtonLink>}
      />
    );
  }
  if (loadError === 'failed') {
    return (
      <ErrorState
        title="Couldn't load this listing"
        body="The marketplace API didn't respond. Your wallet and funds are not affected."
        onRetry={load}
      />
    );
  }
  if (!listing) {
    return (
      <div aria-busy="true" className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <p className="sr-only">Loading listing…</p>
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const meta = categoryMeta(listing.category);
  const security = listing.security;
  const verified = security?.review?.decision === 'approve';
  const tier = wallet.session?.tier;
  const busy = step === 'quoting' || step === 'signing' || step === 'confirming';
  const escrowHours = config?.escrowHours ?? DEFAULT_ESCROW_HOURS;
  const rating = listing.ratingAvg ? Number(listing.ratingAvg) : null;
  const fees = config ?? DEFAULT_FEES;
  const youPay = quote
    ? BigInt(quote.total)
    : quoteFor(BigInt(listing.price), fees.feeBps, tier ? (fees.tierRebateBps[tier] ?? 0) : 0)
        .total;

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index + TABS.length - 1) % TABS.length
          : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next]!);
    document.getElementById(`tab-${TABS[next]}`)?.focus();
  }

  return (
    <>
      <article className="relative grid items-start gap-10 pb-24 lg:grid-cols-[minmax(0,1fr)_400px] lg:pb-0">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-2rem] left-1/2 -z-10 h-[520px] w-screen -translate-x-1/2"
          style={{
            background: `radial-gradient(60% 100% at 30% 0%, ${meta.color}1f, transparent 70%)`,
          }}
        />
        <div className="flex min-w-0 flex-col gap-7">
          <nav aria-label="Breadcrumb" className="flex gap-2 text-sm text-muted">
            <Link href="/" className="hover:text-ink">
              Explore
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={`/c/${listing.category}`} className="hover:text-ink">
              {meta.label}
            </Link>
          </nav>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded-md px-2 py-1 font-mono text-[11px] font-semibold tracking-wider"
                style={{
                  color: meta.color,
                  background: meta.bg,
                  boxShadow: `inset 0 0 0 1px ${meta.color}33`,
                }}
              >
                {meta.tag}
              </span>
              {verified ? <StatusTag status="live" /> : <Tag tone="warn">NOT VERIFIED</Tag>}
              {listing.holderOnly ? <Tag tone="info">HOLDER-ONLY</Tag> : null}
              {upvotes.state?.rank?.category && upvotes.state.rank.category <= 10 ? (
                <Tag tone="info">
                  #{upvotes.state.rank.category} in {meta.label}
                </Tag>
              ) : null}
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h1 className="m-0 text-[clamp(34px,4.5vw,56px)] font-semibold leading-[1.02] tracking-[-0.045em]">
                {listing.title}
              </h1>
              <span className="mt-1.5 shrink-0">
                <UpvoteChip upvotes={upvotes} />
              </span>
            </div>
            <p className="m-0 max-w-2xl text-lg text-ink-2">{listing.summary}</p>
            <p className="m-0 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
              <CreatorLink creator={listing.creator} />
              {listing.walletCount ? (
                <span
                  data-testid="wallet-count"
                  title={`Counted by the security scan from the v${listing.walletCount.semver} file`}
                >
                  {walletCountLabel(listing.walletCount.count)}
                </span>
              ) : null}
              {listing.sales7d ? <span>{listing.sales7d} sold this week</span> : null}
              {rating ? (
                <span className="inline-flex items-center gap-1">
                  <Star size={14} className="fill-accent text-accent" aria-hidden="true" />{' '}
                  {rating.toFixed(1)}
                  <span className="sr-only"> out of 5</span>
                  {listing.ratingCount ? (
                    <button
                      type="button"
                      className="hover:text-ink hover:underline"
                      onClick={() => {
                        setTab('reviews');
                        document.getElementById('tab-reviews')?.scrollIntoView({ block: 'center' });
                      }}
                    >
                      {` · ${listing.ratingCount} review${listing.ratingCount === 1 ? '' : 's'}`}
                    </button>
                  ) : (
                    ''
                  )}
                </span>
              ) : null}
              {listing.terminals.length ? (
                <span data-testid="listing-terminals">
                  <TerminalNames names={listing.terminals} logoClassName="h-5 w-5 rounded" />
                </span>
              ) : null}
            </p>
          </div>

          {listing.content?.gallery.length ? (
            <Gallery images={listing.content.gallery} title={listing.title} />
          ) : null}

          {security ? (
            <div
              data-testid="security-summary"
              className={`flex flex-wrap items-center gap-4 rounded-[22px] border px-5 py-4 ${verified ? 'border-accent-line bg-accent-bg' : 'border-warn-line bg-warn-bg'}`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-onaccent ${verified ? 'bg-accent' : 'bg-warn'}`}
              >
                <ShieldCheck size={22} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 font-semibold">
                  {verified ? 'Passed automated review' : 'Review pending'} · v{security.semver}
                </p>
                <p className="m-0 font-mono text-xs text-muted">
                  {security.passed ?? security.checks.filter((c) => c.result === 'pass').length} of{' '}
                  {security.total ?? security.checks.length} checks passed
                  {security.review?.signedAt ? ` · signed ${utc(security.review.signedAt)}` : ''}
                  {security.review ? ` · ${security.review.agentId}` : ''}
                </p>
              </div>
              <span
                className="w-full font-mono text-xs text-ink-2 sm:w-auto"
                title={security.sha256}
              >
                SHA-256{' '}
                <DecryptHash text={`${security.sha256.slice(0, 8)}…${security.sha256.slice(-6)}`} />
              </span>
            </div>
          ) : null}

          <div>
            <div
              role="tablist"
              aria-label="Listing details"
              className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]"
            >
              {TABS.map((name) => (
                <button
                  key={name}
                  id={`tab-${name}`}
                  role="tab"
                  type="button"
                  aria-selected={tab === name}
                  aria-controls={`panel-${name}`}
                  tabIndex={tab === name ? 0 : -1}
                  onKeyDown={onTabKey}
                  className={`relative min-h-11 shrink-0 whitespace-nowrap px-4 text-sm font-medium transition-colors ${
                    tab === name ? 'text-ink' : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setTab(name)}
                >
                  {TAB_LABEL[name]}
                  {name === 'reviews' && (reviewCount ?? listing.ratingCount) ? (
                    <span className="ml-1.5 font-mono text-xs text-faint">
                      {reviewCount ?? listing.ratingCount}
                    </span>
                  ) : null}
                  {tab === name ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent"
                    />
                  ) : null}
                </button>
              ))}
            </div>
            <div
              id={`panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              className="pt-7"
            >
              {tab === 'security' ? <SecurityPanel listing={listing} /> : null}
              {tab === 'overview' ? (
                listing.content?.readme ? (
                  <Markdown source={listing.content.readme} className="max-w-3xl" />
                ) : (
                  <p className="m-0 max-w-2xl whitespace-pre-wrap leading-relaxed text-ink-2">
                    {listing.description}
                  </p>
                )
              ) : null}
              {tab === 'howto' ? (
                <HowToPanel
                  content={listing.content}
                  specs={specRows(
                    listing.kind,
                    listing.specs,
                    listing.terminals,
                    listing.walletCount?.count ?? null,
                  )}
                />
              ) : null}
              {tab === 'changelog' ? <ChangelogPanel versions={versions} /> : null}
              {tab === 'reviews' ? (
                <ReviewsPanel slug={listing.slug} onCount={setReviewCount} />
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-24">
          <aside
            id="checkout"
            data-testid="checkout"
            aria-label="Checkout"
            className="relative rounded-[26px] border border-accent/25 bg-[#0d0f0d]/95 shadow-[0_0_40px_-12px_rgba(198,244,50,0.35)]"
          >
            <CheckoutElectric />
            <div className="flex items-end justify-between gap-3 px-6 pt-6">
              <div>
                <div className="text-sm text-muted">Price</div>
                <div className="text-4xl font-semibold tracking-[-0.04em]">
                  {solText(listing.price).replace(/ SOL$/, '')}{' '}
                  <span className="text-xl text-muted">SOL</span>
                </div>
                {usdFor(listing.price, centsPerSol) ? (
                  <div data-testid="usd-amount" className="font-mono text-xs text-faint">
                    {usdText(usdFor(listing.price, centsPerSol), listing.price)}
                  </div>
                ) : null}
              </div>
              {tier ? (
                <p className="m-0 text-right text-xs text-muted">
                  Your tier
                  <span className="block text-sm text-accent">{TIER_LABEL[tier] ?? tier}</span>
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-5 p-6">
              {!wallet.session ? <PreviewNotice compact /> : null}
              <div className="rounded-2xl border border-line bg-inset p-4 font-mono text-[13px]">
                <FeeBreakdown
                  price={listing.price}
                  config={config}
                  tier={tier}
                  centsPerSol={centsPerSol}
                  quoted={quote}
                />
              </div>
              {quote ? (
                <p data-testid="tier-pill" className="m-0 text-xs text-muted">
                  Quote locked for tier {TIER_LABEL[quote.tier] ?? quote.tier}
                </p>
              ) : null}
              <CheckoutProgress step={step} />
              {step === 'done' ? (
                <div
                  data-testid="escrow-success"
                  className="escrow-success rounded-ctl border border-accent-line bg-accent-bg p-4"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="escrow-check grid h-9 w-9 place-items-center rounded-full bg-accent font-mono text-sm font-bold text-onaccent"
                    >
                      ✓
                    </span>
                    <div>
                      <p className="m-0 font-semibold text-ink">Paid · in escrow</p>
                      <p role="status" className="m-0 mt-1 text-sm text-ink-2">
                        {message ||
                          `Your SOL is in escrow for ${escrowWindowLabel(escrowHours)}. Your download is ready in Purchases now.`}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
              {step === 'done' ? (
                <ButtonLink href="/me/purchases" variant="secondary" className="w-full">
                  View order {orderId.slice(0, 8)} in Purchases
                </ButtonLink>
              ) : (
                <Button
                  data-testid="buy"
                  size="lg"
                  className="min-h-13 w-full gap-2 !rounded-full py-4 text-[16px] shadow-[0_10px_40px_-10px_rgba(198,244,50,.7)]"
                  disabled={busy || wallet.busy}
                  aria-busy={busy || undefined}
                  onClick={() => void buy()}
                >
                  {wallet.session ? (
                    <Lock size={17} aria-hidden="true" />
                  ) : (
                    <WalletIcon size={17} aria-hidden="true" />
                  )}
                  {buyLabel(step, !!wallet.session, wallet.busy)}
                </Button>
              )}
              {message && step === 'failed' ? (
                <p role="alert" data-testid="toast" className="toast m-0 text-sm text-danger">
                  {message}
                </p>
              ) : null}
              <ul className="m-0 flex flex-col gap-2.5 p-0 text-sm text-ink-2">
                <li className="flex list-none gap-2.5">
                  <Clock size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  Held in escrow for {escrowWindowLabel(escrowHours)}. Dispute any time in that
                  window.
                </li>
                <li className="flex list-none gap-2.5">
                  <Download size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  Download once payment is confirmed in escrow. Watermarked to your wallet.
                </li>
                <li data-testid="update-policy" className="flex list-none gap-2.5">
                  <RefreshCw size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  <span>
                    {updatePolicyText(listing.updatePrice, config?.updateFreeDays ?? 30)}. Every
                    version you were entitled to stays downloadable.
                  </span>
                </li>
                <li data-testid="escrow-program" className="flex list-none gap-2.5">
                  <ShieldCheck
                    size={16}
                    className="mt-0.5 shrink-0 text-accent"
                    aria-hidden="true"
                  />
                  <span>
                    Escrow program{' '}
                    <a
                      href={explorerAddress(ESCROW_PROGRAM_ID)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-ink-2 underline decoration-line-control underline-offset-2 hover:text-ink"
                    >
                      {shortKey(ESCROW_PROGRAM_ID)} ↗
                    </a>{' '}
                    on devnet. Your receipt shows the escrow account and its on-chain release time.
                  </span>
                </li>
                <li data-testid="devnet-hint" className="flex list-none gap-2.5">
                  <Link2 size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  Devnet only. Switch your wallet to Solana Devnet before paying (Phantom: Settings
                  → Developer Settings → Testnet Mode).
                </li>
              </ul>
              <p className="m-0 border-t border-line pt-3 font-mono text-[11px] text-faint">
                License: {listing.license} · creator bond {solText(listing.creator.bondLamports)}
              </p>
            </div>
          </aside>
          <UpvotePanel upvotes={upvotes} />
          <RankPanel upvotes={upvotes} />
        </div>

        <div
          hidden={checkoutVisible}
          className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 lg:hidden"
        >
          <div className="flex min-w-0 flex-col">
            <Label>{tier ? 'You pay' : 'You pay before discount'}</Label>
            <Money lamports={youPay} centsPerSol={centsPerSol} strong className="text-sm" />
          </div>
          <a href="#checkout" className={buttonClass('primary', 'md')}>
            Review and buy
          </a>
        </div>
      </article>
      {related.length ? (
        <section aria-labelledby="related-heading" className="mt-16 flex flex-col gap-6">
          <h2 id="related-heading" className="m-0 text-2xl font-semibold tracking-tight">
            More from {meta.label.toLowerCase()}
          </h2>
          <ul className="m-0 grid gap-5 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <li key={item.slug} className="list-none">
                <ListingCard listing={item} pricing={{ centsPerSol, config, tier }} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function buyLabel(step: Step, connected: boolean, connecting: boolean): string {
  if (connecting) return 'Check your wallet…';
  if (!connected) return 'Connect wallet to buy';
  if (step === 'quoting') return 'Locking your price…';
  if (step === 'signing') return 'Approve in your wallet…';
  if (step === 'confirming') return 'Confirming on devnet…';
  if (step === 'failed') return 'Try again';
  return 'Pay into escrow';
}

const PROGRESS: [Exclude<Step, 'idle' | 'failed'>, string][] = [
  ['quoting', 'Price locked'],
  ['signing', 'Signed in wallet'],
  ['confirming', 'Confirmed on devnet'],
  ['done', 'Paid · in escrow'],
];

function CheckoutProgress({ step }: { step: Step }) {
  const current = PROGRESS.findIndex(([key]) => key === step);
  return (
    <ol aria-label="Checkout progress" className="m-0 grid grid-cols-4 gap-2 p-0">
      {PROGRESS.map(([key, label], index) => {
        const done = step === 'done' || (current >= 0 && index <= current);
        return (
          <li
            key={key}
            aria-current={index === current && step !== 'done' ? 'step' : undefined}
            className="flex list-none flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={`h-1 rounded-full transition-colors duration-500 ${done ? 'bg-accent' : 'bg-line'}`}
            />
            <span className={`text-[11px] leading-tight ${done ? 'text-ink' : 'text-faint'}`}>
              {done ? <Check size={10} className="mr-0.5 inline" aria-hidden="true" /> : null}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SecurityPanel({ listing }: { listing: Listing }) {
  const security = listing.security;
  if (!security) return <p className="text-muted">No verified version yet.</p>;
  const declared = Object.entries(security.declared ?? {}).filter(([, values]) => values.length);
  return (
    <div className="space-y-6">
      <ul className="m-0 grid gap-2 p-0 md:grid-cols-2">
        {security.checks.map((check) => (
          <li
            key={check.ruleId}
            className="flex list-none items-start gap-3 rounded-card border border-line bg-surface p-3"
          >
            <StatusTag status={check.result} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{check.title}</span>
              <span className="block text-[13px] text-muted">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {declared.length ? (
        <div>
          <Label>Declared permissions</Label>
          <dl className="m-0 mt-2 grid gap-x-6 gap-y-1 font-mono text-[13px] sm:grid-cols-[auto_1fr]">
            {declared.map(([key, values]) => (
              <div key={key} className="contents">
                <dt className="text-muted">@{key}</dt>
                <dd className="m-0 text-ink-2">{values.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <ReportBlock slug={listing.slug} />
      {listing.preview ? (
        <div>
          <Label>Preview</Label>
          <pre className="mt-2 overflow-auto rounded-card border border-line bg-inset p-4 font-mono text-xs leading-relaxed text-ink-2">
            {listing.preview}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function HowToPanel({
  content,
  specs,
}: {
  content: Listing['content'];
  specs: [string, string][];
}) {
  const specPanel = specs.length ? (
    <Panel className="p-4" data-testid="listing-specs">
      <Label>Specs</Label>
      <dl className="m-0 mt-2 space-y-1.5 text-[13px]">
        {specs.map(([a, b]) => (
          <div key={a} className="flex justify-between gap-3">
            <dt className="text-ink-2">{a}</dt>
            <dd className="m-0 text-right font-mono text-ink">{b}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  ) : null;
  if (!content?.howto && !content?.requirements) {
    return (
      <div className="space-y-4">
        {specPanel}
        <p className="m-0 text-muted">The creator hasn&apos;t added an install guide yet.</p>
      </div>
    );
  }
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_260px]">
      {content.howto ? <Markdown source={content.howto} className="max-w-3xl" /> : <span />}
      <div className="space-y-4">
        {specPanel}
        {content.requirements ? (
          <Panel tone="info" className="p-4">
            <Label>Requirements</Label>
            <Markdown source={content.requirements} className="mt-2 text-sm" />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function ChangelogPanel({ versions }: { versions: VersionNote[] }) {
  if (!versions.length) return <p className="m-0 text-muted">No released versions yet.</p>;
  return (
    <ol className="m-0 space-y-3 p-0">
      {versions.map((version, index) => (
        <li
          key={version.semver}
          className="flex list-none gap-4 rounded-card border border-line bg-surface p-4"
        >
          <Square tone={index === 0 ? 'ok' : 'neutral'}>{index === 0 ? '✓' : '·'}</Square>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">v{version.semver}</span>
              {index === 0 ? <Tag tone="ok">LATEST</Tag> : null}
              <span className="font-mono text-[11px] text-muted">{utc(version.created_at)}</span>
              {typeof version.walletCount === 'number' ? (
                <span className="font-mono text-[11px] text-muted">
                  · {walletCountLabel(version.walletCount)}
                </span>
              ) : null}
            </p>
            {version.changelog ? (
              <Markdown source={version.changelog} links={false} className="mt-2 text-sm" />
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The creator's pseudonym (or short wallet). The X badge shows only for an X account verified
 * through X sign-in; X is optional and never required to sell.
 */
function CreatorLink({ creator }: { creator: Listing['creator'] }) {
  const key = creator.handle ?? creator.wallet;
  const verified = Boolean(creator.xVerified && creator.xHandle);
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="listing-creator">
      <Link href={`/u/${key}`} className="text-ink-2 hover:text-ink">
        {creator.handle ? `@${creator.handle}` : shortKey(creator.wallet)}
      </Link>
      {verified ? (
        <span className="inline-flex items-center gap-1" data-testid="creator-x-verified">
          <VerifiedBadge className="h-4 w-4" />
          <span className="text-ink-2">X @{creator.xHandle}</span>
        </span>
      ) : null}
    </span>
  );
}

type ReportSummary = {
  report: {
    version: { sha256: string; semver: string };
    steps: { kind: string; engine: string; finishedAt: string | null; summary: string | null }[];
    reviews: { engine: string; model: string | null; decision: string; decidedAt: string }[];
  };
  signature: { publicKey: string; value: string } | null;
};

function ReportBlock({ slug }: { slug: string }) {
  const [data, setData] = useState<ReportSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api<ReportSummary>(`/listings/${slug}/report`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [slug]);
  const review = data?.report.reviews.at(-1);
  return (
    <div data-testid="scan-report">
      <Label>Signed scan report</Label>
      {failed ? (
        <p className="m-0 mt-2 text-sm text-muted">The report is not available right now.</p>
      ) : !data ? (
        <p className="m-0 mt-2 text-sm text-muted">Loading the report…</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm text-ink-2">
          <ol className="m-0 space-y-1 p-0 font-mono text-[13px]">
            {data.report.steps.map((step) => (
              <li key={step.kind} className="list-none">
                {step.kind} · {step.engine} · {step.summary ?? 'n/a'}
                {step.finishedAt ? ` · ${utc(step.finishedAt)}` : ''}
              </li>
            ))}
            {review ? (
              <li className="list-none">
                review · {review.engine}
                {review.model ? ` (${review.model})` : ''} · {review.decision} ·{' '}
                {utc(review.decidedAt)}
              </li>
            ) : null}
          </ol>
          <p className="m-0 text-[13px] text-muted">
            {data.signature ? (
              <>
                Ed25519-signed by{' '}
                <span className="font-mono text-ink-2" title={data.signature.publicKey}>
                  {shortKey(data.signature.publicKey)}
                </span>
                . Check it on{' '}
                <Link href="/verify#report" className="underline">
                  /verify
                </Link>{' '}
                or with any Ed25519 library.
              </>
            ) : (
              'This report is not signed yet (no report signing key is configured).'
            )}
          </p>
          <a
            href={`/api/v1/listings/${slug}/report?download=1`}
            download
            className="inline-block rounded-ctl border border-line-control px-3 py-1.5 text-[13px] font-medium text-ink hover:border-accent-line"
          >
            Download full report (JSON)
          </a>
        </div>
      )}
    </div>
  );
}
