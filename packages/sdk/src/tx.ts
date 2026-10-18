import bs58 from 'bs58';
import { COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, SYSTEM_PROGRAM } from './constants.js';
import { UnsafeTransactionError } from './errors.js';

export type Instruction = { programId: string; accounts: string[]; data: Uint8Array };
export type ParsedTx = {
  signatureCount: number;
  signatureOffset: number;
  message: Uint8Array;
  numRequiredSignatures: number;
  accountKeys: string[];
  recentBlockhash: string;
  instructions: Instruction[];
};

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function compact(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    const byte = bytes[cursor];
    if (byte === undefined) throw new UnsafeTransactionError('truncated transaction');
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, next: cursor };
}

/** Parses a serialized legacy transaction (the only kind the API issues). */
export function parseTransaction(tx: Uint8Array): ParsedTx {
  const sigs = compact(tx, 0);
  const message = tx.slice(sigs.next + sigs.value * 64);
  const numRequiredSignatures = message[0] ?? 0;
  if (numRequiredSignatures & 0x80) throw new UnsafeTransactionError('versioned transaction');
  let cursor = 3;
  const keyCount = compact(message, cursor);
  cursor = keyCount.next;
  const accountKeys: string[] = [];
  for (let i = 0; i < keyCount.value; i += 1) {
    accountKeys.push(bs58.encode(message.slice(cursor, cursor + 32)));
    cursor += 32;
  }
  const recentBlockhash = bs58.encode(message.slice(cursor, cursor + 32));
  cursor += 32;
  const ixCount = compact(message, cursor);
  cursor = ixCount.next;
  const instructions: Instruction[] = [];
  for (let i = 0; i < ixCount.value; i += 1) {
    const programId = accountKeys[message[cursor] ?? 255];
    if (!programId) throw new UnsafeTransactionError('bad program index');
    cursor += 1;
    const accounts = compact(message, cursor);
    cursor = accounts.next;
    const keys: string[] = [];
    for (let a = 0; a < accounts.value; a += 1) {
      const key = accountKeys[message[cursor] ?? 255];
      if (!key) throw new UnsafeTransactionError('bad account index');
      keys.push(key);
      cursor += 1;
    }
    const len = compact(message, cursor);
    cursor = len.next;
    instructions.push({ programId, accounts: keys, data: message.slice(cursor, cursor + len.value) });
    cursor += len.value;
  }
  if (cursor !== message.length) throw new UnsafeTransactionError('trailing bytes');
  return {
    signatureCount: sigs.value,
    signatureOffset: sigs.next,
    message,
    numRequiredSignatures,
    accountKeys,
    recentBlockhash,
    instructions,
  };
}

/** Writes `signature` into the signer slot of `signer` and returns the new bytes. */
export function attachSignature(tx: Uint8Array, signer: string, signature: Uint8Array): Uint8Array {
  const parsed = parseTransaction(tx);
  const slot = parsed.accountKeys.slice(0, parsed.numRequiredSignatures).indexOf(signer);
  if (slot < 0) throw new UnsafeTransactionError('wallet is not a signer of this transaction');
  const out = new Uint8Array(tx);
  out.set(signature, parsed.signatureOffset + slot * 64);
  return out;
}

const u16 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset).getUint16(o, true);
const u64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset).getBigUint64(o, true);
const i64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset).getBigInt64(o, true);

export type CheckoutTerms = {
  seller: string;
  price: bigint;
  feeBps: number;
  rebateBps: number;
  total: bigint;
  expiresAt: number;
  escrowUntil: number;
};

/**
 * Checks an unsigned checkout transaction before the agent signs it: one signer (the
 * buyer, as fee payer), top-level instructions only to the compute-budget, escrow and memo
 * programs, exactly one initialize and one fund, and escrow terms whose total is what the
 * agent agreed to pay. Throws UnsafeTransactionError otherwise.
 */
export function inspectCheckout(
  txBase64: string,
  expect: { buyer: string; escrowProgramId: string; total: bigint | string; seller?: string },
): CheckoutTerms {
  const parsed = parseTransaction(fromBase64(txBase64));
  if (parsed.numRequiredSignatures !== 1 || parsed.accountKeys[0] !== expect.buyer)
    throw new UnsafeTransactionError('the buyer must be the only signer and fee payer');
  const allowed = new Set([COMPUTE_BUDGET_PROGRAM, expect.escrowProgramId, MEMO_PROGRAM]);
  for (const ix of parsed.instructions)
    if (!allowed.has(ix.programId))
      throw new UnsafeTransactionError(`unexpected program ${ix.programId}`);
  const escrowIxs = parsed.instructions.filter((ix) => ix.programId === expect.escrowProgramId);
  if (escrowIxs.length !== 2) throw new UnsafeTransactionError('expected initialize + fund');
  const init = escrowIxs[0]!;
  if (init.data.length !== 8 + 16 + 32 * 6 + 8 + 2 * 6 + 8 * 2)
    throw new UnsafeTransactionError('unexpected initialize layout');
  const base = 8 + 16;
  const seller = bs58.encode(init.data.slice(base, base + 32));
  const at = base + 32 * 6;
  const price = u64(init.data, at);
  const feeBps = u16(init.data, at + 8);
  const rebateBps = u16(init.data, at + 10);
  const expiresAt = Number(i64(init.data, at + 20));
  const escrowUntil = Number(i64(init.data, at + 28));
  const fee = (price * BigInt(feeBps)) / 10_000n;
  const total = price + fee - (fee * BigInt(rebateBps)) / 10_000n;
  if (total !== BigInt(expect.total))
    throw new UnsafeTransactionError(`escrow total ${total} differs from the quoted ${expect.total}`);
  if (expect.seller && seller !== expect.seller)
    throw new UnsafeTransactionError('escrow seller differs from the listing creator');
  if (init.accounts[0] !== expect.buyer || escrowIxs[1]!.accounts[0] !== expect.buyer)
    throw new UnsafeTransactionError('escrow buyer is not this wallet');
  return { seller, price, feeBps, rebateBps, total, expiresAt, escrowUntil };
}

/**
 * Checks an unsigned vault payment (bond, verification fee, supplement, renewal): the
 * wallet signs alone and pays exactly `lamports` to `vault` in one system transfer.
 */
export function inspectVaultPayment(
  txBase64: string,
  expect: { payer: string; vault: string; lamports: bigint | string },
): void {
  const parsed = parseTransaction(fromBase64(txBase64));
  if (parsed.numRequiredSignatures !== 1 || parsed.accountKeys[0] !== expect.payer)
    throw new UnsafeTransactionError('the wallet must be the only signer and fee payer');
  let paid = 0n;
  for (const ix of parsed.instructions) {
    if (ix.programId === COMPUTE_BUDGET_PROGRAM || ix.programId === MEMO_PROGRAM) continue;
    if (ix.programId !== SYSTEM_PROGRAM)
      throw new UnsafeTransactionError(`unexpected program ${ix.programId}`);
    const kind = ix.data.length >= 12 ? new DataView(ix.data.buffer, ix.data.byteOffset).getUint32(0, true) : -1;
    if (kind !== 2 || ix.accounts[0] !== expect.payer || ix.accounts[1] !== expect.vault)
      throw new UnsafeTransactionError('unexpected system instruction');
    paid += u64(ix.data, 4);
  }
  if (paid !== BigInt(expect.lamports))
    throw new UnsafeTransactionError(`pays ${paid} lamports, expected ${expect.lamports}`);
}
