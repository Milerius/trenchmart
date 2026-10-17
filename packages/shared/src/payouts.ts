import { splitFee } from './fee';

export const BUCKETS = [
  'creator',
  'buyback',
  'ai_verification',
  'ops',
  'safety',
  'refund',
] as const;
export type Bucket = (typeof BUCKETS)[number];

export type FeeSplitBps = Record<'buyback' | 'ai_verification' | 'ops' | 'safety', number>;

export type PayoutLine = {
  recipient: string;
  bucket: Bucket;
  amount: bigint;
};

export function bucketRecipient(
  bucket: 'buyback' | 'ai_verification' | 'ops' | 'safety',
  wallets: Partial<Record<'buyback' | 'ai_verification' | 'ops' | 'safety', string>>,
): string {
  const wallet = wallets[bucket]?.trim();
  if (wallet) return wallet;
  return `UNCONFIGURED:${bucket}`;
}

/** Creator receives the list price. The net fee is split; dust stays inside splitFee. */
export function releasePayouts(input: {
  price: bigint;
  netFee: bigint;
  splitBps: FeeSplitBps;
  creatorWallet: string;
  buckets: Partial<Record<'buyback' | 'ai_verification' | 'ops' | 'safety', string>>;
}): PayoutLine[] {
  const lines: PayoutLine[] = [];
  if (input.price > 0n) {
    lines.push({ recipient: input.creatorWallet, bucket: 'creator', amount: input.price });
  }
  const parts = splitFee(input.netFee, input.splitBps);
  const order = ['buyback', 'ai_verification', 'ops', 'safety'] as const;
  for (const bucket of order) {
    const amount = parts[bucket] ?? 0n;
    if (amount > 0n) {
      lines.push({ recipient: bucketRecipient(bucket, input.buckets), bucket, amount });
    }
  }
  return lines;
}

export function refundPayout(total: bigint, buyerWallet: string): PayoutLine[] {
  if (total <= 0n) return [];
  return [{ recipient: buyerWallet, bucket: 'refund', amount: total }];
}

/** Verification fees fund the AI credit pool in full. */
export function verificationFeePayout(amount: bigint, aiWallet?: string): PayoutLine[] {
  if (amount <= 0n) return [];
  const wallet = aiWallet?.trim();
  return [
    {
      recipient: wallet ? wallet : 'UNCONFIGURED:ai_verification',
      bucket: 'ai_verification',
      amount,
    },
  ];
}

export function linesSum(lines: PayoutLine[]): bigint {
  return lines.reduce((sum, line) => sum + line.amount, 0n);
}
