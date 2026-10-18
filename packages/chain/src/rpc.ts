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

type RpcResponse = { result?: unknown; error?: { code?: number; message?: string } };

export type RpcOptions = {
  /** Total attempts for 429, 5xx, network errors and the RPC's own rate-limit codes. */
  attempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const RETRYABLE_RPC_CODES = new Set([-32005, -32029, 429]);

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Hides keys in `?api-key=` style query strings and path tokens from error text. */
export function redactRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'rpc';
  }
}

export async function rpc(
  url: string,
  method: string,
  params: unknown[],
  options: RpcOptions = {},
): Promise<unknown> {
  assertSafeRpc(url);
  const attempts = Math.max(1, options.attempts ?? 4);
  const base = options.baseDelayMs ?? 250;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: RpcError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(base * 2 ** (attempt - 1) + Math.floor(Math.random() * base));
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      last = new RpcError(
        `${method}: ${redactRpcUrl(url)} unreachable (${err instanceof Error ? err.message : 'network error'})`,
        0,
        true,
      );
      continue;
    }
    const text = await response.text();
    let body: RpcResponse | null;
    try {
      body = JSON.parse(text) as RpcResponse;
    } catch {
      body = null;
    }
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      (body?.error?.code !== undefined && RETRYABLE_RPC_CODES.has(body.error.code));
    if (body?.error || !response.ok || !body) {
      const detail = body?.error?.message ?? `HTTP ${response.status}`;
      last = new RpcError(
        `${method}: ${detail} (${redactRpcUrl(url)})`,
        response.status,
        retryable,
      );
      if (retryable) continue;
      throw last;
    }
    return body.result;
  }
  throw last ?? new RpcError(`${method}: no response`, 0, true);
}

export async function accountData(
  url: string,
  pubkey: string,
): Promise<{ data: Uint8Array; owner: string; lamports: bigint } | null> {
  const result = (await rpc(url, 'getAccountInfo', [
    pubkey,
    { encoding: 'base64', commitment: 'confirmed' },
  ])) as { value: { data: [string, string]; owner: string; lamports: number } | null };
  if (!result.value) return null;
  return {
    data: fromBase64(result.value.data[0]),
    owner: result.value.owner,
    lamports: BigInt(result.value.lamports),
  };
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

export type Simulation = { err: unknown; logs: string[]; unitsConsumed: number | null };

/**
 * Simulates an unsigned transaction the way a wallet will (no signature check, the
 * transaction's own blockhash). Run before asking a wallet to sign: a transaction that would
 * fail on chain is exactly what makes Phantom warn that a dApp "could be malicious".
 */
export async function simulateUnsigned(url: string, tx: Uint8Array): Promise<Simulation> {
  const result = (await rpc(url, 'simulateTransaction', [
    toBase64(tx),
    {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'confirmed',
    },
  ])) as { value?: { err?: unknown; logs?: string[] | null; unitsConsumed?: number } };
  return {
    err: result?.value?.err ?? null,
    logs: result?.value?.logs ?? [],
    unitsConsumed: result?.value?.unitsConsumed ?? null,
  };
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

/** Sends and waits for `confirmed`; a transaction that landed with an error throws. */
export async function sendAndConfirm(url: string, tx: Uint8Array, attempts = 40): Promise<string> {
  const signature = await sendRaw(url, tx);
  for (let i = 0; i < attempts; i += 1) {
    const result = (await rpc(url, 'getSignatureStatuses', [[signature]])) as {
      value: Array<{ confirmationStatus?: string; err: unknown } | null>;
    };
    const status = result.value[0];
    if (status?.err)
      throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized')
      return signature;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`transaction ${signature} was not confirmed`);
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

/** Sum of `owner`'s token accounts for `mint`, in base units (classic SPL and Token-2022). */
export async function tokenBalance(url: string, owner: string, mint: string): Promise<bigint> {
  const result = (await rpc(url, 'getTokenAccountsByOwner', [
    owner,
    { mint },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ])) as {
    value: { account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[];
  };
  let total = 0n;
  for (const row of result.value ?? []) {
    const amount = row.account.data.parsed?.info?.tokenAmount?.amount;
    if (amount && /^\d+$/.test(amount)) total += BigInt(amount);
  }
  return total;
}
