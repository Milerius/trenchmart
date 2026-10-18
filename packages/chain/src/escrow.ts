import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';

/**
 * Client for the trench_escrow Anchor program (programs/trench_escrow).
 * Encodes the instructions the API needs and decodes the Escrow account, with no
 * dependency on @solana/web3.js (the Worker bundle stays small).
 */

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

/**
 * Explicit resource limits. Phantom asks dApps to set the compute unit and loaded account
 * data limits so its simulation can predict the transaction, and a tight CU limit keeps the
 * priority fee tiny. https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings
 */
export type ComputeBudget = {
  units: number;
  microLamportsPerUnit: bigint;
  loadedAccountsDataBytes: number;
};

export function computeBudgetIxs(budget: ComputeBudget): Instruction[] {
  const u32 = (tag: number, value: number) => {
    const data = new Uint8Array(5);
    data[0] = tag;
    new DataView(data.buffer).setUint32(1, value, true);
    return data;
  };
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, budget.microLamportsPerUnit, true);
  return [
    { programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: u32(2, budget.units) },
    { programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: price },
    {
      programId: COMPUTE_BUDGET_PROGRAM_ID,
      keys: [],
      data: u32(4, budget.loadedAccountsDataBytes),
    },
  ];
}

/** checkout uses ~37k CU and loads ~260 KB (escrow program + memo program); dispute far less. */
export const ESCROW_BUDGET: ComputeBudget = {
  units: 80_000,
  microLamportsPerUnit: 1_000n,
  loadedAccountsDataBytes: 512 * 1024,
};
/** A system transfer plus a memo: ~20k CU, ~75 KB (the memo program). */
export const TRANSFER_BUDGET: ComputeBudget = {
  units: 40_000,
  microLamportsPerUnit: 1_000n,
  loadedAccountsDataBytes: 256 * 1024,
};

export type EscrowStatusName =
  'pending' | 'paid' | 'released' | 'refunded' | 'disputed' | 'expired';
export const ESCROW_STATUSES: EscrowStatusName[] = [
  'pending',
  'paid',
  'released',
  'refunded',
  'disputed',
  'expired',
];

export type EscrowInitArgs = {
  seller: string;
  resolver: string;
  buyback: string;
  aiVerification: string;
  ops: string;
  safety: string;
  price: bigint;
  feeBps: number;
  rebateBps: number;
  splitBuybackBps: number;
  splitAiBps: number;
  splitOpsBps: number;
  splitSafetyBps: number;
  expiresAt: bigint;
  escrowUntil: bigint;
};

export type EscrowAccount = Omit<EscrowInitArgs, 'expiresAt' | 'escrowUntil'> & {
  buyer: string;
  status: EscrowStatusName;
  disputedFrom: EscrowStatusName;
  deposit: bigint;
  expiresAt: bigint;
  escrowUntil: bigint;
  bump: number;
  orderId: Uint8Array;
};

export type AccountMeta = { pubkey: string; isSigner: boolean; isWritable: boolean };
export type Instruction = { programId: string; keys: AccountMeta[]; data: Uint8Array };

function discriminator(preimage: string): Uint8Array {
  return sha256(new TextEncoder().encode(preimage)).slice(0, 8);
}

export const ESCROW_ACCOUNT_DISCRIMINATOR = discriminator('account:Escrow');
const ESCROW_ACCOUNT_SIZE = 8 + 32 * 7 + 1 + 1 + 8 + 8 + 2 * 6 + 8 + 8 + 1 + 16;

function key(value: string): Uint8Array {
  const raw = bs58.decode(value);
  if (raw.length !== 32) throw new Error(`not a pubkey: ${value}`);
  return raw;
}

export function isOnCurve(pubkey: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(pubkey);
    return true;
  } catch {
    return false;
  }
}

export function findProgramAddress(seeds: Uint8Array[], programId: string): [string, number] {
  const program = key(programId);
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump -= 1) {
    const parts = [...seeds, Uint8Array.of(bump), program, marker];
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      buffer.set(part, offset);
      offset += part.length;
    }
    const hash = sha256(buffer);
    if (!isOnCurve(hash)) return [bs58.encode(hash), bump];
  }
  throw new Error('no viable program address');
}

