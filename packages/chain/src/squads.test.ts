import { describe, expect, it } from 'vitest';
import {
  decodeSpendingLimit,
  effectiveRemaining,
  encodeSpendingLimitForTest,
  spendingLimitPda,
  spendingLimitUseSolIx,
  vaultPda,
} from './squads';

// Golden vectors produced with the official @sqds/multisig 2.1.4 SDK.
const MS = 'CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B';
const CK = '6RtuHqCrjcqEx4ZNNPscQaZ5r6FrnSXEBU67MvSGSJeq';
const SL = 'Dp3vacAct6i9Liaw4vviXkpcNbehxJFnkng6LwRYQsSX';
const ACCOUNT_HEX =
  '0ac91ba0dac3de98ac0b0acb6a0af0bfd56889d90bdb03742ceeeb5971c016b885ad1300103051ca50ab0f2feb0f096a6b524fe79cb213df451bfea874e6790af641a6ebfb3b47ae000000000000000000000000000000000000000000000000000000000000000000005ed0b20000000001e80300000000000000c0cf6a00000000fe0100000050ab0f2feb0f096a6b524fe79cb213df451bfea874e6790af641a6ebfb3b47ae00000000';
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe('squads spending limit', () => {
  it('derives the vault and spending limit PDAs like the SDK', () => {
    expect(vaultPda(MS, 0)).toBe('47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7');
    expect(spendingLimitPda(MS, CK)).toBe(SL);
  });

  it('encodes spending_limit_use for SOL byte for byte like the SDK', () => {
    const ix = spendingLimitUseSolIx({
      multisig: MS,
      member: CK,
      spendingLimit: SL,
      vault: vaultPda(MS),
      destination: CK,
      lamports: 250_000_000n,
      memo: 'payout:abc',
    });
    expect(Buffer.from(ix.data).toString('hex')).toBe(
      '1039827fc1149b8680b2e60e0000000009010a0000007061796f75743a616263',
    );
    expect(ix.keys.map((k) => `${k.pubkey}:${+k.isSigner}${+k.isWritable}`)).toEqual([
      `${MS}:00`,
      `${CK}:10`,
      `${SL}:01`,
      '47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7:01',
      `${CK}:01`,
      '11111111111111111111111111111111:00',
      ...Array(4).fill('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf:00'),
    ]);
    expect(() => spendingLimitUseSolIx({ ...ixBase(), lamports: 0n })).toThrow();
  });

  it('decodes the SDK account layout and round-trips the test encoder', () => {
    const limit = decodeSpendingLimit(hex(ACCOUNT_HEX));
    expect(limit).toMatchObject({
      multisig: MS,
      createKey: CK,
      vaultIndex: 0,
      mint: '11111111111111111111111111111111',
      amount: 3_000_000_000n,
      period: 'Day',
      remainingAmount: 1000n,
      lastReset: 1_792_000_000n,
      members: [CK],
      destinations: [],
    });
    expect(Buffer.from(encodeSpendingLimitForTest(limit)).toString('hex')).toBe(ACCOUNT_HEX);
    expect(() => decodeSpendingLimit(new Uint8Array(171))).toThrow();
  });

  it('applies the lazy period reset', () => {
    const limit = decodeSpendingLimit(hex(ACCOUNT_HEX));
    expect(effectiveRemaining(limit, 1_792_000_000 + 100)).toBe(1000n);
    expect(effectiveRemaining(limit, 1_792_000_000 + 86_400)).toBe(3_000_000_000n);
    expect(effectiveRemaining({ ...limit, period: 'OneTime' }, 1_900_000_000)).toBe(1000n);
  });
});

function ixBase() {
  return {
    multisig: MS,
    member: CK,
    spendingLimit: SL,
    vault: vaultPda(MS),
    destination: CK,
    lamports: 1n,
  };
}
