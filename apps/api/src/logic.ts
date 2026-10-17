import { createHash, randomUUID } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import type { Sql } from '@trenchmart/db';
import { clamAvHttpClient, scan } from '@trenchmart/scanner';
import {
  attestationMessage,
  runAiVerifier,
  combineVerdicts,
  llmConfigured,
  LLM_EXCERPT_CHARS,
  runLlmReview,
  RULES_ENGINE,
  type LlmVerdict,
  signAttestation,
} from '@trenchmart/ai-verifier';
import {
  assessPayment,
  bondMemo,
  canOpenDispute,
  escrowUntilFrom,
  formatSol,
  minBalanceInWindow,
  nextTierNeed,
  orderMemo,
  arrayBufferOf,
  parseAppConfig,
  releaseDue,
  releasePayouts,
  refundPayout,
  requiredBondLamports,
  tierAtLeast,
  tierFor,
  verificationFeeMemo,
  verificationFeePayout,
  type AppConfig,
  type OrderStatus,
  type Tier,
  ZIP_LICENSE_NAME,
  zipLicenseText,
  watermarkText,
} from '@trenchmart/shared';
import {
  compilePayoutBatch,
  compileUnsignedTransferMemo,
  fromBase64,
  toBase64,
  TRANSFER_BUDGET,
  type ChainTx,
  type Simulation,
} from '@trenchmart/chain';
import { dispatchSandbox, type SandboxQueue } from './dispatch';
import {
  checkoutTx,
  escrowEnabled,
  escrowMismatch,
  EscrowError,
  openDisputeTx,
  orderEscrowArgs,
  readEscrow,
  refundTx,
  rejectDisputeTx,
  releaseTx,
  type EscrowChain,
} from './escrow';
import type { IsolatedSandboxResult } from './sandbox';
import type { BlobStore } from './blob';
import type { Env } from './env';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Deps = {
  sql: Sql;
  blob: BlobStore;
  env: Env;
  now: () => Date;
  getTx: (signature: string) => Promise<ChainTx | null>;
  blockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  /** Simulates an unsigned transaction (sigVerify off). Optional: skipped when absent. */
  simulate?: (tx: Uint8Array) => Promise<Simulation>;
  sandboxQueue?: SandboxQueue;
  /** Required when ESCROW_PROGRAM_ID is set. */
  escrowChain?: EscrowChain;
  /** Fetch used for the optional model review. Defaults to the global fetch. */
  llmFetch?: typeof fetch;
};

function chainOf(deps: Deps): EscrowChain {
  if (!deps.escrowChain)
    throw new EscrowError(503, 'ESCROW_MISCONFIGURED', 'escrow chain access is not wired');
  return deps.escrowChain;
}

type Row = Record<string, any>;

/** Engine label stored on sandbox scans (the isolated runner in packages/scanner). */
export const SANDBOX_ENGINE = 'sandbox-isolate@1.0.0';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', arrayBufferOf(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadConfig(deps: Deps): Promise<AppConfig> {
  const rows = await deps.sql<{ key: string; value: unknown }[]>`select key, value from config`;
  const record: Record<string, unknown> = {};
  for (const row of rows) record[row.key] = row.value;
  return parseAppConfig(record, deps.env.escrowHoursOverride);
}

export async function audit(
  sql: Sql,
  actorId: string | null,
  entity: string,
  entityId: string,
  action: string,
  data?: unknown,
): Promise<void> {
  await sql`
    insert into audit_log (actor_id, entity, entity_id, action, data)
    values (${actorId}, ${entity}, ${entityId}, ${action}, ${data === undefined ? null : sql.json(data as never)})
  `;
}

async function notify(sql: Sql, userId: string, kind: string, data: unknown): Promise<void> {
  await sql`
    insert into notifications (user_id, kind, data) values (${userId}, ${kind}, ${sql.json(data as never)})
  `;
}

export async function tierForWallet(
  deps: Deps,
  wallet: string,
  config: AppConfig,
): Promise<{
  tier: Tier;
  minBalance: bigint;
  nextTier: Tier | null;
  needed: bigint;
}> {
  const rows = await deps.sql<
    { amount: string; ts: Date; source: 'webhook' | 'snapshot' | 'reconcile' }[]
  >`
    select amount::text as amount, ts, source from token_balances where wallet = ${wallet} order by ts asc
  `;
  const history = rows.map((row) => ({
    amount: BigInt(row.amount),
    ts: row.ts,
    source: row.source,
  }));
  const minBalance = minBalanceInWindow(history, deps.now(), config.tier_window_hours);
  const tier = tierFor(minBalance, config.tier_thresholds);
  const next = nextTierNeed(minBalance, config.tier_thresholds);
  return { tier, minBalance, nextTier: next.nextTier, needed: next.needed };
}

export async function ensureSnapshot(deps: Deps, wallet: string): Promise<void> {
  const existing = await deps.sql`select 1 from token_balances where wallet = ${wallet} limit 1`;
  if (existing.length > 0) return;
  await deps.sql`
    insert into token_balances (wallet, amount, ts, source)
    values (${wallet}, 0, ${deps.now()}, 'snapshot')
  `;
}

function unsignedTx(input: {
  from: string;
  to: string;
  lamports: bigint;
  memo: string;
  recentBlockhash: string;
}): string {
  return toBase64(compileUnsignedTransferMemo({ ...input, budget: TRANSFER_BUDGET }));
}

/**
 * Simulates a transaction before a wallet is asked to sign it. Phantom blocks or warns
 * ("This dApp could be malicious") when its own simulation fails, so a transaction that
 * would fail is refused here with the real reason instead. An unreachable RPC does not
 * block: the wallet and the broadcast preflight still check it.
 */
export async function preflightTx(deps: Deps, txBase64: string): Promise<void> {
  if (!deps.simulate) return;
  let result: Simulation;
  try {
    result = await deps.simulate(fromBase64(txBase64));
  } catch {
    return;
  }
  if (result.err === null || result.err === undefined) return;
  const logs = result.logs.join('\n');
  if (
    /insufficient (lamports|funds)/i.test(logs) ||
    JSON.stringify(result.err).includes('InsufficientFunds')
  ) {
    throw new HttpError(
      400,
      'INSUFFICIENT_SOL',
      'Not enough devnet SOL in this wallet for the payment and network fee.',
    );
  }
  if (JSON.stringify(result.err).includes('AccountNotFound')) {
    throw new HttpError(
      400,
      'INSUFFICIENT_SOL',
      'This wallet has no devnet SOL yet. Fund it on devnet, then try again.',
    );
  }
  throw new HttpError(
    400,
    'TX_WOULD_FAIL',
    `This transaction would fail on devnet (${JSON.stringify(result.err).slice(0, 120)}). Nothing was sent.`,
  );
}

