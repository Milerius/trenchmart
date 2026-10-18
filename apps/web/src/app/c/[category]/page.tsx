'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { categoryMeta } from '@trenchmart/shared';
import { FeaturedRow, useFeatured } from '@/components/featured';
import { ListingGrid, type Listing } from '@/components/listings';
import { PreviewNotice } from '@/components/ui';
import { api } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

export default function CategoryPage() {
  const params = useParams<{ category: string }>();
  const wallet = useWallet();
  const config = usePublicConfig();
  const cents = useSolUsd();
  const meta = categoryMeta(params.category);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const featured = useFeatured('category', params.category);

  useEffect(() => {
    setListings(null);
    void api<Listing[]>(`/listings?category=${params.category}`)
      .then(setListings)
      .catch(() => setListings([]));
  }, [params.category, wallet.session?.wallet]);

  return (
    <section className="space-y-6">
      <div className="rounded-panel border border-line p-6" style={{ background: meta.bg }}>
        <span className="font-mono text-xs tracking-wide" style={{ color: meta.color }}>
          {meta.short}
        </span>
        <h1 className="m-0 mt-2 text-[32px] font-semibold tracking-[-0.03em]">{meta.label}</h1>
        <p className="m-0 mt-1 text-ink-2">{meta.desc}</p>
      </div>
      <FeaturedRow
        items={featured}
        centsPerSol={cents}
        config={config}
        tier={wallet.session?.tier}
      />
      {!wallet.session ? <PreviewNotice onConnect={() => void wallet.connect()} /> : null}
      <ListingGrid
        listings={listings ?? []}
        loading={listings === null}
        centsPerSol={cents}
        config={config}
        tier={wallet.session?.tier}
      />
    </section>
  );
}
