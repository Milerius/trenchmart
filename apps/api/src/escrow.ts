import {
  compileLegacyTx,
  computeBudgetIxs,
  ESCROW_BUDGET,
  decodeEscrow,
  ESCROW_ACCOUNT_DISCRIMINATOR,
  closeIx,
  escrowAddress,
  fundIx,
  initializeIx,
  memoIx,
  openDisputeIx,
  orderIdBytes,
  parseSecretKey,
  publicKeyOf,
  refundAfterTimeoutIx,
  refundIx,
  rejectDisputeIx,
  releaseIx,
  signTx,
  toBase64,
  type EscrowAccount,
  type EscrowInitArgs,
  type Instruction,
} from '@trenchmart/chain';
import type { AppConfig } from '@trenchmart/shared';
import type { Env } from './env';

/** Chain access the escrow flows need. The Worker wires it to the configured RPC. */
export type EscrowChain = {
  account(address: string): Promise<{ data: Uint8Array; owner: string; lamports: bigint } | null>;
  /** Sends a signed transaction and resolves once it is confirmed without error. */
  sendAndConfirm(tx: Uint8Array): Promise<string>;
};

export class EscrowError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function escrowEnabled(env: Env): boolean {
  return Boolean(env.escrowProgramId);
}

/** The resolver identity, checked against its secret so a mismatched pair never ships. */
export function resolverOf(env: Env): { pubkey: string; secret: Uint8Array | null } {
  const secret = env.escrowResolverSecret ? parseSecretKey(env.escrowResolverSecret) : null;
  const derived = secret ? publicKeyOf(secret) : '';
  if (env.escrowResolver && derived && env.escrowResolver !== derived)
    throw new EscrowError(503, 'ESCROW_MISCONFIGURED', 'ESCROW_RESOLVER does not match its secret');
  const pubkey = env.escrowResolver || derived;
  if (!pubkey) throw new EscrowError(503, 'ESCROW_MISCONFIGURED', 'escrow resolver is not set');
  return { pubkey, secret };
}

function requireBuckets(env: Env) {
  const b = env.buckets;
  if (!b.buyback || !b.ai_verification || !b.ops || !b.safety)
    throw new EscrowError(503, 'ESCROW_MISCONFIGURED', 'all four fee bucket wallets must be set');
  return b;
}

export function orderEscrowArgs(input: {
  env: Env;
  config: AppConfig;
  seller: string;
  price: bigint;
  feeBps: number;
  rebateBps: number;
  expiresAt: Date;
  escrowUntil: Date;
}): EscrowInitArgs {
  const buckets = requireBuckets(input.env);
  const split = input.config.fee_split_bps;
  if (split.buyback + split.ai_verification + split.ops + split.safety !== 10_000)
    throw new EscrowError(503, 'ESCROW_MISCONFIGURED', 'fee split must sum to 10000 bps');
  return {
    seller: input.seller,
    resolver: resolverOf(input.env).pubkey,
    buyback: buckets.buyback,
    aiVerification: buckets.ai_verification,
    ops: buckets.ops,
    safety: buckets.safety,
    price: input.price,
    feeBps: input.feeBps,
    rebateBps: input.rebateBps,
    splitBuybackBps: split.buyback,
    splitAiBps: split.ai_verification,
    splitOpsBps: split.ops,
    splitSafetyBps: split.safety,
    expiresAt: BigInt(Math.floor(input.expiresAt.getTime() / 1000)),
    escrowUntil: BigInt(Math.floor(input.escrowUntil.getTime() / 1000)),
  };
}

