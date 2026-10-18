'use client';

import { DEFAULT_CONFIG_JSON } from '@trenchmart/shared/config';
import { solToLamports } from '@trenchmart/shared/money';
import { formatTrench } from '@trenchmart/shared/tier';
import { useState } from 'react';
import { DEFAULT_FEES, FeeBreakdown, TIER_ORDER, TierTable } from '@/components/fees';
import { Label } from '@/components/ui';
import { TIER_LABEL, usePublicConfig, useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

const SPLIT: Record<string, [string, string]> = {
  buyback: [
    '$TRENCH buyback',
    'Buys $TRENCH on a published schedule, with the transactions posted.',
  ],
  ai_verification: [
    'Verification',
    'Pays for automated review: static checks, sandbox runs and the review verdict.',
  ],
  ops: ['Operations', 'Running the marketplace.'],
  safety: [
    'Safety fund',
    "Backs refunds for upheld disputes when the creator's bond doesn't cover them.",
  ],
};

export default function TokenPage() {
  const config = usePublicConfig();
  const centsPerSol = useSolUsd();
  const wallet = useWallet();
  const [price, setPrice] = useState('1.5');
  const [tier, setTier] = useState('trencher');
  const fees = config ?? DEFAULT_FEES;

  let lamports: string | null;
  try {
    lamports = solToLamports(price || '0').toString();
  } catch {
    lamports = null;
  }

  return (
    <article className="space-y-14">
      <header className="max-w-3xl">
        <Label className="text-accent-label">$TRENCH · fair launch on pump.fun</Label>
        <h1 className="mt-3 text-[40px] font-semibold leading-tight tracking-[-0.03em]">
          Fees fund the token. The token cuts your fees.
        </h1>
        <p className="mt-4 text-[17px] text-ink-2">
          Buyers pay a {fees.feeBps / 100}% fee on top of the listing price. Holding $TRENCH cuts
          it: Scout 25% off, Trencher 60% off, OG pays nothing. Creators pay 0% commission at every
          tier.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-panel border border-line bg-surface p-5">
          <h2 className="m-0 text-lg font-semibold">Holder tiers</h2>
          <TierTable config={config} current={wallet.session?.tier} className="mt-3" />
          <div className="mt-5 border-t border-line-soft pt-4">
            <Label>Minimum balance to qualify</Label>
            <ul className="m-0 mt-2 flex flex-wrap gap-2 p-0">
              {Object.entries(config?.tierThresholds ?? DEFAULT_CONFIG_JSON.tier_thresholds).map(
                ([name, threshold]) => (
                  <li
                    key={name}
                    data-testid="tier-pill"
                    className="list-none rounded-full border border-line-control px-3 py-1 font-mono text-[13px] text-ink-2"
                  >
                    {TIER_LABEL[name] ?? name} · {formatTrench(threshold)}
                  </li>
                ),
              )}
            </ul>
            <p className="m-0 mt-2 text-xs text-muted">
              Your tier uses your lowest $TRENCH balance over the last{' '}
              {config?.tierWindowHours ?? 72} hours, read from Solana devnet.
            </p>
          </div>
        </div>

        <section
          data-testid="savings-calculator"
          className="rounded-panel border border-line bg-surface p-5"
        >
          <h2 className="m-0 text-lg font-semibold">Savings calculator</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              List price (SOL)
              <input
                className="mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2 font-mono text-sm"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Tier preview
              <select
                className="mt-1.5 w-full rounded-ctl border border-line-control bg-inset px-3 py-2 text-sm"
                value={tier}
                onChange={(event) => setTier(event.target.value)}
              >
                {TIER_ORDER.map((name) => (
                  <option key={name} value={name}>
                    {TIER_LABEL[name]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5">
            {lamports ? (
              <FeeBreakdown
                price={lamports}
                config={config}
                tier={tier}
                centsPerSol={centsPerSol}
                showSplit={false}
              />
            ) : (
              <p className="m-0 text-sm text-muted">Enter a SOL amount with up to 9 decimals.</p>
            )}
          </div>
        </section>
      </section>

      <section>
        <h2 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">Where every fee goes</h2>
        <p className="mt-2 max-w-2xl text-ink-2">
          The net fee, after your tier discount, is split four ways. The verification bucket funds
          automated review, not people.
        </p>
        <ul className="m-0 mt-6 grid gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(fees.feeSplitBps).map(([bucket, bps]) => (
            <li key={bucket} className="list-none rounded-card border border-line bg-surface p-5">
              <span className="tabular font-mono text-2xl font-semibold text-accent">
                {bps / 100}%
              </span>
              <span className="mt-2 block font-semibold">{SPLIT[bucket]?.[0] ?? bucket}</span>
              <span className="mt-1 block text-[13px] text-ink-2">{SPLIT[bucket]?.[1]}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
