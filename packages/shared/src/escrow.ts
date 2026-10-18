import type { OrderStatus } from './state';

export const PAYMENT_GRACE_MS = 5 * 60 * 1000;
export const MALICIOUS_DISPUTE_MS = 30 * 24 * 60 * 60 * 1000;

export type Transfer = {
  source: string;
  destination: string;
  lamports: bigint;
};

export type PaymentAssessment = { ok: true } | { ok: false; code: string; message: string };

export function paymentIsTimely(
  blockTimeMs: number,
  expiresAt: Date,
  graceMs = PAYMENT_GRACE_MS,
): boolean {
  return blockTimeMs <= expiresAt.getTime() + graceMs;
}

/**
 * Decide whether a confirmed transfer pays an order.
 * `now` is injected. Over/under-payment never auto-settles.
 */
export function assessPayment(input: {
  status: OrderStatus;
  expectedLamports: bigint;
  expectedMemo: string;
  expectedSource: string;
  expectedDestination: string;
  transfers: Transfer[];
  memos: string[];
  expiresAt: Date;
  blockTimeMs: number | null;
  txErr: boolean;
  now: Date;
}): PaymentAssessment {
  void input.now;
  if (input.txErr) return { ok: false, code: 'TX_FAILED', message: 'transaction failed' };
  if (input.status !== 'pending')
    return { ok: false, code: 'NOT_PENDING', message: 'order is not pending' };
  if (input.blockTimeMs === null)
    return { ok: false, code: 'NO_BLOCK_TIME', message: 'transaction has no block time' };
  if (!paymentIsTimely(input.blockTimeMs, input.expiresAt)) {
    return { ok: false, code: 'EXPIRED', message: 'payment arrived after the grace window' };
  }
  if (!input.memos.some((memo) => memo === input.expectedMemo)) {
    return { ok: false, code: 'WRONG_MEMO', message: 'memo does not match the order' };
  }
  const sameRoute = input.transfers.filter(
    (transfer) =>
      transfer.source === input.expectedSource &&
      transfer.destination === input.expectedDestination,
  );
  const exact = sameRoute.find((transfer) => transfer.lamports === input.expectedLamports);
  if (!exact) {
    if (sameRoute.length > 0) {
      return {
        ok: false,
        code: 'WRONG_AMOUNT',
        message: 'transfer amount does not match the order',
      };
    }
    return { ok: false, code: 'MISSING_TRANSFER', message: 'vault transfer not found' };
  }
  return { ok: true };
}

export function releaseDue(input: {
  status: OrderStatus;
  escrowUntil: Date | null;
  now: Date;
  openDispute: boolean;
  finalized: boolean;
}): boolean {
  if (input.status !== 'paid') return false;
  if (input.openDispute) return false;
  if (!input.finalized) return false;
  if (!input.escrowUntil) return false;
  return input.escrowUntil.getTime() <= input.now.getTime();
}

export function canOpenDispute(input: {
  status: OrderStatus;
  reason: 'malicious' | 'not_as_described' | 'broken' | 'other';
  escrowUntil: Date | null;
  paidAt: Date | null;
  now: Date;
}): boolean {
  if (input.status !== 'paid' && input.status !== 'released') return false;
  const paidAt = input.paidAt;
  if (input.reason === 'malicious') {
    if (!paidAt) return false;
    return input.now.getTime() <= paidAt.getTime() + MALICIOUS_DISPUTE_MS;
  }
  if (input.status !== 'paid') return false;
  if (!input.escrowUntil) return false;
  return input.now.getTime() < input.escrowUntil.getTime();
}

export function escrowUntilFrom(paidAt: Date, escrowHours: number): Date {
  return new Date(paidAt.getTime() + escrowHours * 3_600_000);
}

/** "1 hour", "2 hours", "30 minutes": escrow window copy that reads right for any config. */
export function escrowWindowLabel(hours: number): string {
  if (hours > 0 && hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/** Short form for chips: "1h", "30m". */
export function escrowWindowShort(hours: number): string {
  return hours > 0 && hours < 1 ? `${Math.round(hours * 60)}m` : `${hours}h`;
}