export async function buildVaultTx(
  deps: Deps,
  from: string,
  lamports: bigint,
  memo: string,
): Promise<{ txBase64: string; blockhash: string; lastValidBlockHeight: number }> {
  if (!deps.env.vaultAddress)
    throw new HttpError(503, 'VAULT_UNCONFIGURED', 'VAULT_ADDRESS is not set');
  const latest = await deps.blockhash();
  const txBase64 = unsignedTx({
    from,
    to: deps.env.vaultAddress,
    lamports,
    memo,
    recentBlockhash: latest.blockhash,
  });
  await preflightTx(deps, txBase64);
  return {
    txBase64,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

async function userById(sql: Sql, id: string): Promise<Row> {
  const rows = await sql<Row[]>`select * from users where id = ${id}`;
  const user = rows[0];
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'user not found');
  return user;
}

export async function activeBond(sql: Sql, userId: string): Promise<bigint> {
  const rows = await sql<{ amount: bigint }[]>`
    select coalesce(sum(amount), 0)::bigint as amount from bonds
    where user_id = ${userId} and status = 'active'
  `;
  return rows[0]?.amount ?? 0n;
}

export async function quoteListing(deps: Deps, userId: string, listingId: string) {
  const config = await loadConfig(deps);
  const listing = await listingById(deps.sql, listingId);
  const buyer = await userById(deps.sql, userId);
  const tierInfo = await tierForWallet(deps, buyer.wallet as string, config);
  const rebateBps = config.tier_rebate_bps[tierInfo.tier];
  const price = listing.price as bigint;
  const fee = (price * BigInt(config.fee_bps)) / 10_000n;
  const rebate = (fee * BigInt(rebateBps)) / 10_000n;
  return {
    price,
    fee,
    rebate,
    total: price + fee - rebate,
    tier: tierInfo.tier,
    feeBps: config.fee_bps,
    rebateBps,
    netFee: fee - rebate,
    listing,
    buyer,
    config,
  };
}

async function listingById(sql: Sql, id: string): Promise<Row> {
  const rows = await sql<Row[]>`select * from listings where id = ${id}`;
  const listing = rows[0];
  if (!listing) throw new HttpError(404, 'NOT_FOUND', 'listing not found');
  return listing;
}

export async function createOrder(deps: Deps, userId: string, listingId: string) {
  const quoted = await quoteListing(deps, userId, listingId);
  const listing = quoted.listing;
  if (listing.creator_id === userId)
    throw new HttpError(400, 'OWN_LISTING', 'you cannot buy your own listing');
  if (listing.delisted_at || listing.paused_at || !listing.live_version_id) {
    throw new HttpError(400, 'NOT_LIVE', 'listing is not live');
  }
  if (listing.holder_only && !tierAtLeast(quoted.tier, 'scout')) {
    throw new HttpError(403, 'HOLDER_ONLY', 'this listing is holder-only');
  }
  if (listing.holder_only_hours > 0 && listing.first_live_at && quoted.tier === 'none') {
    const until = new Date(listing.first_live_at.getTime() + listing.holder_only_hours * 3_600_000);
    if (until > deps.now()) throw new HttpError(403, 'HOLDER_WINDOW', 'holders have early access');
  }
  const owned = await deps.sql`
    select 1 from licenses l
    join orders o on o.id = l.order_id
    where o.listing_id = ${listingId} and l.wallet = ${quoted.buyer.wallet}
      and o.status in ('paid', 'released', 'disputed')
      and (l.valid_until is null or l.valid_until > ${deps.now()})
    limit 1
  `;
  if (owned.length > 0) throw new HttpError(409, 'ALREADY_OWNED', 'you already have a license');
  const id = randomUUID();
  const memo = orderMemo(id);
  const expires = new Date(deps.now().getTime() + quoted.config.order_ttl_minutes * 60_000);
  if (escrowEnabled(deps.env)) {
    // The buyer funds a per-order escrow PDA. The window is fixed when the escrow is
    // created, so it runs from the order's payment deadline, not from the block time.
    const seller = await userById(deps.sql, listing.creator_id as string);
    const escrowUntil = escrowUntilFrom(expires, quoted.config.escrow_hours);
    const args = orderEscrowArgs({
      env: deps.env,
      config: quoted.config,
      seller: seller.wallet as string,
      price: quoted.price,
      feeBps: quoted.feeBps,
      rebateBps: quoted.rebateBps,
      expiresAt: expires,
      escrowUntil,
    });
    const latest = await deps.blockhash();
    const built = checkoutTx({
      programId: deps.env.escrowProgramId,
      buyer: quoted.buyer.wallet as string,
      orderId: id,
      memo,
      args,
      recentBlockhash: latest.blockhash,
    });
    await preflightTx(deps, built.txBase64);
    await deps.sql`
      insert into orders (
        id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
        tier_at_purchase, memo, status, expires_at, escrow_until, escrow_address
      ) values (
        ${id}, ${userId}, ${listingId}, ${listing.live_version_id}, ${quoted.price}, ${quoted.feeBps},
        ${quoted.rebateBps}, ${quoted.fee}, ${quoted.rebate}, ${quoted.total}, ${quoted.tier}::tier,
        ${memo}, 'pending', ${expires}, ${escrowUntil}, ${built.escrow}
      )
    `;
    return {
      orderId: id,
      total: quoted.total,
      memo,
      escrow: built.escrow,
      escrowProgram: deps.env.escrowProgramId,
      escrowUntil: escrowUntil.toISOString(),
      txBase64: built.txBase64,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    };
  }
  const tx = await buildVaultTx(deps, quoted.buyer.wallet as string, quoted.total, memo);
  await deps.sql`
    insert into orders (
      id, buyer_id, listing_id, version_id, price, fee_bps, rebate_bps, fee, rebate, total,
      tier_at_purchase, memo, status, expires_at
    ) values (
      ${id}, ${userId}, ${listingId}, ${listing.live_version_id}, ${quoted.price}, ${quoted.feeBps},
      ${quoted.rebateBps}, ${quoted.fee}, ${quoted.rebate}, ${quoted.total}, ${quoted.tier}::tier,
      ${memo}, 'pending', ${expires}
    )
  `;
  return { orderId: id, total: quoted.total, memo, vault: deps.env.vaultAddress, ...tx };
}

export async function applyPayment(
  deps: Deps,
  input: { kind: 'order' | 'bond' | 'vfee'; id: string; txSig: string; actorId: string | null },
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const tx = await deps.getTx(input.txSig);
  if (!tx) return { ok: false, code: 'TX_NOT_FOUND', message: 'transaction not found' };
  if (input.kind === 'order') return settleOrder(deps, input.id, input.txSig, tx);
  if (input.kind === 'bond') return settleBond(deps, input.id, input.txSig, tx);
  return settleVfee(deps, input.id, input.txSig, tx);
}

async function settleOrder(deps: Deps, orderId: string, txSig: string, tx: ChainTx) {
  const rows = await deps.sql<Row[]>`select * from orders where id = ${orderId}`;
  const order = rows[0];
  if (!order) return { ok: false, code: 'NOT_FOUND', message: 'order not found' };
  if (order.status === 'paid' && order.tx_sig === txSig) return { ok: true as const };
  const buyer = await userById(deps.sql, order.buyer_id as string);
  const config = await loadConfig(deps);
  const paidAt = new Date((tx.blockTime ?? Math.floor(deps.now().getTime() / 1000)) * 1000);
  let escrowUntil: Date;
  if (order.escrow_address) {
    const verdict = await verifyEscrowFunding(deps, order, buyer, tx, config);
    if (!verdict.ok) {
      await audit(deps.sql, buyer.id as string, 'order', orderId, 'payment_mismatch', verdict);
      return verdict;
    }
    escrowUntil = order.escrow_until as Date;
  } else {
    const assessment = assessPayment({
      status: order.status as OrderStatus,
      expectedLamports: order.total as bigint,
      expectedMemo: order.memo as string,
      expectedSource: buyer.wallet as string,
      expectedDestination: deps.env.vaultAddress,
      transfers: tx.transfers,
      memos: tx.memos,
      expiresAt: order.expires_at as Date,
      blockTimeMs: tx.blockTime === null ? null : tx.blockTime * 1000,
      txErr: tx.err != null,
      now: deps.now(),
    });
    if (!assessment.ok) {
      if (assessment.code === 'WRONG_AMOUNT' || assessment.code === 'WRONG_MEMO') {
        await audit(deps.sql, buyer.id as string, 'order', orderId, 'payment_mismatch', assessment);
      }
      return assessment;
    }
    escrowUntil = escrowUntilFrom(paidAt, config.escrow_hours);
  }
  const duplicate =
    await deps.sql`select id from orders where tx_sig = ${txSig} and id <> ${orderId}`;
  if (duplicate.length > 0)
    return { ok: false, code: 'DUPLICATE_SIG', message: 'signature already used' };
  const updated = await deps.sql`
    update orders set status = 'paid', tx_sig = ${txSig}, paid_at = ${paidAt}, escrow_until = ${escrowUntil}
    where id = ${orderId} and status = 'pending'
    returning id
  `;
  if (updated.length === 0)
    return { ok: false, code: 'NOT_PENDING', message: 'order is not pending' };
  const listingRows = await deps.sql<{ sub_period_days: number | null; license: string }[]>`
    select sub_period_days, license from listings where id = ${order.listing_id}
  `;
  const period =
    listingRows[0]?.license === 'subscription' ? listingRows[0]?.sub_period_days : null;
  const validUntil = period ? new Date(paidAt.getTime() + period * 86_400_000) : null;
  await deps.sql`insert into licenses (order_id, wallet, valid_until) values (${orderId}, ${buyer.wallet}, ${validUntil})`;
  const holding = order.escrow_address ? 'escrow' : 'vault';
  await deps.sql`
    insert into ledger (account, delta, ref_type, ref_id) values (${holding}, ${order.total}, 'order', ${orderId})
  `;
  await deps.sql`
    update listings set sales_7d = sales_7d + 1 where id = ${order.listing_id}
  `;
  await audit(deps.sql, buyer.id as string, 'order', orderId, 'paid', { txSig });
  return { ok: true as const };
}

/**
 * A funded escrow is proven by the account itself, not by the transfer list: it must be
 * owned by the program, be Paid, hold the full total, and carry exactly the terms the server
 * asked the buyer to sign. The signature must be this order's successful checkout tx.
 */
async function verifyEscrowFunding(
  deps: Deps,
  order: Row,
  buyer: Row,
  tx: ChainTx,
  config: AppConfig,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (order.status !== 'pending')
    return { ok: false, code: 'NOT_PENDING', message: 'order is not pending' };
  if (tx.err != null) return { ok: false, code: 'TX_FAILED', message: 'transaction failed' };
  if (!tx.memos.some((memo) => memo.includes(order.memo as string)))
    return { ok: false, code: 'WRONG_MEMO', message: 'transaction is not this order checkout' };
  const blockMs = tx.blockTime === null ? null : tx.blockTime * 1000;
  if (blockMs !== null && blockMs > (order.expires_at as Date).getTime())
    return { ok: false, code: 'EXPIRED', message: 'paid after the order expired' };
  if (!deps.env.escrowProgramId)
    return { ok: false, code: 'ESCROW_MISCONFIGURED', message: 'ESCROW_PROGRAM_ID is not set' };
  const account = await readEscrow(
    chainOf(deps),
    deps.env.escrowProgramId,
    order.escrow_address as string,
  );
  if (!account) return { ok: false, code: 'ESCROW_MISSING', message: 'escrow account not found' };
  if (account.status !== 'paid')
    return { ok: false, code: 'ESCROW_NOT_PAID', message: `escrow is ${account.status}` };
  const seller = await deps.sql<{ wallet: string }[]>`
    select u.wallet from listings l join users u on u.id = l.creator_id where l.id = ${order.listing_id}
  `;
  const expected = orderEscrowArgs({
    env: deps.env,
    config,
    seller: seller[0]?.wallet ?? '',
    price: order.price as bigint,
    feeBps: order.fee_bps as number,
    rebateBps: order.rebate_bps as number,
    expiresAt: order.expires_at as Date,
    escrowUntil: order.escrow_until as Date,
  });
  const wrong = escrowMismatch(account, {
    ...expected,
    buyer: buyer.wallet as string,
    orderId: order.id as string,
    total: order.total as bigint,
  });
  if (wrong)
    return {
      ok: false,
      code: 'ESCROW_MISMATCH',
      message: `escrow ${wrong} does not match the order`,
    };
  return { ok: true };
}

/** Idempotent. A wallet becomes a creator once it meets the bond for a listing. */
export async function grantCreatorRole(sql: Deps['sql'], userId: string): Promise<void> {
  await sql`
    update users set roles = roles || '{creator}'::user_role[]
    where id = ${userId} and not ('creator' = any(roles))
  `;
}

async function settleBond(deps: Deps, bondId: string, txSig: string, tx: ChainTx) {
  const rows = await deps.sql<Row[]>`select * from bonds where id = ${bondId}`;
  const bond = rows[0];
  if (!bond) return { ok: false, code: 'NOT_FOUND', message: 'bond not found' };
  if (bond.status === 'active' && bond.tx_sig === txSig) return { ok: true as const };
  const user = await userById(deps.sql, bond.user_id as string);
  const assessment = assessPayment({
    status: 'pending',
    expectedLamports: bond.amount as bigint,
    expectedMemo: bondMemo(bondId),
    expectedSource: user.wallet as string,
    expectedDestination: deps.env.vaultAddress,
    transfers: tx.transfers,
    memos: tx.memos,
    expiresAt: new Date(deps.now().getTime() + 86_400_000),
    blockTimeMs: tx.blockTime === null ? null : tx.blockTime * 1000,
    txErr: tx.err != null,
    now: deps.now(),
  });
  if (!assessment.ok) return assessment;
  if (bond.status !== 'pending')
    return { ok: false, code: 'NOT_PENDING', message: 'bond is not pending' };
  await deps.sql`update bonds set status = 'active', tx_sig = ${txSig} where id = ${bondId}`;
  await grantCreatorRole(deps.sql, user.id as string);
  await deps.sql`
    insert into ledger (account, delta, ref_type, ref_id)
    values ('vault', ${bond.amount}, 'bond', ${bondId}), (${'bond:' + user.id}, ${bond.amount}, 'bond', ${bondId})
  `;
  await audit(deps.sql, user.id as string, 'bond', bondId, 'active', { txSig });
  return { ok: true as const };
}

async function settleVfee(deps: Deps, versionId: string, txSig: string, tx: ChainTx) {
  const rows = await deps.sql<Row[]>`
    select v.*, l.creator_id from versions v join listings l on l.id = v.listing_id where v.id = ${versionId}
  `;
  const version = rows[0];
  if (!version) return { ok: false, code: 'NOT_FOUND', message: 'version not found' };
  if (version.vfee_sig === txSig) return { ok: true as const };
  const user = await userById(deps.sql, version.creator_id as string);
  const assessment = assessPayment({
    status: 'pending',
    expectedLamports: version.vfee_lamports as bigint,
    expectedMemo: verificationFeeMemo(versionId),
    expectedSource: user.wallet as string,
    expectedDestination: deps.env.vaultAddress,
    transfers: tx.transfers,
    memos: tx.memos,
    expiresAt: new Date(deps.now().getTime() + 86_400_000),
    blockTimeMs: tx.blockTime === null ? null : tx.blockTime * 1000,
    txErr: tx.err != null,
    now: deps.now(),
  });
  if (!assessment.ok) return assessment;
  await deps.sql`update versions set vfee_sig = ${txSig} where id = ${versionId}`;
  const lines = verificationFeePayout(
    version.vfee_lamports as bigint,
    deps.env.buckets.ai_verification,
  );
  for (const line of lines) {
    await deps.sql`
      insert into payouts (order_id, recipient, bucket, amount) values (null, ${line.recipient}, ${line.bucket}, ${line.amount})
    `;
  }
  await deps.sql`
    insert into ledger (account, delta, ref_type, ref_id) values ('vault', ${version.vfee_lamports}, 'vfee', ${versionId})
  `;
  return { ok: true as const };
}

export async function expireOrders(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - 5 * 60 * 1000);
  const rows = await deps.sql<{ id: string }[]>`
    update orders set status = 'expired'
    where status = 'pending' and expires_at < ${cutoff}
    returning id
  `;
  return rows.length;
}