/** initialize + fund + memo in one transaction the buyer signs: funding is atomic. */
export function checkoutTx(input: {
  programId: string;
  buyer: string;
  orderId: string;
  memo: string;
  args: EscrowInitArgs;
  recentBlockhash: string;
  version?: 1 | 2;
}): { txBase64: string; escrow: string } {
  const version = input.version ?? 1;
  const escrow = escrowAddress(
    input.orderId,
    input.programId,
    version === 2 ? input.buyer : undefined,
  );
  const instructions: Instruction[] = [
    ...computeBudgetIxs(ESCROW_BUDGET),
    initializeIx({
      programId: input.programId,
      buyer: input.buyer,
      orderId: input.orderId,
      args: input.args,
      version,
    }),
    fundIx({ programId: input.programId, buyer: input.buyer, escrow }),
    memoIx(input.memo, input.buyer),
  ];
  const tx = compileLegacyTx({
    feePayer: input.buyer,
    instructions,
    recentBlockhash: input.recentBlockhash,
  });
  return { txBase64: toBase64(tx), escrow };
}

export function openDisputeTx(input: {
  programId: string;
  buyer: string;
  escrow: string;
  recentBlockhash: string;
  version?: 1 | 2;
}): string {
  return toBase64(
    compileLegacyTx({
      feePayer: input.buyer,
      instructions: [...computeBudgetIxs(ESCROW_BUDGET), openDisputeIx(input)],
      recentBlockhash: input.recentBlockhash,
    }),
  );
}

/** Reads and authenticates an escrow account: owned by the program, right discriminator. */
export async function readEscrow(
  chain: EscrowChain,
  programId: string,
  address: string,
): Promise<EscrowAccount | null> {
  const info = await chain.account(address);
  if (!info) return null;
  if (info.owner !== programId)
    throw new EscrowError(400, 'ESCROW_FOREIGN', 'escrow account is not owned by the program');
  const head = info.data.subarray(0, 8);
  if (!ESCROW_ACCOUNT_DISCRIMINATOR.every((byte, i) => head[i] === byte))
    throw new EscrowError(400, 'ESCROW_FOREIGN', 'account is not an escrow');
  return decodeEscrow(info.data);
}

/** Every field the server relies on must match what it asked the buyer to sign. */
export function escrowMismatch(
  account: EscrowAccount,
  expected: EscrowInitArgs & { buyer: string; orderId: string; total: bigint },
): string | null {
  const pairs: [string, unknown, unknown][] = [
    ['buyer', account.buyer, expected.buyer],
    ['seller', account.seller, expected.seller],
    ['resolver', account.resolver, expected.resolver],
    ['buyback', account.buyback, expected.buyback],
    ['ai_verification', account.aiVerification, expected.aiVerification],
    ['ops', account.ops, expected.ops],
    ['safety', account.safety, expected.safety],
    ['price', account.price, expected.price],
    ['fee_bps', account.feeBps, expected.feeBps],
    ['rebate_bps', account.rebateBps, expected.rebateBps],
    ['split_buyback_bps', account.splitBuybackBps, expected.splitBuybackBps],
    ['split_ai_bps', account.splitAiBps, expected.splitAiBps],
    ['split_ops_bps', account.splitOpsBps, expected.splitOpsBps],
    ['split_safety_bps', account.splitSafetyBps, expected.splitSafetyBps],
    ['expires_at', account.expiresAt, expected.expiresAt],
    ['escrow_until', account.escrowUntil, expected.escrowUntil],
    ['deposit', account.deposit, expected.total],
  ];
  for (const [name, got, want] of pairs) if (got !== want) return name;
  const id = orderIdBytes(expected.orderId);
  if (!id.every((byte, i) => account.orderId[i] === byte)) return 'order_id';
  return null;
}

/** The crank key pays fees (M-02); the resolver signs only where its authority is needed. */
function crankOf(env: Env): { pubkey: string; secret: Uint8Array } | null {
  if (!env.escrowCrankSecret) return null;
  const secret = parseSecretKey(env.escrowCrankSecret);
  return { pubkey: publicKeyOf(secret), secret };
}

