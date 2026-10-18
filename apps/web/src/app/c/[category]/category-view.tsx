'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { categoryMeta } from '@trenchmart/shared/categories';
import { FeaturedRow, useFeatured } from '@/components/featured';
import type { Listing } from '@/components/listings';
import { CategoryHero, MarketGrid } from '@/components/market';
import { api } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

export function CategoryView() {
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
    <>
      <CategoryHero meta={meta} config={config} />
      <MarketGrid
        listings={listings}
        fixedCategory={meta.code}
        centsPerSol={cents}
        config={config}
        tier={wallet.session?.tier}
        onConnect={wallet.session ? undefined : () => void wallet.connect()}
        before={
          <FeaturedRow
            items={featured}
            centsPerSol={cents}
            config={config}
            tier={wallet.session?.tier}
          />
        }
      />
    </>
  );
}