export async function releaseOrders(deps: Deps): Promise<string[]> {
  const config = await loadConfig(deps);
  const rows = await deps.sql<Row[]>`
    select o.*, u.wallet as creator_wallet, u.id as creator_user
    from orders o
    join listings l on l.id = o.listing_id
    join users u on u.id = l.creator_id
    where o.status = 'paid' and o.escrow_until <= ${deps.now()}
      and not exists (select 1 from disputes d where d.order_id = o.id and d.status = 'open')
  `;
  const released: string[] = [];
  for (const order of rows) {
    let releaseSig: string | null = null;
    if (order.escrow_address) {
      const outcome = await releaseEscrow(deps, order).catch((err: unknown) => {
        console.error('escrow release failed', order.id, (err as Error).message);
        return null;
      });
      if (!outcome) continue;
      releaseSig = outcome.sig;
    } else {
      const tx = order.tx_sig ? await deps.getTx(order.tx_sig as string) : null;
      const due = releaseDue({
        status: 'paid',
        escrowUntil: order.escrow_until as Date,
        now: deps.now(),
        openDispute: false,
        finalized: tx?.confirmationStatus === 'finalized' && tx.err == null,
      });
      if (!due) continue;
    }
    const lines = releasePayouts({
      price: order.price as bigint,
      netFee: (order.fee as bigint) - (order.rebate as bigint),
      splitBps: config.fee_split_bps,
      creatorWallet: order.creator_wallet as string,
      buckets: deps.env.buckets,
    });
    await deps.sql`
      update orders set status = 'released', released_at = ${deps.now()}, release_sig = ${releaseSig}
      where id = ${order.id} and status = 'paid'
    `;
    const holding = order.escrow_address ? 'escrow' : 'vault';
    await deps.sql`
      insert into ledger (account, delta, ref_type, ref_id) values (${holding}, ${-(order.total as bigint)}, 'order', ${order.id})
    `;
    await deps.sql`
      insert into ledger (account, delta, ref_type, ref_id)
      values (${'creator:' + order.creator_user}, ${order.price}, 'payout', ${order.id})
    `;
    for (const line of lines) {
      if (line.bucket !== 'creator') {
        await deps.sql`
          insert into ledger (account, delta, ref_type, ref_id)
          values (${'bucket:' + line.bucket}, ${line.amount}, 'payout', ${order.id})
        `;
      }
      // The escrow program pays every line in the release tx; vault orders queue a batch.
      if (order.escrow_address) {
        await deps.sql`
          insert into payouts (order_id, recipient, bucket, amount, status, tx_sig)
          values (${order.id}, ${line.recipient}, ${line.bucket}, ${line.amount}, 'sent', ${releaseSig})
        `;
      } else {
        await deps.sql`
          insert into payouts (order_id, recipient, bucket, amount) values (${order.id}, ${line.recipient}, ${line.bucket}, ${line.amount})
        `;
      }
    }
    await notify(deps.sql, order.creator_user as string, 'released', { orderId: order.id });
    await notify(deps.sql, order.buyer_id as string, 'released', { orderId: order.id });
    released.push(order.id as string);
  }
  return released;
}

