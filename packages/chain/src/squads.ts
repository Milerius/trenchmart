// Squads v4 spending limits: the one Squads surface the API uses. A spending limit is a
// multisig-owned account that lets listed members move at most `amount` of one mint out of one
// vault per period, without a proposal. The multisig creates, changes and removes it.
import bs58 from 'bs58';
import { sha256 } from '@noble/hashes/sha2';
import { findProgramAddress, type Instruction } from './escrow';

export const SQUADS_PROGRAM_ID = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
/** Squads encodes native SOL as the default (all-zero) pubkey. */
export const NATIVE_MINT_DEFAULT = '11111111111111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';

const enc = new TextEncoder();
const SPENDING_LIMIT_USE = Uint8Array.from([16, 57, 130, 127, 193, 20, 155, 134]);
export const SPENDING_LIMIT_DISCRIMINATOR = sha256(enc.encode('account:SpendingLimit')).slice(0, 8);

export type SpendingPeriod = 'OneTime' | 'Day' | 'Week' | 'Month';
const PERIODS: SpendingPeriod[] = ['OneTime', 'Day', 'Week', 'Month'];
export const PERIOD_SECONDS: Record<SpendingPeriod, number> = {
  OneTime: Number.POSITIVE_INFINITY,
  Day: 86_400,
  Week: 7 * 86_400,
  Month: 30 * 86_400,
};

export type SpendingLimitAccount = {
  multisig: string;
  createKey: string;
  vaultIndex: number;
  mint: string;
  amount: bigint;
  period: SpendingPeriod;
  remainingAmount: bigint;
  lastReset: bigint;
  bump: number;
  members: string[];
  destinations: string[];
};

function pk(value: string): Uint8Array {
  const raw = bs58.decode(value);
  if (raw.length !== 32) throw new Error(`not a pubkey: ${value}`);
  return raw;
}

export function vaultPda(multisig: string, index = 0, programId = SQUADS_PROGRAM_ID): string {
  return findProgramAddress(
    [enc.encode('multisig'), pk(multisig), enc.encode('vault'), Uint8Array.of(index)],
    programId,
  )[0];
}

export function spendingLimitPda(
  multisig: string,
  createKey: string,
  programId = SQUADS_PROGRAM_ID,
): string {
  return findProgramAddress(
    [enc.encode('multisig'), pk(multisig), enc.encode('spending_limit'), pk(createKey)],
    programId,
  )[0];
}

export function decodeSpendingLimit(data: Uint8Array): SpendingLimitAccount {
  if (data.length < 131 || !SPENDING_LIMIT_DISCRIMINATOR.every((b, i) => data[i] === b))
    throw new Error('not a Squads SpendingLimit account');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const key = () => {
    const out = bs58.encode(data.slice(o, o + 32));
    o += 32;
    return out;
  };
  const multisig = key();
  const createKey = key();
  const vaultIndex = data[o++]!;
  const mint = key();
  const amount = view.getBigUint64(o, true);
  o += 8;
  const period = PERIODS[data[o++]!];
  if (!period) throw new Error('unknown spending limit period');
  const remainingAmount = view.getBigUint64(o, true);
  o += 8;
  const lastReset = view.getBigInt64(o, true);
  o += 8;
  const bump = data[o++]!;
  const list = () => {
    const n = view.getUint32(o, true);
    o += 4;
    if (n > 64 || o + n * 32 > data.length) throw new Error('corrupt spending limit list');
    return Array.from({ length: n }, key);
  };
  const members = list();
  const destinations = list();
  return {
    multisig,
    createKey,
    vaultIndex,
    mint,
    amount,
    period,
    remainingAmount,
    lastReset,
    bump,
    members,
    destinations,
  };
}

/** Test helper: the exact on-chain layout (Anchor/borsh) of a SpendingLimit account. */
export function encodeSpendingLimitForTest(a: SpendingLimitAccount): Uint8Array {
  const out = new Uint8Array(
    8 + 32 + 32 + 1 + 32 + 8 + 1 + 8 + 8 + 1 + 8 + 32 * (a.members.length + a.destinations.length),
  );
  const view = new DataView(out.buffer);
  let o = 0;
  out.set(SPENDING_LIMIT_DISCRIMINATOR, 0);
  o = 8;
  const put = (k: string) => {
    out.set(pk(k), o);
    o += 32;
  };
  put(a.multisig);
  put(a.createKey);
  out[o++] = a.vaultIndex;
  put(a.mint);
  view.setBigUint64(o, a.amount, true);
  o += 8;
  out[o++] = PERIODS.indexOf(a.period);
  view.setBigUint64(o, a.remainingAmount, true);
  o += 8;
  view.setBigInt64(o, a.lastReset, true);
  o += 8;
  out[o++] = a.bump;
  for (const list of [a.members, a.destinations]) {
    view.setUint32(o, list.length, true);
    o += 4;
    list.forEach(put);
  }
  return out;
}

/**
 * Remaining allowance as the program will compute it on the next use: Squads resets
 * `remainingAmount` lazily once a full period has passed since `lastReset`.
 */
export function effectiveRemaining(limit: SpendingLimitAccount, nowSeconds: number): bigint {
  const period = PERIOD_SECONDS[limit.period];
  if (Number.isFinite(period) && nowSeconds - Number(limit.lastReset) >= period)
    return limit.amount;
  return limit.remainingAmount;
}

/** spending_limit_use for native SOL: `vault` → `destination`, signed by a listed member. */
export function spendingLimitUseSolIx(input: {
  multisig: string;
  member: string;
  spendingLimit: string;
  vault: string;
  destination: string;
  lamports: bigint;
  memo?: string;
  programId?: string;
}): Instruction {
  const programId = input.programId ?? SQUADS_PROGRAM_ID;
  if (input.lamports <= 0n) throw new Error('spending limit use needs a positive amount');
  const memo = input.memo ? enc.encode(input.memo) : null;
  const data = new Uint8Array(8 + 8 + 1 + 1 + (memo ? 4 + memo.length : 0));
  const view = new DataView(data.buffer);
  data.set(SPENDING_LIMIT_USE, 0);
  view.setBigUint64(8, input.lamports, true);
  data[16] = 9; // decimals: SOL
  data[17] = memo ? 1 : 0;
  if (memo) {
    view.setUint32(18, memo.length, true);
    data.set(memo, 22);
  }
  // Optional Anchor accounts that are absent are passed as the program id itself.
  return {
    programId,
    keys: [
      { pubkey: input.multisig, isSigner: false, isWritable: false },
      { pubkey: input.member, isSigner: true, isWritable: false },
      { pubkey: input.spendingLimit, isSigner: false, isWritable: true },
      { pubkey: input.vault, isSigner: false, isWritable: true },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
    data,
  };
}
