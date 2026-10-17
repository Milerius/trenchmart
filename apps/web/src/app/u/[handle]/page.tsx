'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ListingGrid, type Listing } from '@/components/listings';
import { ButtonLink, EmptyState, Label, Money, Skeleton, Tag } from '@/components/ui';
import { api } from '@/lib/api';
import { usePublicConfig, useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

type Profile = {
  handle: string | null;
  wallet: string;
  xHandle: string | null;
  bond: string;
  listings: Listing[];
};

export default function CreatorPage() {
  const params = useParams<{ handle: string }>();
  const wallet = useWallet();
  const config = usePublicConfig();
  const cents = useSolUsd();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api<Profile>(`/creators/${params.handle}`)
      .then(setProfile)
      .catch(() => setMissing(true));
  }, [params.handle]);

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
        <p className="text-muted">Loading creator…</p>
        <Skeleton className="h-9 w-1/3" />
      </div>
    );
  }
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-panel border border-line bg-surface p-6">
        <div>
          <Label>Creator</Label>
          <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.03em]">
            @{profile.handle ?? profile.wallet.slice(0, 4)}
          </h1>
          <p className="m-0 mt-1 font-mono text-xs text-muted">
            {profile.wallet.slice(0, 4)}…{profile.wallet.slice(-4)}
            {profile.xHandle ? ` · X @${profile.xHandle}` : ''}
          </p>
        </div>
        <div className="text-right">
          <Label>Bond posted</Label>
          <div className="mt-1">
            <Money lamports={profile.bond} centsPerSol={cents} strong stacked />
          </div>
          <Tag tone="ok" className="mt-2">
            {profile.listings.length} AI-VERIFIED LISTING{profile.listings.length === 1 ? '' : 'S'}
          </Tag>
        </div>
      </div>
      <ListingGrid
        listings={profile.listings}
        centsPerSol={cents}
        config={config}
        tier={wallet.session?.tier}
      />
    </section>
  );
}