/**
 * Sends `release` for a due escrow, signed by the resolver as fee payer. The program pays
 * the seller and the four buckets itself. Returns null when the escrow is not releasable
 * (still in window, disputed on chain, or not funded).
 */
async function releaseEscrow(deps: Deps, order: Row): Promise<{ sig: string | null } | null> {
  const programId = deps.env.escrowProgramId;
  if (!programId) return null;
  const chain = chainOf(deps);
  const address = order.escrow_address as string;
  const account = await readEscrow(chain, programId, address);
  if (!account) return null;
  // Release is permissionless on chain; someone may already have cranked it.
  if (account.status === 'released') return { sig: null };
  if (account.status !== 'paid') return null;
  if (BigInt(Math.floor(deps.now().getTime() / 1000)) < account.escrowUntil) return null;
  const latest = await deps.blockhash();
  const sig = await chain.sendAndConfirm(releaseTx(deps.env, address, account, latest.blockhash));
  await audit(deps.sql, null, 'order', order.id as string, 'escrow_released', { sig });
  return { sig };
}

export async function proposePayouts(
  deps: Deps,
): Promise<{ batchId: string; count: number } | null> {
  const rows = await deps.sql<Row[]>`
    select * from payouts
    where status = 'pending' and recipient not like 'UNCONFIGURED:%'
    order by created_at asc
    limit 15
  `;
  if (rows.length === 0) return null;
  const batchId = randomUUID();
  const latest = await deps.blockhash().catch(() => null);
  const body = {
    batchId,
    vault: deps.env.vaultAddress,
    transfers: rows.map((row) => ({
      to: row.recipient,
      lamports: (row.amount as bigint).toString(),
      bucket: row.bucket,
    })),
    txBase64:
      latest && deps.env.vaultAddress
        ? toBase64(
            compilePayoutBatch({
              from: deps.env.vaultAddress,
              transfers: rows.map((row) => ({
                to: row.recipient as string,
                lamports: row.amount as bigint,
              })),
              recentBlockhash: latest.blockhash,
              memo: `batch:${batchId.slice(0, 8)}`,
            }),
          )
        : null,
  };
  await deps.blob.put(
    `payout-batches/${batchId}.json`,
    new TextEncoder().encode(JSON.stringify(body)),
  );
  for (const row of rows) {
    await deps.sql`update payouts set status = 'proposed', batch_id = ${batchId} where id = ${row.id}`;
  }
  return { batchId, count: rows.length };
}

export async function markBatchSent(deps: Deps, batchId: string, txSig: string): Promise<number> {
  const rows = await deps.sql<{ id: string }[]>`
    update payouts set status = 'sent', tx_sig = ${txSig} where batch_id = ${batchId} and status = 'proposed' returning id
  `;
  if (rows[0]) await audit(deps.sql, null, 'payout', rows[0].id, 'batch_sent', { batchId, txSig });
  return rows.length;
}

async function slash(deps: Deps, userId: string, lamports: bigint, refId: string): Promise<bigint> {
  const bonds = await deps.sql<Row[]>`
    select * from bonds where user_id = ${userId} and status = 'active' order by created_at desc
  `;
  let left = lamports;
  for (const bond of bonds) {
    if (left <= 0n) break;
    const have = bond.amount as bigint;
    const cut = left < have ? left : have;
    const remain = have - cut;
    if (remain === 0n)
      await deps.sql`update bonds set status = 'slashed', amount = 0 where id = ${bond.id}`;
    else await deps.sql`update bonds set amount = ${remain} where id = ${bond.id}`;
    await deps.sql`
      insert into ledger (account, delta, ref_type, ref_id)
      values (${'bond:' + userId}, ${-cut}, 'slash', ${refId}), ('bucket:safety', ${cut}, 'slash', ${refId})
    `;
    left -= cut;
  }
  const config = await loadConfig(deps);
  const categories = await deps.sql<{ category: string }[]>`
    select distinct category from listings where creator_id = ${userId} and delisted_at is null and live_version_id is not null
  `;
  const tier = await tierForWallet(
    deps,
    (await userById(deps.sql, userId)).wallet as string,
    config,
  );
  const required = requiredBondLamports(
    categories.map((row) => row.category),
    config.bond_lamports_by_category,
    tier.tier,
    config.og_bond_discount_bps,
  );
  if ((await activeBond(deps.sql, userId)) < required) {
    await deps.sql`update listings set paused_at = ${deps.now()} where creator_id = ${userId} and paused_at is null`;
    await audit(deps.sql, null, 'user', userId, 'listings_paused', {
      required: required.toString(),
    });
  }
  return lamports - left;
}

