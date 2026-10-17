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
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  ESCROW_BUDGET,
  TRANSFER_BUDGET,
  computeBudgetIxs,
} from './escrow';
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

describe('compute budget', () => {
  it('prepends explicit CU limit, price and loaded-data limit without breaking payment decoding', () => {
    const buyer = randomKeypair();
    const vault = randomKeypair();
    const raw = compileUnsignedTransferMemo({
      from: buyer.publicKey,
      to: vault.publicKey,
      lamports: 5_000n,
      memo: 'tm:abcdef12',
      recentBlockhash: blockhash,
      budget: TRANSFER_BUDGET,
    });
    // one signature slot, then the message: header = 1 signer, 0 readonly signed, 3 readonly unsigned
    expect([...raw.subarray(65, 68)]).toEqual([1, 0, 3]);
    const keyCount = raw[68]!;
    const keys = Array.from({ length: keyCount }, (_, i) =>
      bs58.encode(raw.subarray(69 + i * 32, 101 + i * 32)),
    );
    expect(keys[0]).toBe(buyer.publicKey);
    expect(keys).toContain(COMPUTE_BUDGET_PROGRAM_ID);
    const decoded = decodeTransfersAndMemos(raw);
    expect(decoded.transfers).toEqual([
      { source: buyer.publicKey, destination: vault.publicKey, lamports: 5_000n },
    ]);
    expect(decoded.memos).toEqual(['tm:abcdef12']);
  });

  it('encodes the three ComputeBudget instructions little-endian', () => {
    const [limit, price, loaded] = computeBudgetIxs({
      units: 80_000,
      microLamportsPerUnit: 1_000n,
      loadedAccountsDataBytes: 512 * 1024,
    });
    for (const ix of [limit, price, loaded]) {
      expect(ix!.programId).toBe(COMPUTE_BUDGET_PROGRAM_ID);
      expect(ix!.keys).toEqual([]);
    }
    expect([...limit!.data]).toEqual([2, 0x80, 0x38, 0x01, 0x00]);
    expect([...price!.data]).toEqual([3, 0xe8, 0x03, 0, 0, 0, 0, 0, 0]);
    expect([...loaded!.data]).toEqual([4, 0x00, 0x00, 0x08, 0x00]);
    expect(ESCROW_BUDGET.units).toBeGreaterThan(36_868 * 2);
  });
});
