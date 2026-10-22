'use client';

import type { ReactNode } from 'react';
import { DEFAULT_CONFIG_JSON } from '@trenchmart/shared/config';
import { quote, splitFee } from '@trenchmart/shared/fee';
import { Money, Tag } from '@/components/ui';
import { TIER_LABEL, type PublicConfig } from '@/lib/config';

type FeeConfig = Pick<PublicConfig, 'feeBps' | 'tierRebateBps' | 'feeSplitBps'>;

export function compactHold(whole: string | undefined): string {
  const n = Number(whole);
  if (!whole || !Number.isFinite(n) || n <= 0) return 'any wallet';
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M held`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K held`;
  return `${n} held`;
}

/** Display fallback while /config/public loads; values are the seeded defaults. */
export const DEFAULT_FEES: FeeConfig = {
  feeBps: DEFAULT_CONFIG_JSON.fee_bps,
  tierRebateBps: { ...DEFAULT_CONFIG_JSON.tier_rebate_bps },
  feeSplitBps: { ...DEFAULT_CONFIG_JSON.fee_split_bps },
};

export const TIER_ORDER = ['none', 'scout', 'trencher', 'og'] as const;

export function pct(bps: number): string {
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
      <caption className="sr-only">Buyer fee by $MART tier</caption>
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

/** Prototype tier cards (home): fee per tier, hold needed, 0% creator commission; OG lit up. */
export function TierCards({
  config,
  current,
}: {
  config?: (FeeConfig & Partial<Pick<PublicConfig, 'tierThresholds'>>) | null;
  current?: string;
}) {
  const cfg = config ?? DEFAULT_FEES;
  const holds: Record<string, string> = {
    ...DEFAULT_CONFIG_JSON.tier_thresholds,
    ...(config?.tierThresholds ?? {}),
  };
  return (
    <ul className="m-0 grid gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {TIER_ORDER.map((tier) => {
        const top = (cfg.tierRebateBps[tier] ?? 0) >= 10_000;
        const active = current === tier;
        return (
          <li
            key={tier}
            data-testid="tier-card"
            aria-current={active ? 'true' : undefined}
            className={`relative flex list-none flex-col gap-6 overflow-hidden rounded-[22px] border p-6 ${top ? 'border-accent/60 bg-accent-bg' : 'border-line bg-surface/70'}`}
          >
            {top ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-accent/15 blur-3xl"
              />
            ) : null}
            <span className="relative flex items-center justify-between gap-2">
              <h3 className={`m-0 text-base font-semibold ${top ? 'text-accent' : ''}`}>
                {TIER_LABEL[tier]}
                {active ? (
                  <Tag tone="ok" className="ml-2">
                    YOU
                  </Tag>
                ) : null}
              </h3>
              <span className={`font-mono text-xs ${top ? 'text-ink' : 'text-faint'}`}>
                {tier === 'none' ? 'any wallet' : compactHold(holds[tier])}
              </span>
            </span>
            <span className="relative">
              <span
                className={`tabular block text-5xl font-semibold tracking-[-0.05em] ${top ? 'text-accent' : ''}`}
              >
                {pct(effectiveFeeBps(cfg, tier))}
              </span>
              <span className="text-sm text-muted">buyer fee</span>
            </span>
            <span className="relative text-sm text-ink-2">0% creator commission</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Receipt shown before signing. Without a tier it shows the list price and the
 * full 5% fee, and says the discount applies after connecting.
 */