export async function resolveDispute(
  deps: Deps,
  disputeId: string,
  adminId: string,
  body: { status: 'upheld' | 'rejected'; resolution: string; slashLamports?: bigint },
): Promise<void> {
  const rows = await deps.sql<Row[]>`
    select d.*, o.buyer_id, o.total, o.price, o.status as order_status, o.disputed_from, o.listing_id, o.version_id, o.escrow_address, l.creator_id
    from disputes d
    join orders o on o.id = d.order_id
    join listings l on l.id = o.listing_id
    where d.id = ${disputeId}
  `;
  const dispute = rows[0];
  if (!dispute || dispute.status !== 'open')
    throw new HttpError(404, 'NOT_FOUND', 'open dispute not found');
  const now = deps.now();
  // Funds still in an on-chain escrow move only through the program, signed by the resolver.
  const onChain = dispute.escrow_address && dispute.disputed_from !== 'released';
  let settleSig: string | null = null;
  let fundsAlreadyReleased = false;
  if (onChain) {
    const programId = deps.env.escrowProgramId;
    if (!programId)
      throw new HttpError(503, 'ESCROW_MISCONFIGURED', 'ESCROW_PROGRAM_ID is not set');
    const chain = chainOf(deps);
    const address = dispute.escrow_address as string;
    const account = await readEscrow(chain, programId, address);
    if (!account) throw new HttpError(409, 'ESCROW_MISSING', 'escrow account not found');
    if (account.status === 'disputed') {
      const latest = await deps.blockhash();
      const tx =
        body.status === 'upheld'
          ? refundTx(deps.env, address, account, latest.blockhash)
          : rejectDisputeTx(deps.env, address, latest.blockhash);
      settleSig = await chain.sendAndConfirm(tx);
    } else if (account.status === 'released') {
      // The window lapsed and release was cranked before the dispute reached the chain.
      fundsAlreadyReleased = true;
    } else if (body.status === 'upheld') {
      throw new HttpError(
        409,
        'DISPUTE_NOT_ONCHAIN',
        'the buyer has not signed the on-chain dispute yet, so the escrow cannot be refunded',
      );
    }
  }
  if (body.status === 'rejected') {
    const next = dispute.disputed_from === 'released' || fundsAlreadyReleased ? 'released' : 'paid';
    await deps.sql`update orders set status = ${next}::order_status where id = ${dispute.order_id}`;
    await deps.sql`
      update disputes set status = 'rejected', resolution = ${body.resolution}, resolved_by = ${adminId}, resolved_at = ${now}
      where id = ${disputeId}
    `;
    await audit(deps.sql, adminId, 'dispute', disputeId, 'rejected', {
      resolution: body.resolution,
      sig: settleSig,
    });
    return;
  }
  const buyer = await userById(deps.sql, dispute.buyer_id as string);
  if (onChain && !fundsAlreadyReleased) {
    // Refunded by the program in settleSig: the deposit already went back to the buyer.
    await deps.sql`
      insert into ledger (account, delta, ref_type, ref_id)
      values ('escrow', ${-(dispute.total as bigint)}, 'order', ${dispute.order_id})
    `;
    for (const line of refundPayout(dispute.total as bigint, buyer.wallet as string)) {
      await deps.sql`
        insert into payouts (order_id, recipient, bucket, amount, status, tx_sig)
        values (${dispute.order_id}, ${line.recipient}, ${line.bucket}, ${line.amount}, 'sent', ${settleSig})
      `;
    }
    await deps.sql`update orders set refund_sig = ${settleSig} where id = ${dispute.order_id}`;
  } else if (dispute.disputed_from === 'released' || fundsAlreadyReleased) {
    const slashed = await slash(
      deps,
      dispute.creator_id as string,
      dispute.total as bigint,
      dispute.order_id as string,
    );
    const short = (dispute.total as bigint) - slashed;
    if (short > 0n) {
      await deps.sql`
        insert into ledger (account, delta, ref_type, ref_id)
        values ('bucket:safety', ${-short}, 'order', ${dispute.order_id})
      `;
    }
  } else {
    await deps.sql`
      insert into ledger (account, delta, ref_type, ref_id)
      values ('vault', ${-(dispute.total as bigint)}, 'order', ${dispute.order_id})
    `;
  }
  if (!onChain || fundsAlreadyReleased) {
    for (const line of refundPayout(dispute.total as bigint, buyer.wallet as string)) {
      await deps.sql`
        insert into payouts (order_id, recipient, bucket, amount)
        values (${dispute.order_id}, ${line.recipient}, ${line.bucket}, ${line.amount})
      `;
    }
  }
  await deps.sql`update orders set status = 'refunded' where id = ${dispute.order_id}`;
  if (body.slashLamports && body.slashLamports > 0n) {
    await slash(deps, dispute.creator_id as string, body.slashLamports, disputeId);
  }
  if (dispute.reason === 'malicious') {
    await deps.sql`update listings set delisted_at = ${now} where id = ${dispute.listing_id}`;
    await deps.sql`
      update versions set status = 'delisted' where listing_id = ${dispute.listing_id} and status in ('live', 'superseded')
    `;
    await deps.sql`update users set banned_at = ${now} where id = ${dispute.creator_id}`;
    await slash(deps, dispute.creator_id as string, 9_000_000_000_000n, disputeId);
    await audit(deps.sql, adminId, 'user', dispute.creator_id as string, 'banned', { disputeId });
  }
  await deps.sql`
    update disputes set status = 'upheld', resolution = ${body.resolution}, resolved_by = ${adminId}, resolved_at = ${now}
    where id = ${disputeId}
  `;
  await notify(deps.sql, dispute.buyer_id as string, 'dispute', { disputeId, status: 'upheld' });
  await notify(deps.sql, dispute.creator_id as string, 'dispute', { disputeId, status: 'upheld' });
  await audit(deps.sql, adminId, 'dispute', disputeId, 'upheld', { resolution: body.resolution });
}

export async function openDispute(
  deps: Deps,
  orderId: string,
  userId: string,
  reason: string,
  details: string,
) {
  const rows = await deps.sql<Row[]>`select * from orders where id = ${orderId}`;
  const order = rows[0];
  if (!order || order.buyer_id !== userId) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  const allowed = canOpenDispute({
    status: order.status as OrderStatus,
    reason: reason as 'malicious',
    escrowUntil: (order.escrow_until as Date | null) ?? null,
    paidAt: (order.paid_at as Date | null) ?? null,
    now: deps.now(),
  });
  if (!allowed) throw new HttpError(400, 'DISPUTE_CLOSED', 'this order cannot be disputed now');
  const existing = await deps.sql`select id from disputes where order_id = ${orderId}`;
  if (existing.length > 0) throw new HttpError(409, 'DISPUTE_EXISTS', 'a dispute already exists');
  const inserted = await deps.sql<{ id: string }[]>`
    insert into disputes (order_id, opened_by, reason, details)
    values (${orderId}, ${userId}, ${reason}, ${details})
    returning id
  `;
  await deps.sql`
    update orders set disputed_from = status, status = 'disputed' where id = ${orderId}
  `;
  await audit(deps.sql, userId, 'order', orderId, 'disputed', { reason });
  // A dispute inside the window must also reach the chain, or release stays permissionless.
  let txBase64: string | null = null;
  if (order.escrow_address && order.status === 'paid' && deps.env.escrowProgramId) {
    const buyer = await userById(deps.sql, userId);
    const latest = await deps.blockhash();
    txBase64 = openDisputeTx({
      programId: deps.env.escrowProgramId,
      buyer: buyer.wallet as string,
      escrow: order.escrow_address as string,
      recentBlockhash: latest.blockhash,
    });
  }
  return { id: inserted[0]?.id, txBase64 };
}

/** Fresh open_dispute tx for an open dispute whose escrow is still Paid on chain. */
export async function disputeTx(deps: Deps, orderId: string, userId: string) {
  const rows = await deps.sql<Row[]>`select * from orders where id = ${orderId}`;
  const order = rows[0];
  if (!order || order.buyer_id !== userId) throw new HttpError(404, 'NOT_FOUND', 'order not found');
  if (order.status !== 'disputed' || order.disputed_from !== 'paid' || !order.escrow_address)
    throw new HttpError(400, 'NO_ONCHAIN_DISPUTE', 'this order has no escrow dispute to sign');
  const programId = deps.env.escrowProgramId;
  if (!programId) throw new HttpError(503, 'ESCROW_MISCONFIGURED', 'ESCROW_PROGRAM_ID is not set');
  const account = await readEscrow(chainOf(deps), programId, order.escrow_address as string);
  if (account?.status === 'disputed') return { onChain: true, txBase64: null };
  const buyer = await userById(deps.sql, userId);
  const latest = await deps.blockhash();
  const txBase64 = openDisputeTx({
    programId,
    buyer: buyer.wallet as string,
    escrow: order.escrow_address as string,
    recentBlockhash: latest.blockhash,
  });
  await preflightTx(deps, txBase64);
  return { onChain: false, txBase64 };
}

