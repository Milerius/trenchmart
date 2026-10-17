import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import {
  compilePayoutBatch,
  compileUnsignedTransferMemo,
  decodeTransfersAndMemos,
  randomKeypair,
  signLegacyTransaction,
  signatureOf,
} from './tx';
import bs58 from 'bs58';

const blockhash = bs58.encode(new Uint8Array(32).fill(9));

describe('legacy transfer + memo', () => {
  it('round-trips an unsigned payment and a signed payout batch', () => {
    const buyer = randomKeypair();
    const vault = randomKeypair();
    const raw = compileUnsignedTransferMemo({
      from: buyer.publicKey,
      to: vault.publicKey,
      lamports: 1_530_000_000n,
      memo: 'tm:12345678',
      recentBlockhash: blockhash,
    });
    const decoded = decodeTransfersAndMemos(raw);
    expect(decoded.transfers).toEqual([
      { source: buyer.publicKey, destination: vault.publicKey, lamports: 1_530_000_000n },
    ]);
    expect(decoded.memos).toEqual(['tm:12345678']);

    const signed = signLegacyTransaction(raw, buyer.secretKey);
    const message = signed.slice(signed.length - (raw.length - 65));
    expect(
      nacl.sign.detached.verify(message, signed.slice(1, 65), bs58.decode(buyer.publicKey)),
    ).toBe(true);
    expect(signatureOf(signed).length).toBeGreaterThan(60);

    const creator = randomKeypair();
    const ops = randomKeypair();
    const batch = compilePayoutBatch({
      from: vault.publicKey,
      transfers: [
        { to: creator.publicKey, lamports: 5n },
        { to: ops.publicKey, lamports: 2n },
      ],
      recentBlockhash: blockhash,
      memo: 'payout',
    });
    const payout = decodeTransfersAndMemos(batch);
    expect(payout.transfers.map((row) => row.lamports)).toEqual([5n, 2n]);
    expect(payout.memos).toEqual(['payout']);
    expect(() =>
      compilePayoutBatch({ from: vault.publicKey, transfers: [], recentBlockhash: blockhash }),
    ).toThrow(/1 to 15/);
  });
});
