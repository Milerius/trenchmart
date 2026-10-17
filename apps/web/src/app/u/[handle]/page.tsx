'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ListingGrid, type Listing } from '@/components/listings';
import { api } from '@/lib/api';
import { solText } from '@/lib/money';

type Profile = {
  handle: string | null;
  wallet: string;
  xHandle: string | null;
  bond: string;
  listings: Listing[];
};

export default function CreatorPage() {
  const params = useParams<{ handle: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [cents, setCents] = useState<string | null>(null);

  useEffect(() => {
    void api<Profile>(`/creators/${params.handle}`)
      .then(setProfile)
      .catch(() => setMissing(true));
    void api<{ centsPerSol: string | null }>('/prices/sol').then((price) =>
      setCents(price.centsPerSol),
    );
  }, [params.handle]);

  if (missing) return <p>Creator not found.</p>;
  if (!profile) return <p>Loading creator…</p>;
  return (
    <section>
      <h1 className="text-3xl">@{profile.handle ?? profile.wallet.slice(0, 4)}</h1>
      <p className="mt-2 text-sm text-muted">
        Bond {solText(profile.bond)}
        {profile.xHandle ? ` · X @${profile.xHandle}` : ''}
      </p>
      <div className="mt-6">
        <ListingGrid listings={profile.listings} centsPerSol={cents} />
      </div>
    </section>
  );
}