function needsSandbox(category: string, fileName: string): boolean {
  return category === 'userscript' || (category === 'alerts' && /\.js$/i.test(fileName));
}

export type ReviewStep = 'static' | 'sandbox' | 'ai' | 'done';

export type ReviewEvent = {
  step: ReviewStep;
  status: 'running' | 'done' | 'skipped';
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  summary?: string;
  verdict?: string;
  decision?: string;
  versionStatus?: string;
  reason?: string;
  resumeStep?: 'static' | 'sandbox' | 'ai' | null;
  log?: IsolatedSandboxResult;
};

export async function finishVersion(deps: Deps, versionId: string): Promise<ReviewEvent> {
  let last: ReviewEvent = {
    step: 'done',
    status: 'done',
    startedAt: deps.now().toISOString(),
    durationMs: 0,
  };
  for await (const event of reviewVersion(deps, versionId)) last = event;
  return last;
}

type CheckRow = { ruleId: string; result: string; title: string; detail: string };

/** Static scan and the sandbox start together. A runner is webhooks, not a 10s poll. */
export async function* reviewVersion(deps: Deps, versionId: string): AsyncGenerator<ReviewEvent> {
  const rows = await deps.sql<Row[]>`
    select v.*, l.category, l.creator_id, l.id as listing_id
    from versions v join listings l on l.id = v.listing_id
    where v.id = ${versionId}
  `;
  const version = rows[0];
  if (!version) throw new HttpError(404, 'NOT_FOUND', 'version not found');
  const bytes = await deps.blob.get(version.r2_key as string);
  if (!bytes) throw new HttpError(400, 'FILE_MISSING', 'upload is missing');
  const config = await loadConfig(deps);
  const startedAt = deps.now().toISOString();
  const resume = resumeOf(version.resume_step);
  const priorStatic = await deps.sql<{ summary: string }[]>`
    select summary from scans where version_id = ${versionId} and kind = 'static' and summary = 'pass' limit 1
  `;
  const priorSandbox = await deps.sql<{ summary: string }[]>`
    select summary from scans where version_id = ${versionId} and kind = 'sandbox' limit 1
  `;
  const skipStatic = resume !== 'static' && priorStatic.length > 0;
  const sandboxNeeded = needsSandbox(version.category as string, version.file_name as string);
  const skipSandbox = resume === 'ai' && priorSandbox.length > 0;

  if (skipStatic) {
    yield { step: 'static', status: 'skipped', startedAt, durationMs: 0, summary: 'pass' };
  } else {
    yield { step: 'static', status: 'running', startedAt, durationMs: 0 };
  }
  if (!sandboxNeeded) {
    yield { step: 'sandbox', status: 'skipped', startedAt, durationMs: 0, verdict: 'na' };
  } else if (skipSandbox) {
    yield {
      step: 'sandbox',
      status: 'skipped',
      startedAt,
      durationMs: 0,
      verdict: priorSandbox[0]?.summary ?? 'pass',
    };
  } else {
    yield { step: 'sandbox', status: 'running', startedAt, durationMs: 0 };
  }

  const staticWork = skipStatic
    ? Promise.resolve(null)
    : timed(async () => storeStaticScan(deps, version, versionId, bytes, config));
  const sandboxWork =
    sandboxNeeded && !skipSandbox
      ? timed(() =>
          dispatchSandbox({
            runnerUrl: deps.env.sandboxRunnerUrl,
            token: deps.env.internalToken,
            versionId,
            fileName: version.file_name as string,
            source: new TextDecoder().decode(bytes),
            timeoutMs: deps.env.sandboxBudgetMs,
            nowMs: deps.now().getTime(),
            queue: deps.sandboxQueue,
          }).then(
            (result) => ({ ok: true as const, result }),
            // The engine or the runner failed, not the script. Nothing is decided.
            (err: unknown) => ({ ok: false as const, message: sandboxInfraMessage(err) }),
          ),
        )
      : Promise.resolve(null);

  const [staticTimed, sandboxTimed] = await Promise.all([staticWork, sandboxWork]);
  const finishedAt = deps.now().toISOString();
  let checks: CheckRow[];
  let summary = 'pass';
  if (staticTimed) {
    checks = staticTimed.value.checks;
    summary = staticTimed.value.summary;
    yield {
      step: 'static',
      status: 'done',
      startedAt,
      finishedAt,
      durationMs: staticTimed.durationMs,
      summary,
    };
  } else {
    const stored = await deps.sql<Row[]>`
      select sc.rule_id, sc.result, sc.title, sc.detail
      from scan_checks sc join scans s on s.id = sc.scan_id
      where s.version_id = ${versionId} and s.kind = 'static'
    `;
    checks = stored.map((check) => ({
      ruleId: check.rule_id as string,
      result: check.result as string,
      title: check.title as string,
      detail: check.detail as string,
    }));
  }

  let sandboxVerdict: 'pass' | 'warn' | 'fail' | undefined;
  let sandboxWalletCalls: string[] | undefined;
  if (sandboxTimed && !sandboxTimed.value.ok) {
    // Retryable: no AI verdict, no sandbox scan row, the creator can rerun the review.
    const reason = `The sandbox could not run (${sandboxTimed.value.message}). Nothing was decided; retry the review.`;
    await deps.sql`delete from scans where version_id = ${versionId} and kind = 'sandbox'`;
    await deps.sql`
      update versions set status = 'needs_creator', resume_step = 'sandbox' where id = ${versionId}
    `;
    yield {
      step: 'sandbox',
      status: 'done',
      startedAt,
      finishedAt,
      durationMs: sandboxTimed.durationMs,
      verdict: 'error',
      reason,
    };
    yield {
      step: 'done',
      status: 'done',
      startedAt,
      finishedAt,
      durationMs: 0,
      decision: 'retry',
      versionStatus: 'needs_creator',
      reason,
      resumeStep: 'sandbox',
    };
    return;
  }
  if (sandboxTimed && sandboxTimed.value.ok) {
    const run = sandboxTimed.value.result;
    await recordSandbox(deps, versionId, run);
    sandboxVerdict = run.verdict;
    sandboxWalletCalls = run.walletCalls;
    yield {
      step: 'sandbox',
      status: 'done',
      startedAt,
      finishedAt,
      durationMs: run.durationMs || sandboxTimed.durationMs,
      verdict: sandboxVerdict,
      log: run,
    };
  } else if (skipSandbox) {
    sandboxVerdict = (priorSandbox[0]?.summary as 'pass' | 'warn' | 'fail') ?? 'pass';
  }

  const aiStarted = Date.now();
  yield { step: 'ai', status: 'running', startedAt, durationMs: 0 };
  const outcome = await decideWithAgent(
    deps,
    version,
    checks,
    summary,
    sandboxVerdict,
    sandboxWalletCalls,
  );
  const aiDone = {
    step: 'ai' as const,
    status: 'done' as const,
    startedAt,
    finishedAt,
    durationMs: Date.now() - aiStarted,
    decision: outcome.decision,
    versionStatus: outcome.versionStatus,
    reason: outcome.reason,
    resumeStep: outcome.resumeStep,
  };
  yield aiDone;
  yield { ...aiDone, step: 'done' };
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const start = Date.now();
  const value = await work();
  return { value, durationMs: Math.max(0, Date.now() - start) };
}

