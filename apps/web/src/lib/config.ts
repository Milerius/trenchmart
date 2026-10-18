'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export type PublicConfig = {
  feeBps: number;
  tierRebateBps: Record<string, number>;
  tierThresholds: Record<string, string>;
  feeSplitBps: Record<string, number>;
  tierWindowHours?: number;
  escrowHours: number;
  verificationFeeLamports: string;
  bondLamportsByCategory: Record<string, string>;
  updateFreeDays?: number;
  updatePeriodDays?: number;
  updatePriceDefaultBps?: number;
  updateLimitPerListingDay?: number;
  uploadLimitPerCreatorDay?: number;
  uploadSupplementLamports?: string;
  verifyFreePerDay?: number;
  verifySupplementLamports?: string;
};

let configCache: Promise<PublicConfig | null> | null = null;
let priceCache: Promise<string | null> | null = null;

export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    configCache ??= api<PublicConfig>('/config/public').catch(() => null);
    void configCache.then(setConfig);
  }, []);
  return config;
}

/** Cents per SOL, or null when the price feed is unavailable. */
export function useSolUsd(): string | null {
  const [cents, setCents] = useState<string | null>(null);
  useEffect(() => {
    priceCache ??= api<{ centsPerSol: string | null }>('/prices/sol')
      .then((price) => price.centsPerSol)
      .catch(() => null);
    void priceCache.then(setCents);
  }, []);
  return cents;
}

export const TIER_LABEL: Record<string, string> = {
  none: 'No tier',
  scout: 'Scout',
  trencher: 'Trencher',
  og: 'OG',
};

export function tierChip(tier: string, config: PublicConfig | null): string {
  const bps = config?.tierRebateBps[tier] ?? 0;
  if (!bps) return `${TIER_LABEL[tier] ?? tier} · 5% fee`;
  return bps >= 10000
    ? `${TIER_LABEL[tier] ?? tier} · 0% fee`
    : `${TIER_LABEL[tier] ?? tier} · ${bps / 100}% off fees`;
}
