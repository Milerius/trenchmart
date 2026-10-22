'use client';

import type { ReactNode } from 'react';
import { quote, splitFee } from '@trenchmart/shared/fee';
import { displaySplitBps } from '@trenchmart/shared/rewards';
import { Money, Tag } from '@/components/ui';
import { TIER_LABEL, type PublicConfig } from '@/lib/config';
import { DEFAULT_FEES, compactHold, pct } from '@/components/fees';

type FeeConfig = Pick<PublicConfig, 'feeBps' | 'tierRebateBps' | 'feeSplitBps'>;

const SPLIT_LABEL: Record<string, string> = {
  holders: '$MART holders',
  buyback: '$MART buyback',
  ai_verification: 'Verification',
  ops: 'Operations',
  safety: 'Safety fund',
};

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
  const shown = displaySplitBps(cfg.feeSplitBps);
  const split = splitFee(q.netFee, shown);
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
        <span className="font-semibold">{tier ? 'You pay' : 'You pay (before discount)'}</span>
        <Money
          lamports={q.total}
          centsPerSol={centsPerSol}
          strong
          stacked
          className="text-right text-base"
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
                label={`${SPLIT_LABEL[key] ?? key} · ${pct((shown as Record<string, number>)[key] ?? 0)}`}
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
