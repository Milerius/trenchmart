import { describe, expect, it } from 'vitest';
import {
  assessPayment,
  canOpenDispute,
  escrowUntilFrom,
  escrowWindowLabel,
  escrowWindowShort,
  paymentIsTimely,
  releaseDue,
} from './escrow';

const now = new Date('2026-01-01T00:00:00.000Z');
const expires = new Date('2026-01-01T00:20:00.000Z');

const base = {
  status: 'pending' as const,
  expectedLamports: 100n,
  expectedMemo: 'tm:abcd1234',
  expectedSource: 'buyer',
  expectedDestination: 'vault',
  transfers: [{ source: 'buyer', destination: 'vault', lamports: 100n }],
  memos: ['tm:abcd1234'],
  expiresAt: expires,
  blockTimeMs: now.getTime(),
  txErr: false,
  now,
};

describe('assessPayment', () => {
  it('accepts an exact timely transfer', () => {
    expect(assessPayment(base)).toEqual({ ok: true });
  });

  it('rejects a failed transaction, a non-pending order, and a missing block time', () => {
    const failed = assessPayment({ ...base, txErr: true });
    const paid = assessPayment({ ...base, status: 'paid' });
    const timeless = assessPayment({ ...base, blockTimeMs: null });
    expect(failed.ok).toBe(false);
    if (!paid.ok) expect(paid.code).toBe('NOT_PENDING');
    if (!timeless.ok) expect(timeless.code).toBe('NO_BLOCK_TIME');
  });

  it('allows five minutes of grace and rejects anything later', () => {
    const lateButGrace = expires.getTime() + 4 * 60 * 1000;
    const tooLate = expires.getTime() + 6 * 60 * 1000;
    expect(paymentIsTimely(lateButGrace, expires)).toBe(true);
    expect(assessPayment({ ...base, blockTimeMs: lateButGrace }).ok).toBe(true);
    const expired = assessPayment({ ...base, blockTimeMs: tooLate });
    if (!expired.ok) expect(expired.code).toBe('EXPIRED');
  });

  it('rejects a wrong memo, a wrong amount, and a missing transfer', () => {
    const memo = assessPayment({ ...base, memos: ['tm:nope'] });
    const amount = assessPayment({
      ...base,
      transfers: [{ source: 'buyer', destination: 'vault', lamports: 90n }],
    });
    const missing = assessPayment({ ...base, transfers: [] });
    if (!memo.ok) expect(memo.code).toBe('WRONG_MEMO');
    if (!amount.ok) expect(amount.code).toBe('WRONG_AMOUNT');
    if (!missing.ok) expect(missing.code).toBe('MISSING_TRANSFER');
  });
});

describe('release and disputes', () => {
  const escrowUntil = new Date(now.getTime() - 1000);

  it('releases a finalized paid order once the window has passed', () => {
    expect(
      releaseDue({ status: 'paid', escrowUntil, now, openDispute: false, finalized: true }),
    ).toBe(true);
    expect(
      releaseDue({ status: 'paid', escrowUntil, now, openDispute: true, finalized: true }),
    ).toBe(false);
    expect(
      releaseDue({ status: 'paid', escrowUntil, now, openDispute: false, finalized: false }),
    ).toBe(false);
    expect(
      releaseDue({ status: 'disputed', escrowUntil, now, openDispute: false, finalized: true }),
    ).toBe(false);
    expect(
      releaseDue({ status: 'paid', escrowUntil: null, now, openDispute: false, finalized: true }),
    ).toBe(false);
    expect(
      releaseDue({
        status: 'paid',
        escrowUntil: new Date(now.getTime() + 1000),
        now,
        openDispute: false,
        finalized: true,
      }),
    ).toBe(false);
  });

  it('opens ordinary disputes only inside the window and malicious ones for 30 days', () => {
    const paidAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(
      canOpenDispute({
        status: 'paid',
        reason: 'broken',
        escrowUntil: new Date(now.getTime() + 1000),
        paidAt,
        now,
      }),
    ).toBe(true);
    expect(canOpenDispute({ status: 'paid', reason: 'broken', escrowUntil, paidAt, now })).toBe(
      false,
    );
    expect(canOpenDispute({ status: 'released', reason: 'broken', escrowUntil, paidAt, now })).toBe(
      false,
    );
    expect(
      canOpenDispute({ status: 'released', reason: 'malicious', escrowUntil, paidAt, now }),
    ).toBe(true);
    expect(
      canOpenDispute({
        status: 'released',
        reason: 'malicious',
        escrowUntil,
        paidAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
        now,
      }),
    ).toBe(false);
    expect(
      canOpenDispute({ status: 'pending', reason: 'malicious', escrowUntil, paidAt, now }),
    ).toBe(false);
    expect(
      canOpenDispute({ status: 'paid', reason: 'malicious', escrowUntil, paidAt: null, now }),
    ).toBe(false);
    expect(
      canOpenDispute({ status: 'paid', reason: 'other', escrowUntil: null, paidAt, now }),
    ).toBe(false);
  });

  it('adds escrow hours to the paid timestamp', () => {
    expect(escrowUntilFrom(now, 48).toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
});

describe('escrow window labels', () => {
  it('formats hours and minutes', () => {
    expect(escrowWindowLabel(1)).toBe('1 hour');
    expect(escrowWindowLabel(2)).toBe('2 hours');
    expect(escrowWindowLabel(0.5)).toBe('30 minutes');
    expect(escrowWindowLabel(1 / 60)).toBe('1 minute');
    expect(escrowWindowShort(1)).toBe('1h');
    expect(escrowWindowShort(0.25)).toBe('15m');
  });
});
