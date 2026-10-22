'use client';

import { startTransition, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** GET /api/v1/rewards/*: $MART holder rewards (docs/ops/holder-rewards.md). */
export type RewardEpoch = {
  epoch: number;
  startsAt: string;
  endsAt: string;
  status: 'closed' | 'funding' | 'paying' | 'paid' | 'halted' | 'skipped';
  revenue: { lamports: string; sol: string };
  costs: Partial<Record<'rpc' | 'network_fee' | 'priority_fee' | 'payout_fee' | 'infra', string>>;
  costTotal: string;
  holderPool: { lamports: string; sol: string };
  eligible: number;
  paidCount: number;
  carriedCount: number;
  paidLamports: string;
  /** SOL actually sent to holders (reconciled batches, incl. carry-in). */
  paid?: { lamports: string; sol: string; recipients: number };
  buybackForward: string;
  samples: { done: number; planned: number };
  seed: string;
  fundSig: string | null;
  batches: {
    n: number;
    recipients: number;
    lamports: string;
    sig: string | null;
    status: string;
  }[];
  paidAt: string | null;
};
export type RewardCurrent = {
  epoch: number;
  startsAt: string;
  endsAt: string;
  epochSeconds: number;
  samples: { done: number; planned: number };
  revenueSoFar: string;
  holderGrossSoFar: string;
  carryIn: string;
  rules: {
    topN: number;
    minSupplyBps: number;
    minPayoutLamports: string;
    holdEpochs: number;
    samplesPerEpoch: number;
    holderShareBps: number;
  };
  mint: string;
  vault: string;
  sending: boolean;
};
export type WalletRewards = {
  wallet: string;
  carry: string;
  currentMinBalance: string | null;
  epochs: {
    epoch: number;
    rank: number;
    weight: string;
    share: string;
    carryIn: string;
    lamports: string;
    status: 'pay' | 'carried';
    sig: string | null;
  }[];
};

type Loaded<T> = T | null | 'error';

function usePoll<T>(path: string | null, pick: (body: unknown) => T, everyMs = 60_000): Loaded<T> {
  const [data, setData] = useState<Loaded<T>>(null);
  useEffect(() => {
    if (!path) return;
    let stop = false;
    const load = () =>
      void api<unknown>(path)
        .then((body) => !stop && startTransition(() => setData(pick(body))))
        .catch(() => !stop && setData((prev) => (prev && prev !== 'error' ? prev : 'error')));
    load();
    const timer = window.setInterval(load, everyMs);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [path, everyMs]);
  return data;
}

export const useRewardEpochs = (limit = 8) =>
  usePoll(`/rewards/epochs/recent?limit=${limit}`, (b) =>
    Array.isArray((b as { epochs?: unknown })?.epochs)
      ? (b as { epochs: RewardEpoch[] }).epochs
      : [],
  );
export const useRewardCurrent = () => usePoll('/rewards/current', (b) => b as RewardCurrent);
export const useWalletRewards = (wallet: string | null) =>
  usePoll(wallet ? `/rewards/wallet/${wallet}` : null, (b) => b as WalletRewards);

export function sol(lamports: string | bigint | number, digits = 4): string {
  const n = Number(BigInt(lamports)) / 1e9;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function epochAgo(iso: string, nowMs = Date.now()): string {
  const m = Math.max(0, (nowMs - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, Math.round(m))}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export type RewardTop = {
  epoch: number | null;
  holders: {
    wallet: string;
    rank: number;
    weightBps: number;
    lamports: string;
    status: 'pay' | 'carried';
  }[];
};
export const useRewardTop = (limit = 5) =>
  usePoll(`/rewards/top?limit=${limit}`, (b) => b as RewardTop);
