'use client';

import { solToLamports } from '@trenchmart/shared/money';
import { useState } from 'react';
import { DEFAULT_FEES, FeeBreakdown, TIER_ORDER, TierCards } from '@/components/fees';
import { GradientWords } from '@/components/gradient-words';
import { MARKET_WRAP } from '@/components/page-hero';
import { TIER_LABEL, usePublicConfig, useSolUsd } from '@/lib/config';
import { useWallet } from '@/lib/wallet';

const SPLIT: Record<string, [string, string, string]> = {
  buyback: [
    '$TRENCH buyback',
    'Buys $TRENCH on a published schedule, with the transactions posted.',
    '#C6F432',
  ],
  ai_verification: [
    'Verification',
    'Pays for automated review: static checks, sandbox runs and the review verdict.',
    '#7CC4FF',
  ],
  ops: ['Operations', 'Running the marketplace.', '#C9A2FF'],
  safety: [
    'Safety fund',
    "Backs refunds for upheld disputes when the creator's bond doesn't cover them.",
    '#F5A524',
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
    <article>
      <section className="relative overflow-hidden border-b border-line-soft">
        <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-0" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-56 left-1/2 h-[520px] w-[900px] max-w-[200vw] -translate-x-1/2 rounded-full bg-accent/15 blur-[120px]"
        />
        <div
          className={`${MARKET_WRAP} relative flex flex-col items-start gap-6 pt-16 pb-14 sm:pt-20`}
        >
          <span className="font-mono text-xs font-medium tracking-[.18em] text-accent uppercase">
            $TRENCH · fair launch on pump.fun
          </span>
          <h1 className="m-0 max-w-5xl text-[clamp(40px,6vw,84px)] leading-[0.98] font-semibold tracking-[-0.05em]">
            Fees fund the token.{' '}
            <GradientWords colors={['#C6F432', '#7CC4FF', '#C9A2FF', '#C6F432']} speed={5}>
              The token cuts your fees.
            </GradientWords>
          </h1>
          <p className="m-0 max-w-2xl text-lg text-ink-2">
            Buyers pay a {fees.feeBps / 100}% fee on top of the listing price. Holding $TRENCH cuts
            it: Scout 25% off, Trencher 60% off, OG pays nothing. Creators pay 0% commission at
            every tier.
          </p>
        </div>
      </section>

      <div className={`${MARKET_WRAP} flex flex-col gap-14 py-14`}>
        <section aria-labelledby="tiers-heading" className="flex flex-col gap-6">
          <h2 id="tiers-heading" className="m-0 text-3xl font-semibold tracking-[-0.03em]">
            Holder tiers
          </h2>
          <TierCards config={config} current={wallet.session?.tier} />
          <p className="m-0 text-sm text-muted">
            Your tier uses your lowest $TRENCH balance over the last {config?.tierWindowHours ?? 72}{' '}
            hours, read from Solana devnet.
          </p>
        </section>

        <section
          data-testid="savings-calculator"
          aria-labelledby="calc-heading"
          className="grid gap-6 lg:grid-cols-[1fr_1.1fr]"
        >
          <div className="flex flex-col gap-5 rounded-panel border border-line bg-surface p-7">
            <h2 id="calc-heading" className="m-0 text-2xl font-semibold tracking-tight">
              Savings calculator
            </h2>
            <label className="flex flex-col gap-2 text-sm text-muted">
              List price (SOL)
              <span className="flex items-center rounded-2xl border border-line bg-inset px-4 focus-within:border-accent/60">
                <input
                  className="min-h-14 w-full bg-transparent text-3xl font-semibold tracking-tight text-ink outline-none"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
                <span className="font-mono text-ink-2">SOL</span>
              </span>
              {lamports ? null : (
                <span className="text-danger">Enter a SOL amount with up to 9 decimals.</span>
              )}
            </label>
            <div className="flex flex-col gap-2 text-sm text-muted">
              <span id="tier-preview">Tier preview</span>
              <div
                role="radiogroup"
                aria-labelledby="tier-preview"
                className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-inset p-1"
              >
                {TIER_ORDER.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={tier === name}
                    onClick={() => setTier(name)}
                    className={`motion-press min-h-11 rounded-xl text-sm font-medium ${tier === name ? 'bg-accent text-onaccent' : 'text-ink-2 hover:text-ink'}`}
                  >
                    {TIER_LABEL[name]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-panel border border-line bg-surface p-7">
            {lamports ? (
              <FeeBreakdown
                price={lamports}
                config={config}
                tier={tier}
                centsPerSol={centsPerSol}
                showSplit={false}
              />
            ) : (
              <p className="m-0 text-sm text-muted">Enter a SOL amount to see your price.</p>
            )}
            <p className="m-0 mt-4 text-xs text-faint">
              The creator receives the full listing price.
            </p>
          </div>
        </section>

        <section aria-labelledby="split-heading" className="flex flex-col gap-6">
          <h2 id="split-heading" className="m-0 text-3xl font-semibold tracking-[-0.03em]">
            Where every fee goes
          </h2>
          <p className="m-0 max-w-2xl text-ink-2">
            The net fee, after your tier discount, is split four ways. The verification bucket funds
            automated review, not people.
          </p>
          <div aria-hidden="true" className="flex h-4 overflow-hidden rounded-full">
            {Object.entries(fees.feeSplitBps).map(([bucket, bps]) => (
              <span
                key={bucket}
                style={{ width: `${bps / 100}%`, background: SPLIT[bucket]?.[2] ?? '#9AA197' }}
              />
            ))}
          </div>
          <ul className="m-0 grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(fees.feeSplitBps).map(([bucket, bps]) => (
              <li
                key={bucket}
                data-testid="fee-split"
                className="flex list-none flex-col gap-3 rounded-[22px] border border-line bg-surface/70 p-6"
                style={{ boxShadow: `inset 0 2px 0 ${SPLIT[bucket]?.[2] ?? '#9AA197'}` }}
              >
                <span
                  className="tabular text-4xl font-semibold tracking-[-0.04em]"
                  style={{ color: SPLIT[bucket]?.[2] }}
                >
                  {bps / 100}%
                </span>
                <span className="font-semibold">{SPLIT[bucket]?.[0] ?? bucket}</span>
                <span className="text-sm text-muted">{SPLIT[bucket]?.[1]}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}
