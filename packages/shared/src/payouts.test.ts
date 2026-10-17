import { describe, expect, it } from 'vitest';
import { solToLamports } from './money';
import { quote } from './fee';
import { linesSum, refundPayout, releasePayouts, verificationFeePayout } from './payouts';

const split = { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 };

describe('releasePayouts', () => {
  it('pays the creator the list price and splits the Trencher net fee', () => {
    const q = quote(solToLamports('1.5'), 500, 6000);
    const lines = releasePayouts({
      price: q.price,
      netFee: q.netFee,
      splitBps: split,
      creatorWallet: 'creator',
      buckets: {
        buyback: 'buyback-wallet',
        ai_verification: 'ai-wallet',
        ops: 'ops-wallet',
        safety: 'safety-wallet',
      },
    });
    expect(linesSum(lines)).toBe(q.total);
    expect(lines.find((line) => line.bucket === 'creator')?.amount).toBe(1_500_000_000n);
    expect(lines.find((line) => line.bucket === 'ai_verification')?.amount).toBe(7_500_000n);
    expect(lines.find((line) => line.bucket === 'buyback')?.recipient).toBe('buyback-wallet');
  });

  it('uses UNCONFIGURED recipients and skips zero lines', () => {
    const lines = releasePayouts({
      price: 0n,
      netFee: 10n,
      splitBps: split,
      creatorWallet: 'creator',
      buckets: {},
    });
    expect(lines.every((line) => line.recipient.startsWith('UNCONFIGURED:'))).toBe(true);
    expect(linesSum(lines)).toBe(10n);
    expect(
      releasePayouts({
        price: 1n,
        netFee: 0n,
        splitBps: split,
        creatorWallet: 'creator',
        buckets: { buyback: '   ' },
      }).map((line) => line.bucket),
    ).toEqual(['creator']);
    expect(refundPayout(0n, 'buyer')).toEqual([]);
    expect(verificationFeePayout(0n)).toEqual([]);
  });

  it('sends the whole verification fee to the AI credit pool', () => {
    expect(verificationFeePayout(250_000_000n)).toEqual([
      {
        recipient: 'UNCONFIGURED:ai_verification',
        bucket: 'ai_verification',
        amount: 250_000_000n,
      },
    ]);
    expect(verificationFeePayout(5n, ' ai ')[0]?.recipient).toBe('ai');
    expect(refundPayout(9n, 'buyer')).toEqual([
      { recipient: 'buyer', bucket: 'refund', amount: 9n },
    ]);
  });
});
