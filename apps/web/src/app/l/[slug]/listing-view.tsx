'use client';

import { DEFAULT_ESCROW_HOURS, escrowWindowLabel } from '@trenchmart/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { categoryMeta, quote as quoteFor, specRows } from '@trenchmart/shared';
import { DEFAULT_FEES, FeeBreakdown } from '@/components/fees';
import { Gallery, type GalleryImage } from '@/components/gallery';
import { Markdown } from '@/components/markdown';
import { ReviewsPanel } from '@/components/reviews';
import {
  Button,
  ButtonLink,
  buttonClass,
  EmptyState,
  ErrorState,
  Label,
  LockIcon,
  Money,
  Panel,
  PreviewNotice,
  ShieldIcon,
  Skeleton,
  Square,
  StatusTag,
  Tag,
  utc,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { TIER_LABEL, usePublicConfig, useSolUsd } from '@/lib/config';
import { solText } from '@/lib/money';
import { updatePolicyText } from '@/lib/updates';
import { useWallet } from '@/lib/wallet';
import { ESCROW_PROGRAM_ID, explorerAddress, shortKey } from '@/lib/protocol-facts';

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
  creator: { handle: string | null; wallet: string; bondLamports: string };
  preview: string | null;
  /** Approved rich content. Drafts never reach the public listing. */
  content?: {
    readme: string;
    howto: string;
    requirements: string;
    gallery: GalleryImage[];
  } | null;
};

