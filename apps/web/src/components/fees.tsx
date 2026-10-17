'use client';

import type { ReactNode } from 'react';
import { DEFAULT_CONFIG_JSON, quote, splitFee } from '@trenchmart/shared';
import { Money, Tag } from '@/components/ui';
import { TIER_LABEL, type PublicConfig } from '@/lib/config';

type FeeConfig = Pick<PublicConfig, 'feeBps' | 'tierRebateBps' | 'feeSplitBps'>;

/** Display fallback while /config/public loads; values are the seeded defaults. */
export const DEFAULT_FEES: FeeConfig = {
  feeBps: DEFAULT_CONFIG_JSON.fee_bps,
  tierRebateBps: { ...DEFAULT_CONFIG_JSON.tier_rebate_bps },
  feeSplitBps: { ...DEFAULT_CONFIG_JSON.fee_split_bps },
};

const SPLIT_LABEL: Record<string, string> = {
  buyback: '$TRENCH buyback',
  ai_verification: 'AI verification',
  ops: 'Operations',
  safety: 'Safety fund',
};

export const TIER_ORDER = ['none', 'scout', 'trencher', 'og'] as const;

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

export function effectiveFeeBps(config: FeeConfig, tier: string): number {
  const rebate = config.tierRebateBps[tier] ?? 0;
  return (config.feeBps * (10_000 - rebate)) / 10_000;
}

export function TierTable({
  config,
  current,
  className = '',
}: {
  config?: FeeConfig | null;
  current?: string;
  className?: string;
}) {
  const cfg = config ?? DEFAULT_FEES;
  return (
    <table className={`w-full border-collapse text-sm ${className}`}>
      <caption className="sr-only">Buyer fee by $TRENCH tier</caption>
      <thead>
        <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
          <th scope="col" className="py-2 pr-3 font-medium">
            Tier
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Fee discount
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            Buyer fee
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Creator commission
          </th>
        </tr>
      </thead>
      <tbody className="tabular font-mono">
        {TIER_ORDER.map((tier) => {
          const rebate = cfg.tierRebateBps[tier] ?? 0;
          const active = current === tier;
          return (
            <tr
              key={tier}
              className={`border-t border-line-soft ${active ? 'bg-accent-bg' : ''}`}
              aria-current={active ? 'true' : undefined}
            >
              <th scope="row" className="py-2.5 pr-3 text-left font-sans font-medium text-ink">
                {TIER_LABEL[tier]}
                {active ? (
                  <Tag tone="ok" className="ml-2">
                    YOU
                  </Tag>
                ) : null}
              </th>
              <td className="py-2.5 pr-3 text-ink-2">{rebate ? `${pct(rebate)} off` : '—'}</td>
              <td className={`py-2.5 pr-3 text-right ${rebate >= 10_000 ? 'text-accent' : ''}`}>
                {pct(effectiveFeeBps(cfg, tier))}
              </td>
              <td className="py-2.5 text-right text-accent">0%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Receipt shown before signing. Without a tier it shows the list price and the
 * full 5% fee, and says the discount applies after connecting.
 */
export function FeeBreakdown({
  price,
  config,
  tier,
  centsPerSol,
  quoted,
  showSplit = true,
}: {
  price: string;
  config?: FeeConfig | null;
  tier?: string;
  centsPerSol: string | null;
  /** Server quote; when present its amounts are shown as-is. */
  quoted?: { fee: string; rebate: string; total: string } | null;
  showSplit?: boolean;
}) {
  const cfg = config ?? DEFAULT_FEES;
  const rebateBps = tier ? (cfg.tierRebateBps[tier] ?? 0) : 0;
  const local = quote(BigInt(price), cfg.feeBps, rebateBps);
  const q = quoted
    ? {
        price: BigInt(price),
        fee: BigInt(quoted.fee),
        rebate: BigInt(quoted.rebate),
        total: BigInt(quoted.total),
        netFee: BigInt(quoted.fee) - BigInt(quoted.rebate),
      }
    : local;
  const split = splitFee(q.netFee, cfg.feeSplitBps);
  return (
    <div data-testid="fee-breakdown" className="text-sm">
      <dl className="m-0 space-y-2">
        <Line label="Listing price">
          <Money lamports={q.price} centsPerSol={centsPerSol} />
        </Line>
        <Line label={`Buyer fee (${pct(cfg.feeBps)})`}>
          <Money lamports={q.fee} centsPerSol={centsPerSol} />
        </Line>
        {tier ? (
          <Line
            label={
              <>
                {TIER_LABEL[tier] ?? tier} discount
                {rebateBps ? ` (${pct(rebateBps)} off the fee)` : ''}
              </>
            }
          >
            {q.rebate > 0n ? (
              <span className="text-accent">
                <Money lamports={-q.rebate} centsPerSol={centsPerSol} />
              </span>
            ) : (
              <span className="font-mono text-muted">0 SOL</span>
            )}
          </Line>
        ) : (
          <Line label="Your tier discount">
            <span className="text-[13px] text-info">Connect to apply</span>
          </Line>
        )}
        <Line label="Creator commission">
          <span className="font-mono text-accent">0%</span>
        </Line>
      </dl>
      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="font-display font-bold">
          {tier ? 'You pay' : 'You pay (before discount)'}
        </span>
        <Money
          lamports={q.total}
          centsPerSol={centsPerSol}
          strong
          stacked
          display
          className="text-right text-xl"
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        The creator receives the full listing price. Network fees are a fraction of a cent.
      </p>
      {showSplit && q.netFee > 0n ? (
        <details className="mt-3 rounded-ctl border border-line-soft bg-inset px-3 py-2">
          <summary className="cursor-pointer text-[13px] text-ink-2">Where the fee goes</summary>
          <dl className="m-0 mt-2 space-y-1.5 text-[13px]">
            {Object.entries(split).map(([key, lamports]) => (
              <Line
                key={key}
                label={`${SPLIT_LABEL[key] ?? key} · ${pct(cfg.feeSplitBps[key] ?? 0)}`}
              >
                <Money lamports={lamports} centsPerSol={centsPerSol} />
              </Line>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="m-0 text-right">{children}</dd>
    </div>
  );
}