function feePayerOf(env: Env): { pubkey: string; secret: Uint8Array } {
  const crank = crankOf(env);
  if (crank) return crank;
  const resolver = resolverOf(env);
  if (!resolver.secret)
    throw new EscrowError(503, 'ESCROW_MISCONFIGURED', 'ESCROW_RESOLVER_SECRET is not set');
  return { pubkey: resolver.pubkey, secret: resolver.secret };
}

/** Permissionless instructions: only the fee payer (crank, else resolver) signs. */
function crankSigned(env: Env, instructions: Instruction[], recentBlockhash: string): Uint8Array {
  const payer = feePayerOf(env);
  const tx = compileLegacyTx({ feePayer: payer.pubkey, instructions, recentBlockhash });
  return signTx(tx, [payer.secret]);
}

/** Resolver-authority instructions: the crank pays when configured, the resolver co-signs. */
function resolverSigned(
  env: Env,
  instructions: Instruction[],
  recentBlockhash: string,
): Uint8Array {
  const resolver = resolverOf(env);
  if (!resolver.secret)
    throw new EscrowError(503, 'ESCROW_MISCONFIGURED', 'ESCROW_RESOLVER_SECRET is not set');
  const payer = feePayerOf(env);
  const tx = compileLegacyTx({ feePayer: payer.pubkey, instructions, recentBlockhash });
  const keys =
    payer.pubkey === resolver.pubkey ? [resolver.secret] : [payer.secret, resolver.secret];
  return signTx(tx, keys);
}

export function releaseTx(
  env: Env,
  escrow: string,
  account: EscrowAccount,
  recentBlockhash: string,
) {
  return crankSigned(
    env,
    [
      releaseIx({
        programId: env.escrowProgramId,
        escrow,
        seller: account.seller,
        buyback: account.buyback,
        aiVerification: account.aiVerification,
        ops: account.ops,
        safety: account.safety,
      }),
    ],
    recentBlockhash,
  );
}

export function refundTx(
  env: Env,
  escrow: string,
  account: EscrowAccount,
  recentBlockhash: string,
) {
  const resolver = resolverOf(env).pubkey;
  return resolverSigned(
    env,
    [
      refundIx({
        programId: env.escrowProgramId,
        resolver,
        escrow,
        buyer: account.buyer,
        version: env.escrowProgramVersion,
      }),
    ],
    recentBlockhash,
  );
}

export function rejectDisputeTx(env: Env, escrow: string, recentBlockhash: string) {
  const resolver = resolverOf(env).pubkey;
  return resolverSigned(
    env,
    [
      rejectDisputeIx({
        programId: env.escrowProgramId,
        resolver,
        escrow,
        version: env.escrowProgramVersion,
      }),
    ],
    recentBlockhash,
  );
}

/** v2 (M-01): the resolver opens the dispute on chain the moment the buyer files it. */
export function freezeTx(env: Env, escrow: string, recentBlockhash: string) {
  if (env.escrowProgramVersion !== 2)
    throw new EscrowError(409, 'ESCROW_V1', 'resolver freeze needs escrow program v2');
  const resolver = resolverOf(env).pubkey;
  return resolverSigned(
    env,
    [openDisputeIx({ programId: env.escrowProgramId, buyer: resolver, escrow, version: 2 })],
    recentBlockhash,
  );
}

/** v2 (L-01): close a terminal escrow; the rent goes back to the buyer. */
export function closeTx(env: Env, escrow: string, buyer: string, recentBlockhash: string) {
  return crankSigned(
    env,
    [closeIx({ programId: env.escrowProgramId, escrow, buyer })],
    recentBlockhash,
  );
}

/** v2 (M-02): default outcome when the resolver never acted before the timeout. */
export function refundAfterTimeoutTx(
  env: Env,
  escrow: string,
  buyer: string,
  recentBlockhash: string,
) {
  return crankSigned(
    env,
    [refundAfterTimeoutIx({ programId: env.escrowProgramId, escrow, buyer })],
    recentBlockhash,
  );
}
