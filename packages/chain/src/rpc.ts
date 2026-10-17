import { assertSafeRpc } from '@trenchmart/shared';
import { fromBase64, toBase64 } from './tx';

export type RpcTransfer = { source: string; destination: string; lamports: bigint };
export type ChainTx = {
  signature: string;
  err: unknown;
  blockTime: number | null;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  transfers: RpcTransfer[];
  memos: string[];
};

type RpcResponse = { result?: unknown; error?: { message?: string } };

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  assertSafeRpc(url);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as RpcResponse;
  if (body.error) throw new Error(body.error.message ?? method);
  return body.result;
}

export async function latestBlockhash(
  url: string,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = (await rpc(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }])) as {
    value: { blockhash: string; lastValidBlockHeight: number };
  };
  return result.value;
}

export async function sendRaw(url: string, tx: Uint8Array): Promise<string> {
  const signature = (await rpc(url, 'sendTransaction', [
    toBase64(tx),
    { encoding: 'base64', preflightCommitment: 'confirmed' },
  ])) as string;
  return signature;
}

export async function requestAirdrop(
  url: string,
  pubkey: string,
  lamports: number,
): Promise<string> {
  return (await rpc(url, 'requestAirdrop', [pubkey, lamports])) as string;
}

export async function balance(url: string, pubkey: string): Promise<bigint> {
  const result = (await rpc(url, 'getBalance', [pubkey, { commitment: 'confirmed' }])) as {
    value: number;
  };
  return BigInt(result.value);
}

export async function signatureStatus(
  url: string,
  signature: string,
): Promise<'processed' | 'confirmed' | 'finalized' | null> {
  const result = (await rpc(url, 'getSignatureStatuses', [
    [signature],
    { searchTransactionHistory: true },
  ])) as {
    value: Array<{
      confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
      err: unknown;
    } | null>;
  };
  return result.value[0]?.confirmationStatus ?? null;
}

export async function confirm(
  url: string,
  signature: string,
  want: 'confirmed' | 'finalized',
  attempts = 40,
): Promise<void> {
  const rank = { processed: 1, confirmed: 2, finalized: 3 };
  for (let i = 0; i < attempts; i += 1) {
    const status = await signatureStatus(url, signature);
    if (status && rank[status] >= rank[want]) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`transaction ${signature} was not ${want}`);
}

type ParsedIx = {
  program?: string;
  programId?: string;
  parsed?:
    { type?: string; info?: { source?: string; destination?: string; lamports?: number } } | string;
};

function collect(ix: ParsedIx, transfers: RpcTransfer[], memos: string[]): void {
  if (
    ix.program === 'system' &&
    ix.parsed &&
    typeof ix.parsed === 'object' &&
    ix.parsed.type === 'transfer'
  ) {
    const info = ix.parsed.info;
    if (info?.source && info.destination && info.lamports !== undefined) {
      transfers.push({
        source: info.source,
        destination: info.destination,
        lamports: BigInt(info.lamports),
      });
    }
  }
  if (ix.program === 'spl-memo' || ix.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
    if (typeof ix.parsed === 'string') memos.push(ix.parsed);
  }
}

export function parseRpcTransaction(
  signature: string,
  tx: Record<string, unknown> | null,
): ChainTx | null {
  if (!tx) return null;
  const meta = tx.meta as {
    err?: unknown;
    innerInstructions?: Array<{ instructions?: ParsedIx[] }>;
  } | null;
  const message = (tx.transaction as { message?: { instructions?: ParsedIx[] } } | undefined)
    ?.message;
  const transfers: RpcTransfer[] = [];
  const memos: string[] = [];
  for (const ix of message?.instructions ?? []) collect(ix, transfers, memos);
  for (const inner of meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions ?? []) collect(ix, transfers, memos);
  }
  return {
    signature,
    err: meta?.err ?? null,
    blockTime: typeof tx.blockTime === 'number' ? tx.blockTime : null,
    confirmationStatus: null,
    transfers,
    memos,
  };
}

export async function fetchTransaction(url: string, signature: string): Promise<ChainTx | null> {
  const tx = (await rpc(url, 'getTransaction', [
    signature,
    { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
  ])) as Record<string, unknown> | null;
  const parsed = parseRpcTransaction(signature, tx);
  if (!parsed) return null;
  parsed.confirmationStatus = await signatureStatus(url, signature);
  return parsed;
}

export { fromBase64 };