function resumeOf(value: unknown): 'static' | 'sandbox' | 'ai' {
  return value === 'sandbox' || value === 'ai' ? value : 'static';
}

function sandboxInfraMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'sandbox dispatch failed';
  return message.slice(0, 300);
}

/** Script errors never pass: a timeout or OOM fails, an exception warns. */
function runtimeCheck(errors: string[], verdict: string) {
  const fatal = errors.some((item) => /timed out|out of memory|memory limit/i.test(item));
  return {
    ruleId: 'sandbox-runtime',
    result: errors.length === 0 ? 'pass' : fatal || verdict === 'fail' ? 'fail' : 'warn',
    title: 'Sandbox runtime',
    detail: errors.length
      ? `Script errors: ${errors.slice(0, 5).join('; ').slice(0, 900)}`
      : 'Ran without errors.',
  };
}

async function storeStaticScan(
  deps: Deps,
  version: Row,
  versionId: string,
  bytes: Uint8Array,
  config: AppConfig,
): Promise<{ summary: string; checks: CheckRow[] }> {
  const output = await scan(
    { name: version.file_name as string, bytes },
    version.category as string,
    {
      blocklistHosts: config.blocklist_hosts,
      requireAllowHosts: config.require_allow_hosts,
      antivirus: deps.env.clamavUrl
        ? clamAvHttpClient(deps.env.clamavUrl, { token: deps.env.clamavToken || undefined })
        : undefined,
    },
  );
  await deps.sql`delete from scans where version_id = ${versionId} and kind = 'static'`;
  const scanRow = await deps.sql<{ id: string }[]>`
    insert into scans (version_id, kind, finished_at, engine_ver, summary, raw)
    values (${versionId}, 'static', ${deps.now()}, ${output.engineVer}, ${output.summary}::check_result, ${deps.sql.json(output as never)})
    returning id
  `;
  const scanId = scanRow[0]?.id;
  if (!scanId) throw new HttpError(500, 'SCAN_FAILED', 'could not store the scan');
  for (const check of output.checks) {
    await deps.sql`
      insert into scan_checks (scan_id, rule_id, result, title, detail, locations)
      values (${scanId}, ${check.ruleId}, ${check.result}::check_result, ${check.title}, ${check.detail}, ${deps.sql.json(check.locations as never)})
    `;
  }
  const hash = await sha256Hex(bytes);
  version.sha256 = hash;
  await deps.sql`update versions set declared = ${deps.sql.json(output.declared as never)}, sha256 = ${hash} where id = ${versionId}`;
  return {
    summary: output.summary,
    checks: output.checks.map((check) => ({
      ruleId: check.ruleId,
      result: check.result,
      title: check.title,
      detail: check.detail,
    })),
  };
}

async function recordSandbox(
  deps: Deps,
  versionId: string,
  raw: IsolatedSandboxResult,
): Promise<void> {
  const walletCalls = raw.walletCalls;
  const requests = raw.requests;
  const verdict = raw.verdict;
  const checks = [
    {
      ruleId: 'sandbox-wallet-calls',
      result: walletCalls.length ? 'fail' : 'pass',
      title: 'Sandbox wallet calls',
      detail: walletCalls.length ? `Signing calls: ${walletCalls.join(', ')}` : 'No signing calls.',
    },
    {
      ruleId: 'sandbox-network',
      result: requests.length ? 'warn' : 'pass',
      title: 'Sandbox network',
      detail: requests.length
        ? `Hosts: ${requests.map((item) => item.host).join(', ')}`
        : 'No outbound hosts.',
    },
    runtimeCheck(raw.errors ?? [], verdict),
  ];
  await deps.sql`delete from scans where version_id = ${versionId} and kind = 'sandbox'`;
  const scanRow = await deps.sql<{ id: string }[]>`
    insert into scans (version_id, kind, finished_at, engine_ver, summary, raw)
    values (${versionId}, 'sandbox', ${deps.now()}, ${SANDBOX_ENGINE}, ${verdict}::check_result, ${deps.sql.json(raw as never)})
    returning id
  `;
  const scanId = scanRow[0]?.id;
  if (!scanId) return;
  for (const check of checks) {
    await deps.sql`
      insert into scan_checks (scan_id, rule_id, result, title, detail, locations)
      values (${scanId}, ${check.ruleId}, ${check.result}::check_result, ${check.title}, ${check.detail}, '[]'::jsonb)
    `;
  }
}

export async function storeSandbox(
  deps: Deps,
  versionId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const walletCalls = Array.isArray(raw.walletCalls) ? (raw.walletCalls as string[]) : [];
  const requests = Array.isArray(raw.requests) ? (raw.requests as { host?: string }[]) : [];
  const errors = Array.isArray(raw.errors) ? raw.errors.map(String) : [];
  const runtime = runtimeCheck(errors, String(raw.verdict));
  const verdict =
    raw.verdict === 'fail' || walletCalls.length > 0 || runtime.result === 'fail'
      ? 'fail'
      : raw.verdict === 'warn' || runtime.result === 'warn' || requests.length > 0
        ? 'warn'
        : 'pass';
  const checks = [
    {
      ruleId: 'sandbox-wallet-calls',
      result: walletCalls.length ? 'fail' : 'pass',
      title: 'Sandbox wallet calls',
      detail: walletCalls.length ? `Signing calls: ${walletCalls.join(', ')}` : 'No signing calls.',
      locations: [],
    },
    {
      ruleId: 'sandbox-network',
      result: requests.length ? 'warn' : 'pass',
      title: 'Sandbox network',
      detail: requests.length
        ? `Hosts: ${requests.map((item) => item.host).join(', ')}`
        : 'No outbound hosts.',
      locations: [],
    },
    { ...runtime, locations: [] },
  ];
  const summary = verdict;
  await deps.sql`delete from scans where version_id = ${versionId} and kind = 'sandbox'`;
  const scanRow = await deps.sql<{ id: string }[]>`
    insert into scans (version_id, kind, finished_at, engine_ver, summary, raw)
    values (${versionId}, 'sandbox', ${deps.now()}, ${SANDBOX_ENGINE}, ${summary}::check_result, ${deps.sql.json(raw as never)})
    returning id
  `;
  const scanId = scanRow[0]?.id;
  if (scanId) {
    for (const check of checks) {
      await deps.sql`
        insert into scan_checks (scan_id, rule_id, result, title, detail, locations)
        values (${scanId}, ${check.ruleId}, ${check.result}::check_result, ${check.title}, ${check.detail}, '[]'::jsonb)
      `;
    }
  }
  await deps.sql`update sandbox_jobs set status = 'done' where version_id = ${versionId}`;
  const versionRows = await deps.sql<Row[]>`
    select v.*, l.category, l.creator_id, l.id as listing_id from versions v
    join listings l on l.id = v.listing_id where v.id = ${versionId}
  `;
  const version = versionRows[0];
  if (!version) return;
  const staticScan = await deps.sql<Row[]>`
    select summary from scans where version_id = ${versionId} and kind = 'static' order by started_at desc limit 1
  `;
  const staticChecks = await deps.sql<Row[]>`
    select sc.rule_id, sc.result, sc.title, sc.detail
    from scan_checks sc join scans s on s.id = sc.scan_id
    where s.version_id = ${versionId} and s.kind = 'static'
  `;
  if (staticScan[0]?.summary === 'fail' || summary === 'fail') {
    await deps.sql`update versions set status = 'rejected' where id = ${versionId}`;
    return;
  }
  await decideWithAgent(
    deps,
    version,
    staticChecks.map((check) => ({
      ruleId: check.rule_id as string,
      result: check.result as string,
      title: check.title as string,
      detail: check.detail as string,
    })),
    (staticScan[0]?.summary as string) ?? 'pass',
    verdict,
    walletCalls,
  );
}

