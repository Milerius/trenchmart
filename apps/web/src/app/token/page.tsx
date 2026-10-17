'use client';

import { quote, solToLamports } from '@trenchmart/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { solText } from '@/lib/money';

type PublicConfig = {
  feeBps: number;
  tierRebateBps: Record<string, number>;
  tierThresholds: Record<string, string>;
  feeSplitBps: Record<string, number>;
};

export default function TokenPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [price, setPrice] = useState('1.5');
  const [tier, setTier] = useState('trencher');

  useEffect(() => {
    void api<PublicConfig>('/config/public')
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const rebateBps = config?.tierRebateBps[tier] ?? 0;
  let quoted: ReturnType<typeof quote> | null = null;
  try {
    if (config) quoted = quote(solToLamports(price || '0'), config.feeBps, rebateBps);
  } catch {
    quoted = null;
  }

  return (
    <article className="space-y-8">
      <header>
        <p className="text-xs uppercase text-accent">$TRENCH · fair launch on pump.fun</p>
        <h1 className="mt-3 text-4xl">Fees fund the token. The token cuts your fees.</h1>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <Tile label="Platform fee" value={config ? `${config.feeBps / 100}%` : '—'} />
        <Tile label="Max rebate" value="100%" />
        <Tile
          label="Buyback split"
          value={config ? `${(config.feeSplitBps.buyback ?? 0) / 100}%` : '—'}
        />
      </section>
      <section>
        <h2 className="text-xl">Where every fee goes</h2>
        <p className="mt-2 text-sm text-muted">
          The 25% AI verification bucket funds automated review credits. There is no human verifier
          payout.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {Object.entries(config?.feeSplitBps ?? {}).map(([bucket, bps]) => (
            <li key={bucket} className="rounded-xl border border-line p-4">
              {bucket.replace('_', ' ')} · {bps / 100}%
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-xl">Holder tiers</h2>
        <p className="mt-2 text-sm text-muted">
          Thresholds stay disabled until the owner sets real numbers. Placeholders are shown as
          proposed.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {Object.entries(
            config?.tierThresholds ?? { scout: '[X]', trencher: '[Y]', og: '[Z]' },
          ).map(([name, threshold]) => (
            <li
              key={name}
              data-testid="tier-pill"
              className="rounded-full border border-line px-3 py-1 text-sm"
            >
              {name} · {threshold}
            </li>
          ))}
        </ul>
      </section>
      <section
        data-testid="savings-calculator"
        className="rounded-xl border border-line bg-surface p-4"
      >
        <h2 className="text-xl">Savings calculator</h2>
        <label className="mt-4 block text-sm">
          List price (SOL)
          <input
            className="mt-1 w-full rounded-md border border-line bg-inset px-3 py-2"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm">
          Tier preview
          <select
            className="mt-1 w-full rounded-md border border-line bg-inset px-3 py-2"
            value={tier}
            onChange={(event) => setTier(event.target.value)}
          >
            {['none', 'scout', 'trencher', 'og'].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {quoted ? (
          <p className="mt-4 font-mono text-sm">
            Fee {solText(quoted.fee)} · rebate {solText(quoted.rebate)} · you pay{' '}
            {solText(quoted.total)}
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted">Enter a SOL amount with up to 9 decimals.</p>
        )}
      </section>
    </article>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="mt-2 font-mono text-2xl">{value}</p>
    </div>
  );
}