/** The 16 raw bytes of an order UUID, used as the escrow PDA seed. */
export function orderIdBytes(orderId: string): Uint8Array {
  const hex = orderId.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('order id must be a uuid');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Escrow PDA. v2 (program upgrade for L-02) seeds `["escrow", buyer, order_id]`; v1 used
 * `["escrow", order_id]`. Pass `buyer` for v2; omit it only for legacy v1 escrows.
 */
export function escrowAddress(orderId: string, programId: string, buyer?: string): string {
  const seeds: Uint8Array[] = [new TextEncoder().encode('escrow')];
  if (buyer) seeds.push(key(buyer));
  seeds.push(orderIdBytes(orderId));
  return findProgramAddress(seeds, programId)[0];
}

/** v2 program config PDA (`["config"]`): holds the rotatable dispute resolver. */
export function configAddress(programId: string): string {
  return findProgramAddress([new TextEncoder().encode('config')], programId)[0];
}

class Writer {
  private parts: Uint8Array[] = [];
  bytes(value: Uint8Array): this {
    this.parts.push(value);
    return this;
  }
  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff)
      throw new Error('u16 out of range');
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, true);
    return this.bytes(out);
  }
  u64(value: bigint): this {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error('u64 out of range');
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value, true);
    return this.bytes(out);
  }
  i64(value: bigint): this {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigInt64(0, value, true);
    return this.bytes(out);
  }
  done(): Uint8Array {
    const size = this.parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

export function initializeIx(input: {
  programId: string;
  buyer: string;
  orderId: string;
  args: EscrowInitArgs;
  /** Program version: 2 derives the PDA with the buyer in the seeds. */
  version?: 1 | 2;
}): Instruction {
  const a = input.args;
  const data = new Writer()
    .bytes(discriminator('global:initialize'))
    .bytes(orderIdBytes(input.orderId))
    .bytes(key(a.seller))
    .bytes(key(a.resolver))
    .bytes(key(a.buyback))
    .bytes(key(a.aiVerification))
    .bytes(key(a.ops))
    .bytes(key(a.safety))
    .u64(a.price)
    .u16(a.feeBps)
    .u16(a.rebateBps)
    .u16(a.splitBuybackBps)
    .u16(a.splitAiBps)
    .u16(a.splitOpsBps)
    .u16(a.splitSafetyBps)
    .i64(a.expiresAt)
    .i64(a.escrowUntil)
    .done();
  return {
    programId: input.programId,
    keys: [
      { pubkey: input.buyer, isSigner: true, isWritable: true },
      {
        pubkey: escrowAddress(
          input.orderId,
          input.programId,
          input.version === 2 ? input.buyer : undefined,
        ),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  };
}

export function fundIx(input: { programId: string; buyer: string; escrow: string }): Instruction {
  return {
    programId: input.programId,
    keys: [
      { pubkey: input.buyer, isSigner: true, isWritable: true },
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator('global:fund'),
  };
}

export function releaseIx(input: {
  programId: string;
  escrow: string;
  seller: string;
  buyback: string;
  aiVerification: string;
  ops: string;
  safety: string;
}): Instruction {
  const w = (pubkey: string) => ({ pubkey, isSigner: false, isWritable: true });
  return {
    programId: input.programId,
    keys: [
      w(input.escrow),
      w(input.seller),
      w(input.buyback),
      w(input.aiVerification),
      w(input.ops),
      w(input.safety),
    ],
    data: discriminator('global:release'),
  };
}

/**
 * v1: signed by the buyer. v2: signed by the buyer or by the config resolver (M-01), and
 * the config account sits between the signer and the escrow.
 */
export function openDisputeIx(input: {
  programId: string;
  buyer: string;
  escrow: string;
  version?: 1 | 2;
}): Instruction {
  const keys: AccountMeta[] = [{ pubkey: input.buyer, isSigner: true, isWritable: false }];
  if (input.version === 2)
    keys.push({ pubkey: configAddress(input.programId), isSigner: false, isWritable: false });
  keys.push({ pubkey: input.escrow, isSigner: false, isWritable: true });
  return { programId: input.programId, keys, data: discriminator('global:open_dispute') };
}

/** v2: return a timed-out dispute's deposit to the buyer. Permissionless. */
export function refundAfterTimeoutIx(input: {
  programId: string;
  escrow: string;
  buyer: string;
}): Instruction {
  return {
    programId: input.programId,
    keys: [
      { pubkey: configAddress(input.programId), isSigner: false, isWritable: false },
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.buyer, isSigner: false, isWritable: true },
    ],
    data: discriminator('global:refund_after_timeout'),
  };
}

/** v2: close a terminal escrow; rent goes back to the buyer (L-01). Permissionless. */
export function closeIx(input: { programId: string; escrow: string; buyer: string }): Instruction {
  return {
    programId: input.programId,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.buyer, isSigner: false, isWritable: true },
    ],
    data: discriminator('global:close'),
  };
}

export function refundIx(input: {
  programId: string;
  resolver: string;
  escrow: string;
  buyer: string;
  version?: 1 | 2;
}): Instruction {
  return {
    programId: input.programId,
    keys: [
      { pubkey: input.resolver, isSigner: true, isWritable: false },
      ...configMeta(input),
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.buyer, isSigner: false, isWritable: true },
    ],
    data: discriminator('global:refund'),
  };
}

