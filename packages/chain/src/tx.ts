import bs58 from 'bs58';
import nacl from 'tweetnacl';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export type CompiledTransfer = {
  source: string;
  destination: string;
  lamports: bigint;
};

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compactU16(value: number): Uint8Array {
  const out: number[] = [];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
  return Uint8Array.from(out);
}

function readCompact(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    const byte = bytes[cursor];
    if (byte === undefined) throw new Error('truncated compact-u16');
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, next: cursor };
}

function pushKey(keys: Uint8Array[], encoded: string): number {
  const raw = bs58.decode(encoded);
  if (raw.length !== 32) throw new Error(`not a pubkey: ${encoded}`);
  const index = keys.findIndex((key) => key.every((byte, i) => byte === raw[i]));
  if (index >= 0) return index;
  keys.push(raw);
  return keys.length - 1;
}

type Ix = { programIdIndex: number; accounts: number[]; data: Uint8Array };

function encodeMessage(input: {
  signers: number;
  readonlySigned: number;
  readonlyUnsigned: number;
  keys: Uint8Array[];
  blockhash: Uint8Array;
  ixs: Ix[];
}): Uint8Array {
  const parts: Uint8Array[] = [
    Uint8Array.from([input.signers, input.readonlySigned, input.readonlyUnsigned]),
    compactU16(input.keys.length),
  ];
  for (const key of input.keys) parts.push(key);
  parts.push(input.blockhash, compactU16(input.ixs.length));
  for (const ix of input.ixs) {
    parts.push(
      Uint8Array.from([ix.programIdIndex]),
      compactU16(ix.accounts.length),
      Uint8Array.from(ix.accounts),
    );
    parts.push(compactU16(ix.data.length), ix.data);
  }
  return concat(parts);
}

function unsigned(message: Uint8Array, signers: number): Uint8Array {
  return concat([compactU16(signers), new Uint8Array(signers * 64), message]);
}

function transferData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return data;
}

export function compileUnsignedTransferMemo(input: {
  from: string;
  to: string;
  lamports: bigint;
  memo: string;
  recentBlockhash: string;
}): Uint8Array {
  const keys: Uint8Array[] = [];
  const from = pushKey(keys, input.from);
  const to = pushKey(keys, input.to);
  const system = pushKey(keys, SYSTEM_PROGRAM);
  const memoProgram = pushKey(keys, MEMO_PROGRAM);
  const blockhash = bs58.decode(input.recentBlockhash);
  if (blockhash.length !== 32) throw new Error('recentBlockhash must be 32 bytes');
  const message = encodeMessage({
    signers: 1,
    readonlySigned: 0,
    readonlyUnsigned: 2,
    keys,
    blockhash,
    ixs: [
      { programIdIndex: system, accounts: [from, to], data: transferData(input.lamports) },
      { programIdIndex: memoProgram, accounts: [from], data: new TextEncoder().encode(input.memo) },
    ],
  });
  return unsigned(message, 1);
}

export function compilePayoutBatch(input: {
  from: string;
  transfers: { to: string; lamports: bigint }[];
  recentBlockhash: string;
  memo?: string;
}): Uint8Array {
  if (input.transfers.length === 0 || input.transfers.length > 15) {
    throw new Error('a payout batch contains 1 to 15 transfers');
  }
  const keys: Uint8Array[] = [];
  const from = pushKey(keys, input.from);
  const ixs: Ix[] = input.transfers.map((transfer) => ({
    programIdIndex: -1,
    accounts: [from, pushKey(keys, transfer.to)],
    data: transferData(transfer.lamports),
  }));
  const system = pushKey(keys, SYSTEM_PROGRAM);
  for (const ix of ixs) ix.programIdIndex = system;
  let readonlyUnsigned = 1;
  if (input.memo) {
    const memoProgram = pushKey(keys, MEMO_PROGRAM);
    ixs.push({
      programIdIndex: memoProgram,
      accounts: [from],
      data: new TextEncoder().encode(input.memo),
    });
    readonlyUnsigned = 2;
  }
  const blockhash = bs58.decode(input.recentBlockhash);
  if (blockhash.length !== 32) throw new Error('recentBlockhash must be 32 bytes');
  const message = encodeMessage({
    signers: 1,
    readonlySigned: 0,
    readonlyUnsigned,
    keys,
    blockhash,
    ixs,
  });
  return unsigned(message, 1);
}

export function messageBytes(tx: Uint8Array): Uint8Array {
  const count = readCompact(tx, 0);
  return tx.slice(count.next + count.value * 64);
}

export function signLegacyTransaction(tx: Uint8Array, secretKey: Uint8Array): Uint8Array {
  const count = readCompact(tx, 0);
  const message = tx.slice(count.next + count.value * 64);
  const signature = nacl.sign.detached(message, secretKey);
  const out = new Uint8Array(tx);
  out.set(signature, count.next);
  return out;
}

export function signatureOf(tx: Uint8Array): string {
  const count = readCompact(tx, 0);
  return bs58.encode(tx.slice(count.next, count.next + 64));
}

export function decodeTransfersAndMemos(tx: Uint8Array): {
  transfers: CompiledTransfer[];
  memos: string[];
} {
  const message = messageBytes(tx);
  let cursor = 0;
  const signers = message[cursor];
  const readonlySigned = message[cursor + 1];
  const readonlyUnsigned = message[cursor + 2];
  if (signers === undefined || readonlySigned === undefined || readonlyUnsigned === undefined) {
    throw new Error('truncated message header');
  }
  cursor += 3;
  const keyCount = readCompact(message, cursor);
  cursor = keyCount.next;
  const keys: string[] = [];
  for (let i = 0; i < keyCount.value; i += 1) {
    const key = message.slice(cursor, cursor + 32);
    keys.push(bs58.encode(key));
    cursor += 32;
  }
  cursor += 32;
  const ixCount = readCompact(message, cursor);
  cursor = ixCount.next;
  const transfers: CompiledTransfer[] = [];
  const memos: string[] = [];
  for (let i = 0; i < ixCount.value; i += 1) {
    const program = keys[message[cursor] ?? -1];
    cursor += 1;
    const accounts = readCompact(message, cursor);
    cursor = accounts.next;
    const accountIdx: number[] = [];
    for (let a = 0; a < accounts.value; a += 1) {
      accountIdx.push(message[cursor] ?? -1);
      cursor += 1;
    }
    const dataLen = readCompact(message, cursor);
    cursor = dataLen.next;
    const data = message.slice(cursor, cursor + dataLen.value);
    cursor += dataLen.value;
    if (program === SYSTEM_PROGRAM && data.length >= 12) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (view.getUint32(0, true) === 2) {
        const source = keys[accountIdx[0] ?? -1];
        const destination = keys[accountIdx[1] ?? -1];
        if (source && destination) {
          transfers.push({ source, destination, lamports: view.getBigUint64(4, true) });
        }
      }
    }
    if (program === MEMO_PROGRAM) memos.push(new TextDecoder().decode(data));
  }
  return { transfers, memos };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomKeypair(): { publicKey: string; secretKey: Uint8Array } {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}
