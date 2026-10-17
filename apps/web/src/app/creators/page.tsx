'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { solText } from '@/lib/money';

type Creator = { handle: string | null; wallet: string; volume: string; listings: number };

export default function CreatorsPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  useEffect(() => {
    void api<Creator[]>('/creators/top')
      .then(setCreators)
      .catch(() => setCreators([]));
  }, []);
  return (
    <section>
      <h1 className="text-3xl">Creators</h1>
      <ol className="mt-6 space-y-2">
        {creators.map((creator) => (
          <li key={creator.wallet}>
            <Link
              href={`/u/${creator.handle ?? creator.wallet}`}
              className="flex justify-between rounded-lg border border-line px-3 py-3"
            >
              <span>
                @{creator.handle ?? creator.wallet.slice(0, 4)} · {creator.listings} listings
              </span>
              <span className="font-mono text-sm">{solText(creator.volume)}</span>
            </Link>
          </li>
        ))}
        {creators.length === 0 ? (
          <li className="text-muted">No creators with live listings yet.</li>
        ) : null}
      </ol>
    </section>
  );
}