export function rejectDisputeIx(input: {
  programId: string;
  resolver: string;
  escrow: string;
  version?: 1 | 2;
}): Instruction {
  return {
    programId: input.programId,
    keys: [
      { pubkey: input.resolver, isSigner: true, isWritable: false },
      ...configMeta(input),
      { pubkey: input.escrow, isSigner: false, isWritable: true },
    ],
    data: discriminator('global:reject_dispute'),
  };
}

function configMeta(input: { programId: string; version?: 1 | 2 }): AccountMeta[] {
  return input.version === 2
    ? [{ pubkey: configAddress(input.programId), isSigner: false, isWritable: false }]
    : [];
}

export function memoIx(memo: string, signer: string): Instruction {
  return {
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: new TextEncoder().encode(memo),
  };
}

function compactU16(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

/** Compiles an unsigned legacy transaction. The fee payer is always the first signer. */
export function compileLegacyTx(input: {
  feePayer: string;
  instructions: Instruction[];
  recentBlockhash: string;
}): Uint8Array {
  type Entry = { pubkey: string; isSigner: boolean; isWritable: boolean };
  const metas = new Map<string, Entry>();
  const touch = (pubkey: string, isSigner: boolean, isWritable: boolean) => {
    key(pubkey);
    const prior = metas.get(pubkey);
    if (prior) {
      prior.isSigner ||= isSigner;
      prior.isWritable ||= isWritable;
    } else metas.set(pubkey, { pubkey, isSigner, isWritable });
  };
  touch(input.feePayer, true, true);
  for (const ix of input.instructions) {
    for (const meta of ix.keys) touch(meta.pubkey, meta.isSigner, meta.isWritable);
    touch(ix.programId, false, false);
  }
  const payer = metas.get(input.feePayer)!;
  const rest = [...metas.values()].filter((entry) => entry.pubkey !== input.feePayer);
  const rank = (e: Entry) => (e.isSigner ? (e.isWritable ? 0 : 1) : e.isWritable ? 2 : 3);
  // Stable sort keeps first-seen order inside each class, like web3.js.
  const ordered = [
    payer,
    ...rest
      .map((e, i) => ({ e, i }))
      .sort((x, y) => rank(x.e) - rank(y.e) || x.i - y.i)
      .map((x) => x.e),
  ];
  const signers = ordered.filter((e) => e.isSigner).length;
  const readonlySigned = ordered.filter((e) => e.isSigner && !e.isWritable).length;
  const readonlyUnsigned = ordered.filter((e) => !e.isSigner && !e.isWritable).length;
  const index = new Map(ordered.map((e, i) => [e.pubkey, i]));
  const blockhash = bs58.decode(input.recentBlockhash);
  if (blockhash.length !== 32) throw new Error('recentBlockhash must be 32 bytes');
  const bytes: number[] = [
    signers,
    readonlySigned,
    readonlyUnsigned,
    ...compactU16(ordered.length),
  ];
  for (const entry of ordered) bytes.push(...key(entry.pubkey));
  bytes.push(...blockhash, ...compactU16(input.instructions.length));
  for (const ix of input.instructions) {
    bytes.push(index.get(ix.programId)!, ...compactU16(ix.keys.length));
    for (const meta of ix.keys) bytes.push(index.get(meta.pubkey)!);
    bytes.push(...compactU16(ix.data.length), ...ix.data);
  }
  const message = Uint8Array.from(bytes);
  const out = new Uint8Array(compactU16(signers).length + signers * 64 + message.length);
  out.set(compactU16(signers), 0);
  out.set(message, compactU16(signers).length + signers * 64);
  return out;
}

/** Signs every signer slot that belongs to one of `keys` (64-byte ed25519 secret keys). */
export function signTx(tx: Uint8Array, keys: Uint8Array[]): Uint8Array {
  let count = 0;
  let shift = 0;
  let cursor = 0;
  for (;;) {
    const byte = tx[cursor++]!;
    count |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  const sigStart = cursor;
  const message = tx.slice(sigStart + count * 64);
  // Message: 3 header bytes, compact key count, keys.
  let m = 3;
  let keyCount = 0;
  shift = 0;
  for (;;) {
    const byte = message[m++]!;
    keyCount |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  void keyCount;
  const out = new Uint8Array(tx);
  for (const secret of keys) {
    const pub = secret.slice(32, 64);
    for (let i = 0; i < count; i += 1) {
      const slot = message.slice(m + i * 32, m + i * 32 + 32);
      if (slot.every((byte, j) => byte === pub[j])) {
        out.set(nacl.sign.detached(message, secret), sigStart + i * 64);
      }
    }
  }
  return out;
}

class Reader {
  offset = 0;
  constructor(private readonly data: Uint8Array) {}
  take(size: number): Uint8Array {
    if (this.offset + size > this.data.length) throw new Error('escrow account is truncated');
    const out = this.data.slice(this.offset, this.offset + size);
    this.offset += size;
    return out;
  }
  pubkey(): string {
    return bs58.encode(this.take(32));
  }
  u8(): number {
    return this.take(1)[0]!;
  }
  u16(): number {
    const b = this.take(2);
    return new DataView(b.buffer, b.byteOffset, 2).getUint16(0, true);
  }
  u64(): bigint {
    const b = this.take(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
  }
  i64(): bigint {
    const b = this.take(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true);
  }
}

function statusAt(value: number): EscrowStatusName {
  const name = ESCROW_STATUSES[value];
  if (!name) throw new Error(`unknown escrow status ${value}`);
  return name;
}

export function decodeEscrow(data: Uint8Array): EscrowAccount {
  if (data.length < ESCROW_ACCOUNT_SIZE) throw new Error('escrow account is truncated');
  const disc = data.slice(0, 8);
  if (!disc.every((byte, i) => byte === ESCROW_ACCOUNT_DISCRIMINATOR[i])) {
    throw new Error('not an Escrow account');
  }
  const r = new Reader(data);
  r.take(8);
  return {
    buyer: r.pubkey(),
    seller: r.pubkey(),
    resolver: r.pubkey(),
    buyback: r.pubkey(),
    aiVerification: r.pubkey(),
    ops: r.pubkey(),
    safety: r.pubkey(),
    status: statusAt(r.u8()),
    disputedFrom: statusAt(r.u8()),
    price: r.u64(),
    deposit: r.u64(),
    feeBps: r.u16(),
    rebateBps: r.u16(),
    splitBuybackBps: r.u16(),
    splitAiBps: r.u16(),
    splitOpsBps: r.u16(),
    splitSafetyBps: r.u16(),
    expiresAt: r.i64(),
    escrowUntil: r.i64(),
    bump: r.u8(),
    orderId: r.take(16),
  };
}

/** Test helper: the bytes the program would store for this escrow. */
export function encodeEscrowForTest(account: EscrowAccount): Uint8Array {
  const status = (name: EscrowStatusName) => ESCROW_STATUSES.indexOf(name);
  return new Writer()
    .bytes(ESCROW_ACCOUNT_DISCRIMINATOR)
    .bytes(key(account.buyer))
    .bytes(key(account.seller))
    .bytes(key(account.resolver))
    .bytes(key(account.buyback))
    .bytes(key(account.aiVerification))
    .bytes(key(account.ops))
    .bytes(key(account.safety))
    .bytes(Uint8Array.of(status(account.status), status(account.disputedFrom)))
    .u64(account.price)
    .u64(account.deposit)
    .u16(account.feeBps)
    .u16(account.rebateBps)
    .u16(account.splitBuybackBps)
    .u16(account.splitAiBps)
    .u16(account.splitOpsBps)
    .u16(account.splitSafetyBps)
    .i64(account.expiresAt)
    .i64(account.escrowUntil)
    .bytes(Uint8Array.of(account.bump))
    .bytes(account.orderId)
    .done();
}

/** Accepts a solana-keygen JSON array or a base58 64-byte secret key. */
export function parseSecretKey(value: string): Uint8Array {
  const trimmed = value.trim();
  const bytes = trimmed.startsWith('[')
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : bs58.decode(trimmed);
  if (bytes.length !== 64) throw new Error('secret key must be 64 bytes');
  const derived = nacl.sign.keyPair.fromSeed(bytes.slice(0, 32));
  if (!derived.publicKey.every((byte, i) => byte === bytes[32 + i])) {
    throw new Error('secret key does not match its public half');
  }
  return bytes;
}

export function publicKeyOf(secret: Uint8Array): string {
  return bs58.encode(secret.slice(32, 64));
}