/**
 * Optional model review. Runs only when LLM_API_KEY, LLM_BASE_URL and LLM_MODEL are all set and
 * the rules did not already reject. A model failure keeps the rules verdict and says so.
 */
async function modelVerdict(
  deps: Deps,
  version: Row,
  checks: { ruleId: string; result: string; title: string; detail: string }[],
  rules: { decision: string },
  sandboxVerdict?: 'pass' | 'warn' | 'fail',
  sandboxWalletCalls?: string[],
): Promise<{ verdict: LlmVerdict | null; note: string | null }> {
  const config = {
    ...deps.env.llm,
    reasoningEffort: deps.env.llm.reasoningEffort || undefined,
    fetch: deps.llmFetch,
  };
  if (!llmConfigured(config) || rules.decision === 'reject') return { verdict: null, note: null };
  try {
    const listing = (
      await deps.sql<Row[]>`
        select l.title, l.description, l.summary, c.live as content
        from listings l left join listing_content c on c.listing_id = l.id
        where l.id = ${version.listing_id}
      `
    )[0];
    const content = (listing?.content ?? {}) as { readme?: unknown; howto?: unknown };
    const docs = [listing?.summary, content.readme, content.howto]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n\n');
    const bytes = await deps.blob.get(version.r2_key as string);
    const text = bytes ? new TextDecoder().decode(bytes) : '';
    const excerpt = text.slice(0, LLM_EXCERPT_CHARS);
    const hosts = checks
      .filter((check) => check.ruleId === 'sandbox-network' && check.result !== 'pass')
      .map((check) => check.detail);
    const verdict = await runLlmReview(config, {
      title: String(listing?.title ?? ''),
      description: String(listing?.description ?? ''),
      declared: version.declared,
      fileName: String(version.file_name),
      docs,
      fileExcerpt: excerpt,
      fileTotalChars: text.length,
      creatorNote: (version.creator_note as string | null) ?? null,
      checks,
      sandbox: {
        verdict: sandboxVerdict ?? null,
        walletCalls: sandboxWalletCalls ?? [],
        hosts,
      },
    });
    const coverage =
      text.length > LLM_EXCERPT_CHARS
        ? ` (The model saw the first ${LLM_EXCERPT_CHARS} of ${text.length} characters.)`
        : '';
    return { verdict: { ...verdict, notes: `${verdict.notes}${coverage}` }, note: null };
  } catch (err) {
    return {
      verdict: null,
      note: `Model review unavailable (${(err as Error).message.slice(0, 80)}); rules verdict only.`,
    };
  }
}

async function decideWithAgent(
  deps: Deps,
  version: Row,
  checks: { ruleId: string; result: string; title: string; detail: string }[],
  summary: string,
  sandboxVerdict?: 'pass' | 'warn' | 'fail',
  sandboxWalletCalls?: string[],
): Promise<{
  decision: string;
  versionStatus: string;
  reason: string;
  resumeStep: 'static' | 'sandbox' | 'ai' | null;
}> {
  const rules = runAiVerifier({
    checks,
    creatorNote: version.creator_note as string | null,
    sandboxVerdict: sandboxVerdict ?? null,
    sandboxWalletCalls,
    agentId: deps.env.aiAgentId,
  });
  const model = await modelVerdict(
    deps,
    version,
    checks,
    rules,
    sandboxVerdict,
    sandboxWalletCalls,
  );
  const decision = combineVerdicts(rules, model.verdict);
  const engine = model.verdict ? `${RULES_ENGINE}+llm` : RULES_ENGINE;
  const issuedAt = deps.now().toISOString();
  const message = attestationMessage({
    versionId: version.id as string,
    sha256: version.sha256 as string,
    decision: decision.decision,
    issuedAt,
  });
  const signature = await signAttestation(message, deps.env.aiAttestSecret);
  await deps.sql`
    insert into ai_reviews (version_id, agent_id, decision, notes, attestation, signature, credit_lamports, engine, model)
    values (
      ${version.id}, ${decision.agentId}, ${decision.decision}, ${model.note ? `${decision.notes} ${model.note}` : decision.notes}, ${message}, ${signature}, 0, ${engine}, ${model.verdict?.model ?? null}
    )
  `;
  if (decision.decision === 'approve' && summary !== 'fail') {
    await deps.sql`
      update versions set status = 'superseded'
      where listing_id = ${version.listing_id} and status = 'live' and id <> ${version.id}
    `;
    await deps.sql`update versions set status = 'live' where id = ${version.id}`;
    await deps.sql`
      update listings set live_version_id = ${version.id},
        first_live_at = coalesce(first_live_at, ${deps.now()})
      where id = ${version.listing_id}
    `;
    await deps.sql`update versions set resume_step = null where id = ${version.id}`;
    await notify(deps.sql, version.creator_id as string, 'live', { versionId: version.id });
    return {
      decision: decision.decision,
      versionStatus: 'live',
      reason: decision.notes,
      resumeStep: null,
    };
  }
  if (decision.decision === 'reject') {
    await deps.sql`update versions set status = 'rejected', resume_step = null where id = ${version.id}`;
    return {
      decision: decision.decision,
      versionStatus: 'rejected',
      reason: decision.notes,
      resumeStep: null,
    };
  }
  const resumeStep =
    summary === 'warn' || summary === 'fail'
      ? 'static'
      : sandboxVerdict === 'warn' || sandboxVerdict === 'fail'
        ? 'sandbox'
        : 'ai';
  await deps.sql`update versions set status = 'needs_creator', resume_step = ${resumeStep} where id = ${version.id}`;
  return {
    decision: decision.decision,
    versionStatus: 'needs_creator',
    reason: decision.notes,
    resumeStep,
  };
}

export async function watermarked(
  bytes: Uint8Array,
  fileName: string,
  orderId: string,
  wallet: string,
  hash: string,
) {
  if (fileName.toLowerCase().endsWith('.zip')) {
    const files = unzipSync(bytes);
    files[ZIP_LICENSE_NAME] = strToU8(zipLicenseText(orderId, wallet, hash));
    return zipSync(files);
  }
  const text = new TextDecoder().decode(bytes);
  return new TextEncoder().encode(watermarkText(text, orderId, wallet, hash, fileName));
}

export async function ledgerVault(sql: Sql): Promise<bigint> {
  const rows = await sql<{ sum: bigint }[]>`
    select coalesce(sum(delta), 0)::bigint as sum from ledger where account = 'vault'
  `;
  return rows[0]?.sum ?? 0n;
}

export function ipHash(ip: string, secret: string): string {
  return createHash('sha256').update(`${ip}:${secret}`).digest('hex');
}

export function solLabel(lamports: bigint): string {
  return formatSol(lamports);
}

export const MOCK_LANDING_STATS = {
  source: 'mock' as const,
  listings: 8,
  creators: 4,
  orders: 128,
  volumeLamports: '11500000000',
  note: 'Sample figures until a live listing exists.',
};

export async function landingStats(deps: Deps) {
  const rows = await deps.sql<
    { listings: number; creators: number; orders: number; volume: bigint }[]
  >`
    select
      (select count(*)::int from listings where live_version_id is not null and delisted_at is null) as listings,
      (select count(distinct creator_id)::int from listings where live_version_id is not null and delisted_at is null) as creators,
      (select count(*)::int from orders where status in ('paid', 'released')) as orders,
      (select coalesce(sum(price), 0)::bigint from orders where status in ('paid', 'released')) as volume
  `;
  const row = rows[0] ?? { listings: 0, creators: 0, orders: 0, volume: 0n };
  // Sample figures only when explicitly asked for (local demos). Production always shows real counts.
  if (deps.env.landingStats === 'mock') {
    return MOCK_LANDING_STATS;
  }
  return {
    source: 'live' as const,
    listings: row.listings,
    creators: row.creators,
    orders: row.orders,
    volumeLamports: (row.volume ?? 0n).toString(),
    note: null as string | null,
  };
}