type VersionNote = { semver: string; changelog: string; created_at: string; status: string };

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
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState('');

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
    <article className="grid items-start gap-10 pb-24 lg:grid-cols-[1fr_400px] lg:pb-0">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link href="/" className="hover:text-ink">
            Explore
          </Link>{' '}
          /{' '}
          <Link href={`/c/${listing.category}`} className="hover:text-ink">
            {meta.label}
          </Link>
        </nav>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span
            className="rounded-tag border border-line px-2 py-0.5 font-mono text-[11px] font-semibold"
            style={{ color: meta.color, background: meta.bg }}
          >
            {meta.tag}
          </span>
          {verified ? <StatusTag status="live" /> : <Tag tone="warn">NOT VERIFIED</Tag>}
          {listing.holderOnly ? <Tag tone="info">HOLDER-ONLY</Tag> : null}
        </div>
        <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-[-0.03em]">
          {listing.title}
        </h1>
        <p className="mt-2 text-[17px] text-ink-2">{listing.summary}</p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <CreatorLink creator={listing.creator} />
          {listing.sales7d ? <span>{listing.sales7d} sold this week</span> : null}
          {rating ? (
            <span>
              <span aria-hidden="true">★</span> {rating.toFixed(1)}
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
          {listing.terminals.length ? <span>{listing.terminals.join(' · ')}</span> : null}
        </p>

        {listing.content?.gallery.length ? (
          <Gallery images={listing.content.gallery} title={listing.title} />
        ) : null}

        {security ? (
          <Panel
            tone={verified ? 'ok' : 'warn'}
            className="mt-6 flex flex-wrap items-center gap-4 p-4"
          >
            <ShieldIcon className={verified ? 'text-accent' : 'text-warn'} />
            <div className="min-w-0 flex-1">
              <p className="m-0 font-semibold">
                {verified ? 'Passed automated review' : 'Review pending'} · v{security.semver}
              </p>
              <p className="m-0 text-[13px] text-accent-body">
                {security.passed ?? security.checks.filter((c) => c.result === 'pass').length} of{' '}
                {security.total ?? security.checks.length} checks passed
                {security.review?.signedAt ? ` · signed ${utc(security.review.signedAt)}` : ''}
                {security.review ? ` · ${security.review.agentId}` : ''}
              </p>
            </div>
            <span className="font-mono text-xs text-accent-label" title={security.sha256}>
              SHA-256 {security.sha256.slice(0, 8)}…{security.sha256.slice(-6)}
            </span>
          </Panel>
        ) : null}

        <div
          role="tablist"
          aria-label="Listing details"
          className="mt-8 flex gap-1 overflow-x-auto border-b border-line"
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
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
                tab === name
                  ? 'border-accent text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
              onClick={() => setTab(name)}
            >
              {TAB_LABEL[name]}
              {name === 'reviews' && (reviewCount ?? listing.ratingCount)
                ? ` (${reviewCount ?? listing.ratingCount})`
                : ''}
            </button>
          ))}
        </div>
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-5">
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
              specs={specRows(listing.kind, listing.specs, listing.terminals)}
            />
          ) : null}
          {tab === 'changelog' ? <ChangelogPanel versions={versions} /> : null}
          {tab === 'reviews' ? <ReviewsPanel slug={listing.slug} onCount={setReviewCount} /> : null}
        </div>
      </div>

      <aside
        id="checkout"
        data-testid="checkout"
        aria-label="Checkout"
        className="rounded-panel border border-line bg-surface lg:sticky lg:top-6"
      >
        <div className="border-b border-line-soft p-5">
          <Label>Price</Label>
          <div className="mt-1 text-2xl font-semibold">
            <Money lamports={listing.price} centsPerSol={centsPerSol} strong />
          </div>
          {tier ? (
            <p className="mt-1 text-[13px] text-ink-2">
              Your tier: <span className="text-accent">{TIER_LABEL[tier] ?? tier}</span>
            </p>
          ) : null}
        </div>
        <div className="space-y-4 p-5">
          {!wallet.session ? <PreviewNotice compact /> : null}
          <FeeBreakdown
            price={listing.price}
            config={config}
            tier={tier}
            centsPerSol={centsPerSol}
            quoted={quote}
          />
          {quote ? (
            <p data-testid="tier-pill" className="m-0 text-xs text-muted">
              Quote locked for tier {TIER_LABEL[quote.tier] ?? quote.tier}
            </p>
          ) : null}
          {step !== 'idle' ? <CheckoutProgress step={step} /> : null}
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
              className="w-full"
              disabled={busy || wallet.busy}
              aria-busy={busy || undefined}
              onClick={() => void buy()}
            >
              {buyLabel(step, !!wallet.session, wallet.busy)}
            </Button>
          )}
          {message && step === 'failed' ? (
            <p role="alert" data-testid="toast" className="toast m-0 text-sm text-danger">
              {message}
            </p>
          ) : null}
          <ul className="m-0 space-y-2 p-0 text-[13px] text-ink-2">
            <li className="flex list-none gap-2">
              <ShieldIcon className="h-4 w-4 shrink-0 text-accent" />
              Held in escrow for {escrowWindowLabel(escrowHours)}. Dispute any time in that window.
            </li>
            <li className="flex list-none gap-2">
              <span className="shrink-0 text-muted">
                <LockIcon />
              </span>
              Download once payment is confirmed in escrow. Watermarked to your wallet.
            </li>
            <li data-testid="update-policy" className="flex list-none gap-2">
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-muted">
                ↻
              </span>
              <span>
                {updatePolicyText(listing.updatePrice, config?.updateFreeDays ?? 30)}. Every version
                you were entitled to stays downloadable.
              </span>
            </li>
            <li data-testid="escrow-program" className="flex list-none gap-2">
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-muted">
                ⛓
              </span>
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
            <li data-testid="devnet-hint" className="flex list-none gap-2">
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-muted">
                ◎
              </span>
              Devnet only. Switch your wallet to Solana Devnet before paying (Phantom: Settings →
              Developer Settings → Testnet Mode).
            </li>
          </ul>
          <p className="m-0 border-t border-line-soft pt-3 text-xs text-muted">
            License: {listing.license} · creator bond {solText(listing.creator.bondLamports)}
          </p>
        </div>
      </aside>

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
    <ol
      aria-label="Checkout progress"
      className="m-0 space-y-2 rounded-ctl border border-line-soft bg-inset p-3"
    >
      {PROGRESS.map(([key, label], index) => {
        const done = step === 'done' || index < current;
        const active = index === current && step !== 'done';
        return (
          <li key={key} className="flex list-none items-center gap-2.5 text-[13px]">
            <Square tone={done ? 'ok' : active ? 'info' : 'neutral'}>
              {done ? '✓' : active ? '◑' : index + 1}
            </Square>
            <span className={done || active ? 'text-ink' : 'text-muted'}>{label}</span>
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

function CreatorLink({ creator }: { creator: Listing['creator'] }) {
  const handle = creator.handle ?? creator.wallet;
  return (
    <Link href={`/u/${handle}`} className="text-ink-2 hover:text-ink">
      @{creator.handle ?? handle.slice(0, 4)}
    </Link>
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
