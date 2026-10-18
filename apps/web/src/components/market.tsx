'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { CATEGORIES, type CategoryMeta } from '@trenchmart/shared/categories';
import { DEFAULT_ESCROW_HOURS } from '@trenchmart/shared/config';
import { escrowWindowShort } from '@trenchmart/shared/escrow';
import { TERMINALS } from '@trenchmart/shared/terminals';
import { ListingGrid, type Listing } from '@/components/listings';
import { GradientWords } from '@/components/gradient-words';
import { TerminalMark } from '@/components/terminal-logo';
import { PreviewNotice } from '@/components/ui';
import type { PublicConfig } from '@/lib/config';
import { solExact } from '@/lib/money';

export { MARKET_WRAP, PageHero } from '@/components/page-hero';
import { MARKET_WRAP } from '@/components/page-hero';

/** Category title: animated GradientText on desktop, a static gradient elsewhere. */
function CategoryTitle({ meta }: { meta: CategoryMeta }) {
  return <GradientWords colors={[meta.color, '#ffffff', meta.color]}>{meta.label}</GradientWords>;
}

/** Prototype category hero: tinted radial, "0N / SHORT" eyebrow, gradient title, facts, siblings. */
export function CategoryHero({
  meta,
  config,
}: {
  meta: CategoryMeta;
  config?: PublicConfig | null;
}) {
  const bond = config?.bondLamportsByCategory?.[meta.code];
  const facts = [
    bond ? `Creator bond ${solExact(bond).replace(/\.0+$|(\.\d*?)0+$/, '$1')} SOL` : null,
    '0% creator commission',
    `${escrowWindowShort(config?.escrowHours ?? DEFAULT_ESCROW_HOURS)} escrow`,
  ].filter(Boolean) as string[];
  return (
    <section
      data-testid="category-hero"
      className="relative overflow-hidden border-b border-line-soft"
      style={{
        background: `radial-gradient(70% 120% at 0% 0%, ${meta.color}22, transparent 60%), ${meta.bg}`,
      }}
    >
      <div
        aria-hidden="true"
        className="grid-fade pointer-events-none absolute inset-0 opacity-60"
      />
      <div className={`${MARKET_WRAP} relative flex flex-col gap-5 py-14 sm:py-16`}>
        <span className="font-mono text-xs tracking-[.18em]" style={{ color: meta.color }}>
          {meta.short}
        </span>
        <h1 className="m-0 text-[clamp(44px,6vw,84px)] leading-none font-semibold tracking-[-0.05em]">
          <CategoryTitle meta={meta} />
        </h1>
        <p className="m-0 max-w-xl text-lg text-ink-2">{meta.desc}</p>
        <ul className="m-0 flex flex-wrap gap-2 p-0 font-mono text-xs text-ink-2">
          {facts.map((fact) => (
            <li
              key={fact}
              className="list-none rounded-full border border-white/10 bg-black/30 px-3 py-1.5"
            >
              {fact}
            </li>
          ))}
        </ul>
        <nav aria-label="Other categories" className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.filter((c) => c.code !== meta.code).map((c) => (
            <Link
              key={c.code}
              href={`/c/${c.code}`}
              className="rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-ink-2 hover:text-ink"
              style={{ boxShadow: `inset 3px 0 0 ${c.color}` }}
            >
              {c.label}
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}

/** "01 / SCRIPTS" -> "Scripts" for the filter pills. */
function pillLabel(short: string): string {
  const word = short.split(' / ').pop() ?? short;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

type Sort = 'trending' | 'rating' | 'price';

function sortRows(rows: Listing[], sort: Sort): Listing[] {
  const copy = [...rows];
  if (sort === 'price') return copy.sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1));
  if (sort === 'rating')
    return copy.sort((a, b) => Number(b.ratingAvg ?? 0) - Number(a.ratingAvg ?? 0));
  // Trending: the server order (rank) stays as the tie-breaker.
  return copy.sort(
    (a, b) => (b.sales7d ?? 0) - (a.sales7d ?? 0) || (b.upvotes ?? 0) - (a.upvotes ?? 0),
  );
}

/** Prototype market body: filter panel (category, terminals, sort), preview notice, count, grid. */
export function MarketGrid({
  listings,
  fixedCategory,
  query,
  centsPerSol,
  config,
  tier,
  onConnect,
  before,
}: {
  listings: Listing[] | null;
  fixedCategory?: string;
  query?: string;
  centsPerSol: string | null;
  config?: PublicConfig | null;
  tier?: string;
  onConnect?: () => void;
  /** Rendered between the filters and the notice (the category's featured row). */
  before?: ReactNode;
}) {
  const [category, setCategory] = useState('all');
  const [terminals, setTerminals] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('trending');
  const rows = useMemo(() => {
    if (!listings) return null;
    const filtered = listings.filter(
      (row) =>
        (fixedCategory || category === 'all' || row.category === category) &&
        (!terminals.length || row.terminals.some((t) => t === 'Any' || terminals.includes(t))),
    );
    return sortRows(filtered, sort);
  }, [listings, fixedCategory, category, terminals, sort]);
  const filtering = (!fixedCategory && category !== 'all') || terminals.length > 0;

  return (
    <div className={`${MARKET_WRAP} flex min-h-[60vh] flex-col gap-6 py-10`}>
      <div
        data-testid="market-filters"
        className="flex flex-col gap-4 rounded-[22px] border border-line bg-surface/60 p-4 sm:p-5"
      >
        {fixedCategory ? null : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
            {[{ code: 'all', short: 'ALL', color: '#EEF0EA' }, ...CATEGORIES].map((c) => {
              const on = category === c.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCategory(c.code)}
                  className={`motion-press min-h-9 rounded-full border px-4 text-sm font-medium ${on ? 'border-transparent text-bg' : 'border-line text-ink-2 hover:text-ink'}`}
                  style={on ? { background: c.color } : undefined}
                >
                  {pillLabel(c.short)}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Terminals">
          <SlidersHorizontal size={16} className="mr-1 text-muted" aria-hidden="true" />
          {TERMINALS.map((name) => {
            const on = terminals.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setTerminals((list) => (on ? list.filter((t) => t !== name) : [...list, name]))
                }
                className={`motion-press flex min-h-9 items-center gap-2 rounded-full border pr-3.5 pl-1.5 text-sm ${on ? 'border-accent/60 bg-accent-bg text-accent' : 'border-line text-ink-2 hover:text-ink'}`}
              >
                <TerminalMark name={name} className="h-6 w-6 rounded-full" />
                {name}
              </button>
            );
          })}
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            Sort
            <select
              data-testid="market-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="min-h-9 rounded-full border border-line bg-inset px-3 text-ink"
            >
              <option value="trending">Trending</option>
              <option value="rating">Top rated</option>
              <option value="price">Lowest price</option>
            </select>
          </label>
        </div>
      </div>
      {before}
      {onConnect ? <PreviewNotice onConnect={onConnect} /> : null}
      {/* Always rendered so the grid does not move when the count arrives. */}
      <p className="m-0 min-h-5 font-mono text-sm text-muted">
        {rows ? `${rows.length} reviewed listing${rows.length === 1 ? '' : 's'}` : '\u00a0'}
      </p>
      <ListingGrid
        listings={rows ?? []}
        loading={rows === null}
        centsPerSol={centsPerSol}
        config={config}
        tier={tier}
        wide
        emptyTitle={
          query
            ? `Nothing matches “${query}”`
            : filtering
              ? 'Nothing matches these filters'
              : undefined
        }
        emptyBody={
          query
            ? 'Try a terminal name, a category, or fewer words.'
            : filtering
              ? 'Clear a filter to see more reviewed listings.'
              : undefined
        }
      />
    </div>
  );
}
