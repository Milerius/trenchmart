// $MART holder rewards (docs/ops/holder-rewards.md).
//
// Every epoch (3 h) holders get 50% of NET platform revenue: revenue that paid the rewards vault
// (Squads vault index 1, via the fee split's buyback slot), minus ledgered costs. Eligibility:
// the top N (1000) holders by their LOWEST balance across 6 random samples in the epoch, holding
// at least 0.05% of supply in this epoch and the previous one. Shares under 0.01 SOL carry over.
//
// Money path: one Squads spending_limit_use (rewards vault → rewards hot wallet, the limit's only
// destination) per epoch, then plain SOL transfers from the hot wallet in batches of 20 per
// transaction. Batches use the payouts pattern: sign, store the signature and the blockhash
// expiry (claim), then broadcast; reconcile confirms or retries only after expiry.
//
// Subrequest budget per cron tick: ≤ 2 for a sample, ≤ 3 for funding, 1 status read, and at most
// REWARDS_INLINE_BATCHES sends. Batches normally go through a Cloudflare Queue (one batch per
// message, own budget).
import { createHmac } from 'node:crypto';
import bs58 from 'bs58';
import {
  compileLegacyTx,
  computeBudgetIxs,
  decodeSpendingLimit,
  effectiveRemaining,
  fromBase64,
  isOnCurve,
  NATIVE_MINT_DEFAULT,
  parseSecretKey,
  publicKeyOf,
  rpc,
  signatureOf,
  signTx,
  spendingLimitUseSolIx,
  SQUADS_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  vaultPda,
  type Instruction,
  type SpendingLimitAccount,
} from '@trenchmart/chain';
import {
  allocate,
  chunk,
  epochBounds,
  epochIdAt,
  holderGrossOf,
  onChainSplitBps,
  rankHolders,
  REWARD_DEFAULTS,
  sampleTicks,
  txFeeLamports,
  type Candidate,
} from '@trenchmart/shared/rewards';
import type { FeeSplitBps, PayoutLine } from '@trenchmart/shared/payouts';
import type { AppConfig } from '@trenchmart/shared/config';
import type { Env } from './env';
import type { Deps } from './logic';
import { rpcPayoutChain, type PayoutChain } from './payouts-auto';

type Row = Record<string, any>;

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP7VEhdkAS6EHFLC1qHnU2gZ1U8P2sY';
export const REWARD_MAX_ATTEMPTS = 5;
/** Batches the cron itself may send per tick when no queue is bound (or a message was lost). */
export const REWARDS_INLINE_BATCHES = 2;
/** The hot wallet pays fees; warn below this. */
export const REWARD_SIGNER_MIN_LAMPORTS = 20_000_000n;
/** Vault rent floor, never spent. */
const VAULT_FLOOR = 1_000_000n;
/** Code ceiling for one epoch's funding; env can only lower it. */
export const REWARD_EPOCH_CEILING = 50_000_000_000n;
const FUND_SIGNATURES = 1;
/** Compute limit of the funding transaction (Squads spending_limit_use). */
const FUND_UNITS = 60_000;
/**
 * The funding tx loads the Squads v4 program (its program data is over 1 MiB): with the 64 KiB
 * batch limit it failed with MaxLoadedAccountsDataSizeExceeded and never landed (devnet
 * 2026-10-22; 1 MiB also fails, 2 MiB passes). 3 MiB leaves room for a Squads upgrade.
 */
export const FUND_LOADED_BYTES = 3 * 1024 * 1024;

export type RewardChain = PayoutChain & {
  /** One getProgramAccounts: every token account of `mint`, as (owner, amount). */
  tokenHolders(mint: string, programId: string): Promise<{ owner: string; amount: bigint }[]>;
};
export type RewardQueue = { sendBatch(messages: { body: unknown }[]): Promise<void> };

export function rpcRewardChain(url: string): RewardChain {
  return {
    ...rpcPayoutChain(url),
    async tokenHolders(mint, programId) {
      const filters: unknown[] = [{ memcmp: { offset: 0, bytes: mint } }];
      // Token-2022 accounts carry extensions (size varies); classic accounts are exactly 165.
      if (programId === TOKEN_PROGRAM_ID) filters.unshift({ dataSize: 165 });
      const result = (await rpc(url, 'getProgramAccounts', [
        programId,
        {
          encoding: 'base64',
          commitment: 'confirmed',
          dataSlice: { offset: 32, length: 40 },
          filters,
        },
      ])) as { account: { data: [string, string] } }[];
      return result.map((r) => {
        const d = fromBase64(r.account.data[0]);
        const amount = new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(32, true);
        return { owner: bs58.encode(d.slice(0, 32)), amount };
      });
    },
  };
}

export function rewardChainOf(deps: Deps): RewardChain {
  return deps.rewardChain ?? rpcRewardChain(deps.env.rpcUrl);
}

// ---------------------------------------------------------------------------------------------
// Fee routing: where the holders' share of each fee goes.

export function rewardsVaultOf(env: Env): string | null {
  if (!env.multisigAddress) return null;
  return vaultPda(env.multisigAddress, env.rewards.vaultIndex);
}

/** Buckets and 4-slot split for new fees: holders + buyback ride in the buyback slot. */
export function feeRouting(
  env: Env,
  config: Pick<AppConfig, 'fee_split_bps'>,
): { buckets: Env['buckets']; splitBps: FeeSplitBps } {
  const vault = env.rewards.splitActive ? rewardsVaultOf(env) : null;
  if (!vault) return { buckets: env.buckets, splitBps: config.fee_split_bps };
  return {
    buckets: { ...env.buckets, buyback: vault },
    splitBps: onChainSplitBps(config.fee_split_bps),
  };
}

/**
 * Counts one released revenue item for the epoch it was released in. Only what actually paid
 * the rewards vault counts (older orders keep the split they were created with). Idempotent.
 */
export async function recordRevenue(
  deps: Pick<Deps, 'sql' | 'env' | 'now'>,
  input: {
    source: 'order' | 'vfee' | 'featuring' | 'supplement' | 'renewal';
    ref: string;
    netFee: bigint;
    lines: PayoutLine[];
    at?: Date;
  },
): Promise<void> {
  const vault = rewardsVaultOf(deps.env);
  if (!vault || input.netFee <= 0n) return;
  const slot = input.lines
    .filter((l) => l.recipient === vault && l.bucket !== 'creator')
    .reduce((s, l) => s + l.amount, 0n);
  if (slot <= 0n) return;
  const at = input.at ?? deps.now();
  const epoch = epochIdAt(at.getTime(), deps.env.rewards.epochSeconds);
  await deps.sql`
    insert into reward_revenue (source, ref, net_fee, slot_lamports, holder_gross, released_at, epoch_id)
    values (${input.source}, ${input.source + ':' + input.ref}, ${input.netFee}, ${slot},
      ${holderGrossOf(input.netFee, slot)}, ${at}, ${epoch})
    on conflict (ref) do nothing
  `;
}

// ---------------------------------------------------------------------------------------------
// Configuration

export type RewardConfig = {
  mint: string;
  multisig: string;
  vault: string;
  vaultIndex: number;
  epochSeconds: number;
  topN: number;
  minSupplyBps: number;
  minPayout: bigint;
  maxEpoch: bigint;
  /** Present only when sending is configured and REWARDS_AUTO is not 0. */
  send: { secret: Uint8Array; signer: string; spendingLimit: string } | null;
};

export function rewardConfig(env: Env): RewardConfig | null {
  if (!env.martMint || !env.multisigAddress) return null;
  const r = env.rewards;
  const vault = vaultPda(env.multisigAddress, r.vaultIndex);
  if (vault === env.vaultAddress) throw new Error('rewards vault must not be vault 0');
  let send: RewardConfig['send'] = null;
  if (r.enabled && r.signerSecret && r.spendingLimit) {
    const secret = parseSecretKey(r.signerSecret);
    const signer = publicKeyOf(secret);
    if (signer === vault) throw new Error('rewards signer must not be the vault');
    send = { secret, signer, spendingLimit: r.spendingLimit };
  }
  return {
    mint: env.martMint,
    multisig: env.multisigAddress,
    vault,
    vaultIndex: r.vaultIndex,
    epochSeconds: r.epochSeconds,
    topN: Math.min(r.topN, REWARD_DEFAULTS.topN),
    minSupplyBps: r.minSupplyBps,
    minPayout: r.minPayoutLamports > 0n ? r.minPayoutLamports : REWARD_DEFAULTS.minPayoutLamports,
    maxEpoch: r.maxEpochLamports < REWARD_EPOCH_CEILING ? r.maxEpochLamports : REWARD_EPOCH_CEILING,
    send,
  };
}

export function signerPubkey(env: Env): string | null {
  try {
    return env.rewards.signerSecret ? publicKeyOf(parseSecretKey(env.rewards.signerSecret)) : null;
  } catch {
    return null;
  }
}

/** Addresses that never earn: treasury, vaults, hot wallets, buckets, the mint, the program. */
function builtinExclusions(deps: Deps, cfg: RewardConfig): Set<string> {
  const e = deps.env;
  const out = new Set<string>([
    cfg.vault,
    cfg.multisig,
    cfg.mint,
    vaultPda(cfg.multisig, 0),
    e.vaultAddress,
    e.buckets.buyback,
    e.buckets.ai_verification,
    e.buckets.ops,
    e.buckets.safety,
    e.escrowProgramId,
    e.escrowResolver,
    '1nc1nerator11111111111111111111111111111111',
  ]);
  const signer = signerPubkey(e);
  if (signer) out.add(signer);
  try {
    if (e.payout.signerSecret) out.add(publicKeyOf(parseSecretKey(e.payout.signerSecret)));
  } catch {
    /* ignore */
  }
  out.delete('');
  return out;
}

/** Owners that are PDAs (off-curve: bonding curves, AMM/LP vaults, program accounts) never earn. */
export function isProgramOwned(owner: string): boolean {
  try {
    return !isOnCurve(bs58.decode(owner));
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Epochs and sampling

function seedOf(deps: Deps, epochId: number): string {
  return createHmac('sha256', deps.env.sessionSecret)
    .update(`tm-reward-seed:${epochId}`)
    .digest('hex');
}

function ticksPerEpoch(cfg: RewardConfig): number {
  return Math.max(1, Math.floor(cfg.epochSeconds / REWARD_DEFAULTS.tickSeconds));
}

/**
 * Ticks samples may be scheduled on: every tick but the last. A sample whose cron tick is
 * missed (deploy, Worker error, RPC failure) is taken on the next tick, so the last tick is kept
 * free as catch-up room. Without it a 900 s epoch (3 ticks, 3 samples) lost the epoch on any
 * single missed tick (REWARD_SNAPSHOT_MISSED, devnet 2026-10-22 15:00). 3 h: 35 of 36 ticks.
 */
function sampleRange(cfg: RewardConfig): number {
  const ticks = ticksPerEpoch(cfg);
  return ticks > 1 ? ticks - 1 : 1;
}

export async function ensureEpoch(deps: Deps, cfg: RewardConfig, epochId: number): Promise<Row> {
  const { start, end } = epochBounds(epochId, cfg.epochSeconds);
  const seed = seedOf(deps, epochId);
  const ticks = sampleTicks(seed, sampleRange(cfg), REWARD_DEFAULTS.samplesPerEpoch);
  await deps.sql`
    insert into reward_epochs (epoch_id, starts_at, ends_at, seed, sample_ticks)
    values (${epochId}, ${start}, ${end}, ${seed}, ${ticks})
    on conflict (epoch_id) do nothing
  `;
  const [row] = await deps.sql<Row[]>`select * from reward_epochs where epoch_id = ${epochId}`;
  return row!;
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

/** Takes the next due balance sample of the open epoch (≤ 2 subrequests). */
export async function sampleIfDue(
  deps: Deps,
  cfg: RewardConfig,
  chain: RewardChain,
  epoch: Row,
): Promise<boolean> {
  const done = epoch.samples_done as number;
  const ticks = epoch.sample_ticks as number[];
  if (done >= ticks.length || epoch.status !== 'open') return false;
  const tick = Math.floor(
    (deps.now().getTime() - new Date(epoch.starts_at).getTime()) /
      1000 /
      REWARD_DEFAULTS.tickSeconds,
  );
  if (tick < ticks[done]!) return false;
  const [mint] = await chain.accounts([cfg.mint]);
  // Pre-launch: the mint account does not exist yet. Skip the sample quietly (no holders,
  // everyone stays at the base tier) instead of failing every cron tick.
  if (!mint) return false;
  // A pre-launch address can hold lamports as a plain system account: not a mint yet, skip too.
  if (mint.owner === '11111111111111111111111111111111' || mint.data.length === 0) return false;
  if (mint.owner !== TOKEN_PROGRAM_ID && mint.owner !== TOKEN_2022_PROGRAM_ID)
    throw new Error('$MART mint is not owned by a token program');
  const supply = readU64(mint.data, 36);
  const minBalance = (supply * BigInt(cfg.minSupplyBps)) / 10_000n;
  const accounts = await chain.tokenHolders(cfg.mint, mint.owner);
  const excluded = builtinExclusions(deps, cfg);
  const listed = await deps.sql<{ address: string }[]>`select address from reward_exclusions`;
  for (const r of listed) excluded.add(r.address);
  const byOwner = new Map<string, bigint>();
  for (const a of accounts) {
    if (a.amount === 0n) continue;
    byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0n) + a.amount);
  }
  const owners: string[] = [];
  const amounts: string[] = [];
  for (const [owner, amount] of byOwner) {
    if (amount < minBalance || amount === 0n || excluded.has(owner) || isProgramOwned(owner))
      continue;
    owners.push(owner);
    amounts.push(amount.toString());
  }
  await deps.sql.begin(async (sql) => {
    const claimed = await sql`
      update reward_epochs set samples_done = samples_done + 1,
        supply = coalesce(supply, ${supply}), min_balance = coalesce(min_balance, ${minBalance})
      where epoch_id = ${epoch.epoch_id} and samples_done = ${done} and status = 'open'
      returning epoch_id
    `;
    if (claimed.length === 0) return;
    if (done === 0) {
      if (owners.length)
        await sql`
          insert into reward_balances (epoch_id, owner, min_amount, samples)
          select ${epoch.epoch_id}, o, a, 1 from unnest(${owners}::text[], ${amounts}::numeric[]) as t(o, a)
          on conflict (epoch_id, owner) do nothing
        `;
    } else {
      // Missing from this sample (sold or below the floor) → lowest balance becomes 0.
      await sql`
        update reward_balances b set
          min_amount = least(b.min_amount, coalesce(t.a, 0)),
          samples = b.samples + 1
        from reward_balances b2
        left join unnest(${owners}::text[], ${amounts}::numeric[]) as t(o, a) on t.o = b2.owner
        where b.epoch_id = ${epoch.epoch_id} and b2.epoch_id = b.epoch_id and b2.owner = b.owner
      `;
    }
    if (owners.length)
      await sql`
        insert into reward_holders (owner, first_seen_at)
        select o, ${deps.now()} from unnest(${owners}::text[]) as t(o)
        on conflict (owner) do nothing
      `;
  });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Close: revenue, costs, eligibility, allocation, batches (one DB transaction, no RPC).

type Plan = {
  costs: Record<'rpc' | 'network_fee' | 'priority_fee' | 'payout_fee' | 'infra', bigint>;
  pool: bigint;
  reserve: bigint;
  alloc: ReturnType<typeof allocate>;
  batches: { owner: string; lamports: bigint; kind: 'holder' | 'buyback' }[][];
  fund: bigint;
};

function plan(
  deps: Deps,
  cfg: RewardConfig,
  input: {
    holderGross: bigint;
    carryIn: bigint;
    buyback: bigint;
    ranked: Candidate[];
    carries: Map<string, bigint>;
  },
): Plan {
  const fee = txFeeLamports(1);
  const fundFee = txFeeLamports(FUND_SIGNATURES, FUND_UNITS);
  let txs = Math.ceil((input.ranked.length + (input.buyback > 0n ? 1 : 0)) / 20);
  let last: Plan | null = null;
  // Fees depend on how many get paid, which depends on the pool after fees: iterate to a fixpoint
  // (at most a few rounds; the first round is an upper bound, so a non-converging case is safe).
  for (let round = 0; round < 4; round++) {
    const anyTx = txs > 0 || input.buyback > 0n;
    const costs = {
      rpc: deps.env.rewards.rpcCostLamports,
      infra: deps.env.rewards.infraCostLamports,
      network_fee: fee.network * BigInt(txs),
      priority_fee: fee.priority * BigInt(txs) + (anyTx ? fundFee.priority : 0n),
      payout_fee: anyTx ? 5000n * BigInt(FUND_SIGNATURES) : 0n,
    };
    const total = Object.values(costs).reduce((a, b) => a + b, 0n);
    const holderNet = input.holderGross - (total + 1n) / 2n;
    const pool = (holderNet > 0n ? holderNet : 0n) + input.carryIn;
    const reserve = input.holderGross - (holderNet > 0n ? holderNet : 0n);
    const alloc = allocate(pool, input.ranked, input.carries, cfg.minPayout);
    const pay = alloc.rows
      .filter((r) => r.status === 'pay')
      .map((r) => ({ owner: r.owner, lamports: r.lamports, kind: 'holder' as const }));
    const items = [
      ...(input.buyback > 0n && deps.env.buckets.buyback
        ? [{ owner: deps.env.buckets.buyback, lamports: input.buyback, kind: 'buyback' as const }]
        : []),
      ...pay,
    ];
    const batches = chunk(items, REWARD_DEFAULTS.recipientsPerTx);
    const feeBudget = costs.network_fee + costs.priority_fee + costs.payout_fee;
    const sent = items.reduce((s, i) => s + i.lamports, 0n);
    last = { costs, pool, reserve, alloc, batches, fund: sent > 0n ? sent + feeBudget : 0n };
    if (batches.length === txs) break;
    txs = batches.length;
  }
  return last!;
}

export async function closeEpoch(deps: Deps, cfg: RewardConfig, epoch: Row): Promise<string> {
  const id = Number(epoch.epoch_id);
  // The epoch that starts when this one ends under the CURRENT length (REWARDS_EPOCH_SECONDS
  // may have changed since this row was opened, so never assume id + 1).
  const nextId = epochIdAt(new Date(epoch.ends_at).getTime(), cfg.epochSeconds);
  await ensureEpoch(deps, cfg, nextId);
  const required = (epoch.sample_ticks as number[]).length;
  const [rev] = await deps.sql<Row[]>`
    select coalesce(sum(net_fee), 0)::bigint as revenue, coalesce(sum(slot_lamports), 0)::bigint as slot,
      coalesce(sum(holder_gross), 0)::bigint as holder_gross
    from reward_revenue where epoch_id = ${id}
  `;
  const revenue = BigInt(rev!.revenue);
  const slot = BigInt(rev!.slot);
  const holderGross = BigInt(rev!.holder_gross);
  const buyback = slot - holderGross;
  const complete = (epoch.samples_done as number) >= required;
  // Eligible: every sample of this epoch AND every sample of the previous one at or above the
  // floor (2-epoch hold). Weight = lowest balance seen this epoch.
  const rows = complete
    ? await deps.sql<Row[]>`
        select b.owner, b.min_amount::text as weight, h.first_seen_at
        from reward_balances b
        join reward_epochs e on e.epoch_id = b.epoch_id
        join reward_epochs pe on pe.ends_at = e.starts_at
        join reward_balances p on p.epoch_id = pe.epoch_id and p.owner = b.owner
        join reward_holders h on h.owner = b.owner
        where b.epoch_id = ${id}
          and b.samples = e.samples_done and b.min_amount >= coalesce(e.min_balance, 0) and b.min_amount > 0
          and p.samples = pe.samples_done and p.min_amount >= coalesce(pe.min_balance, 0) and p.min_amount > 0
          and pe.samples_done > 0
          and not exists (select 1 from reward_exclusions x where x.address = b.owner)
      `
    : [];
  const candidates: Candidate[] = rows.map((r) => ({
    owner: r.owner,
    weight: BigInt(r.weight),
    firstSeenMs: new Date(r.first_seen_at).getTime(),
    ownerBytes: Buffer.from(bs58.decode(r.owner)).toString('hex'),
  }));
  const ranked = rankHolders(candidates, cfg.topN);
  const carryRows = ranked.length
    ? await deps.sql<{ owner: string; carry: bigint }[]>`
        select owner, carry from reward_holders where owner = any(${ranked.map((r) => r.owner)}::text[]) and carry > 0
      `
    : [];
  const carries = new Map(carryRows.map((r) => [r.owner, BigInt(r.carry)]));
  const carryIn = BigInt(epoch.carry_in);
  const p = plan(deps, cfg, { holderGross, carryIn, buyback, ranked, carries });
  // Nobody eligible: the pool (and dust) waits for the next epoch.
  const carryNext = ranked.length === 0 ? p.pool : p.alloc.dust;
  const halt =
    p.fund > cfg.maxEpoch
      ? `funding ${p.fund} lamports is over the per-epoch cap ${cfg.maxEpoch}`
      : await anomaly(deps, p.pool);
  await deps.sql.begin(async (sql) => {
    const claimed = await sql`
      update reward_epochs set status = ${halt ? 'halted' : 'closed'}, closed_at = ${deps.now()},
        revenue_lamports = ${revenue}, slot_lamports = ${slot}, holder_gross = ${holderGross},
        cost_lamports = ${Object.values(p.costs).reduce((a, b) => a + b, 0n)},
        holder_pool = ${p.pool}, buyback_forward = ${buyback}, cost_reserve = ${p.reserve},
        eligible = ${ranked.length},
        paid_count = ${p.alloc.rows.filter((r) => r.status === 'pay').length},
        carried_count = ${p.alloc.rows.filter((r) => r.status === 'carried').length},
        paid_lamports = ${p.alloc.paid}, carry_out = ${p.alloc.carried + carryNext},
        fund_lamports = ${p.fund}, halted_reason = ${halt},
        last_error = ${complete ? null : `only ${epoch.samples_done} of ${required} balance samples were taken; nobody is eligible this epoch`}
      where epoch_id = ${id} and status = 'open'
      returning epoch_id
    `;
    if (claimed.length === 0) return;
    for (const [kind, lamports] of Object.entries(p.costs))
      await sql`insert into reward_costs (epoch_id, kind, lamports) values (${id}, ${kind}, ${lamports})
        on conflict do nothing`;
    const batchOf = new Map<string, number>();
    p.batches.forEach((b, i) => b.forEach((r) => r.kind === 'holder' && batchOf.set(r.owner, i)));
    for (const part of chunk(p.alloc.rows, 500)) {
      await sql`
        insert into reward_allocations ${sql(
          part.map((r) => ({
            epoch_id: id,
            owner: r.owner,
            rank: r.rank,
            weight: r.weight.toString(),
            share: r.share,
            carry_in: r.carryIn,
            lamports: r.lamports,
            status: r.status,
            batch_no: batchOf.get(r.owner) ?? null,
          })),
        )}
      `;
      const paid = part.filter((r) => r.status === 'pay').map((r) => r.owner);
      const kept = part.filter((r) => r.status === 'carried');
      if (paid.length)
        await sql`update reward_holders set carry = 0 where owner = any(${paid}::text[])`;
      if (kept.length)
        await sql`
          update reward_holders h set carry = t.c::bigint
          from unnest(${kept.map((r) => r.owner)}::text[], ${kept.map((r) => r.lamports.toString())}::text[]) as t(o, c)
          where h.owner = t.o
        `;
    }
    for (const [i, b] of p.batches.entries())
      await sql`
        insert into reward_batches (epoch_id, batch_no, recipients, lamports)
        values (${id}, ${i}, ${sql.json(b.map((r) => ({ to: r.owner, lamports: r.lamports.toString(), kind: r.kind })) as never)},
          ${b.reduce((s, r) => s + r.lamports, 0n)})
      `;
    if (carryNext > 0n)
      await sql`update reward_epochs set carry_in = carry_in + ${carryNext} where epoch_id = ${nextId}`;
    if (p.fund === 0n && !halt)
      await sql`update reward_epochs set status = 'paid', paid_at = ${deps.now()} where epoch_id = ${id}`;
  });
  if (halt) console.error('ALERT reward epoch halted', id, halt);
  return halt ? 'halted' : 'closed';
}

/** Pool more than 3× the median of the last 8 paid epochs (and over 1 SOL) halts the epoch. */
async function anomaly(deps: Deps, pool: bigint): Promise<string | null> {
  if (pool <= 1_000_000_000n) return null;
  const rows = await deps.sql<{ p: bigint }[]>`
    select holder_pool as p from reward_epochs where status = 'paid' and holder_pool > 0
    order by starts_at desc limit 8
  `;
  if (rows.length < 4) return null;
  const sorted = rows.map((r) => BigInt(r.p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return pool > median * 3n
    ? `holder pool ${pool} lamports is more than 3x the recent median ${median}`
    : null;
}

// ---------------------------------------------------------------------------------------------
// Funding and sending

export type RewardLimitCheck =
  { ok: true; limit: SpendingLimitAccount } | { ok: false; reason: string };

export function checkRewardLimit(
  info: { data: Uint8Array; owner: string } | null,
  cfg: RewardConfig,
): RewardLimitCheck {
  if (!cfg.send) return { ok: false, reason: 'rewards sending is not configured' };
  if (!info) return { ok: false, reason: 'rewards spending limit account does not exist yet' };
  if (info.owner !== SQUADS_PROGRAM_ID)
    return { ok: false, reason: 'rewards spending limit is not owned by the Squads program' };
  let limit: SpendingLimitAccount;
  try {
    limit = decodeSpendingLimit(info.data);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (limit.multisig !== cfg.multisig)
    return { ok: false, reason: 'rewards spending limit belongs to another multisig' };
  if (limit.vaultIndex !== cfg.vaultIndex)
    return { ok: false, reason: `rewards spending limit is not on vault ${cfg.vaultIndex}` };
  if (limit.mint !== NATIVE_MINT_DEFAULT)
    return { ok: false, reason: 'rewards spending limit is not for native SOL' };
  if (!limit.members.includes(cfg.send.signer))
    return { ok: false, reason: 'rewards signer is not a member of the rewards spending limit' };
  if (limit.destinations.length !== 1 || limit.destinations[0] !== cfg.send.signer)
    return {
      ok: false,
      reason: 'rewards spending limit must allow exactly one destination: the rewards hot wallet',
    };
  return { ok: true, limit };
}

function transferIx(from: string, to: string, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return {
    programId: SYSTEM_PROGRAM_ID,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data,
  };
}

const BUDGET = {
  units: REWARD_DEFAULTS.computeUnits,
  microLamportsPerUnit: REWARD_DEFAULTS.microLamportsPerUnit,
  loadedAccountsDataBytes: 64 * 1024,
};

/** One push transaction: compute budget + ≤ 20 system transfers, fee payer = hot wallet. */
export function batchTx(
  signer: string,
  secret: Uint8Array,
  recipients: { to: string; lamports: bigint }[],
  blockhash: string,
): Uint8Array {
  const tx = signTx(
    compileLegacyTx({
      feePayer: signer,
      recentBlockhash: blockhash,
      instructions: [
        ...computeBudgetIxs(BUDGET),
        ...recipients.map((r) => transferIx(signer, r.to, r.lamports)),
      ],
    }),
    [secret],
  );
  if (tx.length > 1232) throw new Error(`reward batch is ${tx.length} bytes (max 1232)`);
  return tx;
}

async function fund(deps: Deps, cfg: RewardConfig, chain: RewardChain, epoch: Row) {
  const send = cfg.send!;
  const amount = BigInt(epoch.fund_lamports);
  const [limitInfo, vault] = await chain.accounts([send.spendingLimit, cfg.vault]);
  const check = checkRewardLimit(limitInfo ?? null, cfg);
  if (!check.ok) return `paused: ${check.reason}`;
  const nowSec = Math.floor(deps.now().getTime() / 1000);
  if (effectiveRemaining(check.limit, nowSec) < amount)
    return 'waiting: spending limit allowance left this period is below the epoch funding';
  if ((vault?.lamports ?? 0n) - VAULT_FLOOR < amount)
    return 'waiting: rewards vault balance is below the epoch funding';
  const latest = await chain.blockhash();
  const tx = signTx(
    compileLegacyTx({
      feePayer: send.signer,
      recentBlockhash: latest.blockhash,
      instructions: [
        ...computeBudgetIxs({
          ...BUDGET,
          units: FUND_UNITS,
          loadedAccountsDataBytes: FUND_LOADED_BYTES,
        }),
        spendingLimitUseSolIx({
          multisig: cfg.multisig,
          member: send.signer,
          spendingLimit: send.spendingLimit,
          vault: cfg.vault,
          destination: send.signer,
          lamports: amount,
          memo: `tm-reward-fund:${epoch.epoch_id}`,
        }),
      ],
    }),
    [send.secret],
  );
  const sig = signatureOf(tx);
  const claimed = await deps.sql`
    update reward_epochs set status = 'funding', fund_sig = ${sig}, fund_valid_until = ${latest.lastValidBlockHeight}
    where epoch_id = ${epoch.epoch_id} and status = 'closed' returning epoch_id
  `;
  if (claimed.length === 0) return 'claimed elsewhere';
  try {
    await chain.send(tx);
  } catch (err) {
    await deps.sql`update reward_epochs set last_error = ${(err as Error).message.slice(0, 500)} where epoch_id = ${epoch.epoch_id}`;
  }
  return 'funding submitted';
}

async function reconcileFunding(deps: Deps, chain: RewardChain, epoch: Row, queue?: RewardQueue) {
  const [status] = await chain.statuses([epoch.fund_sig as string]);
  if (status && status.confirmed && !status.err) {
    const done = await deps.sql`
      update reward_epochs set status = 'paying', last_error = null
      where epoch_id = ${epoch.epoch_id} and status = 'funding' and fund_sig = ${epoch.fund_sig} returning epoch_id
    `;
    if (done.length && queue) await enqueueBatches(deps, Number(epoch.epoch_id), queue);
    return 'funded';
  }
  let reason: string | null = null;
  if (status?.err) reason = `funding failed on chain: ${JSON.stringify(status.err)}`;
  else if (!status && (await chain.blockHeight()) > Number(epoch.fund_valid_until))
    reason = 'funding blockhash expired before landing';
  if (!reason) return 'funding in flight';
  const attempts = (epoch.fund_attempts as number) + 1;
  const next = attempts >= REWARD_MAX_ATTEMPTS ? 'halted' : 'closed';
  await deps.sql`
    update reward_epochs set status = ${next}, fund_attempts = ${attempts}, last_error = ${reason},
      halted_reason = ${next === 'halted' ? `funding failed ${attempts} times: ${reason}` : null}
    where epoch_id = ${epoch.epoch_id} and status = 'funding' and fund_sig = ${epoch.fund_sig}
  `;
  return reason;
}

export async function enqueueBatches(deps: Deps, epochId: number, queue: RewardQueue) {
  const rows = await deps.sql<{ batch_no: number }[]>`
    select batch_no from reward_batches where epoch_id = ${epochId} and status = 'pending' order by batch_no
  `;
  // sendBatch takes ≤ 100 messages and counts as one subrequest.
  for (const part of chunk(rows, 100))
    await queue.sendBatch(
      part.map((r) => ({ body: { kind: 'reward-batch', epochId, batchNo: r.batch_no } })),
    );
}

/** Settles every in-flight batch with ONE getSignatureStatuses call. */
async function reconcileBatches(deps: Deps, chain: RewardChain): Promise<number> {
  const rows = await deps.sql<Row[]>`
    select * from reward_batches where status = 'sending' order by sent_at limit 200
  `;
  if (rows.length === 0) return 0;
  const statuses = await chain.statuses(rows.map((r) => r.tx_sig as string));
  let settled = 0;
  for (const [i, row] of rows.entries())
    settled += await settleBatch(deps, chain, row, statuses[i] ?? null);
  return settled;
}

async function settleBatch(
  deps: Deps,
  chain: RewardChain,
  row: Row,
  status: { confirmed: boolean; err: unknown } | null,
): Promise<number> {
  if (status && status.confirmed && !status.err) {
    const r = await deps.sql`
      update reward_batches set status = 'sent', last_error = null
      where epoch_id = ${row.epoch_id} and batch_no = ${row.batch_no} and status = 'sending' and tx_sig = ${row.tx_sig}
      returning batch_no
    `;
    return r.length;
  }
  let reason: string | null = null;
  if (status?.err) reason = `batch failed on chain: ${JSON.stringify(status.err)}`;
  else if (!status && (await chain.blockHeight()) > Number(row.valid_until_height))
    reason = 'blockhash expired before landing';
  if (!reason) return 0;
  const attempts = (row.attempts as number) + 1;
  const next = attempts >= REWARD_MAX_ATTEMPTS ? 'failed' : 'pending';
  await deps.sql`
    update reward_batches set status = ${next}, attempts = ${attempts}, last_error = ${reason}
    where epoch_id = ${row.epoch_id} and batch_no = ${row.batch_no} and status = 'sending' and tx_sig = ${row.tx_sig}
  `;
  if (next === 'failed')
    console.error('ALERT reward batch failed', row.epoch_id, row.batch_no, reason);
  return 0;
}

/** Signs, claims and broadcasts one pending batch. Returns its signature, or null if not sent. */
export async function sendBatch(
  deps: Deps,
  cfg: RewardConfig,
  chain: RewardChain,
  epochId: number,
  batchNo: number,
  latest?: { blockhash: string; lastValidBlockHeight: number },
): Promise<string | null> {
  if (!cfg.send) return null;
  const [epoch] = await deps.sql<
    Row[]
  >`select status from reward_epochs where epoch_id = ${epochId}`;
  if (epoch?.status !== 'paying') return null;
  const [row] = await deps.sql<Row[]>`
    select * from reward_batches where epoch_id = ${epochId} and batch_no = ${batchNo}
  `;
  if (!row || row.status !== 'pending' || row.attempts >= REWARD_MAX_ATTEMPTS) return null;
  const recipients = (row.recipients as { to: string; lamports: string }[]).map((r) => ({
    to: r.to,
    lamports: BigInt(r.lamports),
  }));
  const bh = latest ?? (await chain.blockhash());
  const tx = batchTx(cfg.send.signer, cfg.send.secret, recipients, bh.blockhash);
  const sig = signatureOf(tx);
  const claimed = await deps.sql`
    update reward_batches set status = 'sending', tx_sig = ${sig}, valid_until_height = ${bh.lastValidBlockHeight},
      sent_at = ${deps.now()}
    where epoch_id = ${epochId} and batch_no = ${batchNo} and status = 'pending' returning batch_no
  `;
  if (claimed.length === 0) return null;
  try {
    await chain.send(tx);
  } catch (err) {
    await deps.sql`update reward_batches set last_error = ${(err as Error).message.slice(0, 500)}
      where epoch_id = ${epochId} and batch_no = ${batchNo}`;
  }
  return sig;
}

/** Queue consumer: one batch per message. Returns 'retry' while the batch is not final. */
export async function processBatchMessage(
  deps: Deps,
  body: { epochId: number; batchNo: number },
): Promise<'done' | 'retry'> {
  const cfg = rewardConfig(deps.env);
  if (!cfg?.send) return 'done';
  const chain = rewardChainOf(deps);
  const [row] = await deps.sql<Row[]>`
    select * from reward_batches where epoch_id = ${body.epochId} and batch_no = ${body.batchNo}
  `;
  if (!row || row.status === 'sent' || row.status === 'failed') {
    await finishEpochs(deps);
    return 'done';
  }
  if (row.status === 'sending') {
    const [status] = await chain.statuses([row.tx_sig as string]);
    await settleBatch(deps, chain, row, status ?? null);
    const [after] = await deps.sql<Row[]>`
      select status from reward_batches where epoch_id = ${body.epochId} and batch_no = ${body.batchNo}
    `;
    if (after?.status === 'sent' || after?.status === 'failed') {
      await finishEpochs(deps);
      return 'done';
    }
    if (after?.status === 'sending') return 'retry';
  }
  await sendBatch(deps, cfg, chain, body.epochId, body.batchNo);
  return 'retry';
}

async function finishEpochs(deps: Deps): Promise<void> {
  await deps.sql`
    update reward_epochs e set status = 'paid', paid_at = ${deps.now()}
    where e.status = 'paying'
      and not exists (select 1 from reward_batches b where b.epoch_id = e.epoch_id and b.status <> 'sent')
  `;
}

export type RewardTickResult = {
  skipped?: string;
  epoch: number;
  sampled: boolean;
  closed: number[];
  funding?: string;
  settled: number;
  sent: number;
};

/** One cron tick. Safe to run concurrently or repeatedly: every step is a conditional claim. */
export async function rewardsTick(deps: Deps, queue?: RewardQueue): Promise<RewardTickResult> {
  const cfg = rewardConfig(deps.env);
  const nowMs = deps.now().getTime();
  const out: RewardTickResult = { epoch: 0, sampled: false, closed: [], settled: 0, sent: 0 };
  if (!cfg) return { ...out, skipped: 'MART_MINT or MULTISIG_ADDRESS not set' };
  const chain = rewardChainOf(deps);
  const current = epochIdAt(nowMs, cfg.epochSeconds);
  out.epoch = current;
  const epoch = await ensureEpoch(deps, cfg, current);
  out.sampled = await sampleIfDue(deps, cfg, chain, epoch);
  // Close every ended epoch, oldest first (catches up after downtime).
  const ended = await deps.sql<Row[]>`
    select * from reward_epochs where status = 'open' and ends_at <= ${deps.now()} order by starts_at, epoch_id limit 4
  `;
  for (const e of ended) {
    await closeEpoch(deps, cfg, e);
    out.closed.push(Number(e.epoch_id));
  }
  if (!cfg.send) return { ...out, funding: 'sending off (REWARDS_AUTO=0 or not configured)' };
  out.settled = await reconcileBatches(deps, chain);
  await finishEpochs(deps);
  // One epoch moves at a time, oldest first.
  const [next] = await deps.sql<Row[]>`
    select * from reward_epochs where status in ('closed', 'funding', 'paying') order by starts_at, epoch_id limit 1
  `;
  if (next?.status === 'closed') out.funding = await fund(deps, cfg, chain, next);
  else if (next?.status === 'funding')
    out.funding = await reconcileFunding(deps, chain, next, queue);
  else if (next?.status === 'paying') {
    // Fallback sender: no queue bound, or batches still pending 10 min after funding.
    const stale = await deps.sql<{ batch_no: number }[]>`
      select batch_no from reward_batches
      where epoch_id = ${next.epoch_id} and status = 'pending' and attempts < ${REWARD_MAX_ATTEMPTS}
        and (${!queue} or ${deps.now()} - interval '10 minutes' > coalesce(sent_at, ${next.closed_at}))
      order by batch_no limit ${REWARDS_INLINE_BATCHES}
    `;
    let bh: { blockhash: string; lastValidBlockHeight: number } | undefined;
    for (const b of stale) {
      bh ??= await chain.blockhash();
      if (await sendBatch(deps, cfg, chain, Number(next.epoch_id), b.batch_no, bh)) out.sent += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Health (alerts for /internal/ops) and the public feed

export type RewardAlert = { level: 'warn' | 'critical'; code: string; message: string };

export async function rewardHealth(deps: Deps): Promise<RewardAlert[]> {
  const alerts: RewardAlert[] = [];
  let cfg: RewardConfig | null;
  try {
    cfg = rewardConfig(deps.env);
  } catch (err) {
    return [{ level: 'critical', code: 'REWARD_LIMIT', message: (err as Error).message }];
  }
  if (!cfg) return alerts;
  const now = deps.now();
  const [failed] = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from reward_batches where status = 'failed'
  `;
  if ((failed?.n ?? 0) > 0)
    alerts.push({
      level: 'critical',
      code: 'REWARD_FAILED',
      message: `${failed!.n} holder reward batch(es) failed ${REWARD_MAX_ATTEMPTS} times; see reward_batches.last_error, reset to pending after fixing`,
    });
  const halted = await deps.sql<Row[]>`
    select epoch_id, halted_reason from reward_epochs where status = 'halted' order by starts_at limit 5
  `;
  for (const h of halted)
    alerts.push({
      level: /cap|median/.test(h.halted_reason ?? '') ? 'warn' : 'critical',
      code: /cap|median/.test(h.halted_reason ?? '') ? 'REWARD_POOL_ANOMALY' : 'REWARD_FAILED',
      message: `reward epoch ${h.epoch_id} halted: ${h.halted_reason}. Resume with POST /api/v1/internal/rewards/resume/${h.epoch_id} after review`,
    });
  const [missed] = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from reward_epochs
    where closed_at > ${new Date(now.getTime() - 86_400_000)} and samples_done < cardinality(sample_ticks)
  `;
  if ((missed?.n ?? 0) > 0)
    alerts.push({
      level: 'warn',
      code: 'REWARD_SNAPSHOT_MISSED',
      message: `${missed!.n} reward epoch(s) in the last 24 h closed without all balance samples (cron or RPC down)`,
    });
  const [waiting] = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from reward_epochs
    where status in ('closed', 'funding', 'paying') and ends_at < ${new Date(now.getTime() - 6 * 3_600_000)}
  `;
  if ((waiting?.n ?? 0) > 0)
    alerts.push({
      level: 'warn',
      code: 'REWARDS_WAITING',
      message: `${waiting!.n} reward epoch(s) ended more than 6 h ago and are not paid (REWARDS_AUTO off, limit or vault short)`,
    });
  // Reconciliation: what the batches sent must equal what the epoch allocated + forwarded.
  const mismatched = await deps.sql<Row[]>`
    select e.epoch_id, e.paid_lamports, e.buyback_forward, coalesce(sum(b.lamports), 0)::bigint as sent
    from reward_epochs e left join reward_batches b on b.epoch_id = e.epoch_id and b.status = 'sent'
    where e.status = 'paid' and e.paid_at > ${new Date(now.getTime() - 7 * 86_400_000)}
    group by e.epoch_id
    having coalesce(sum(b.lamports), 0) <> e.paid_lamports + case when e.fund_lamports > 0 and e.buyback_forward > 0 and ${deps.env.buckets.buyback !== ''} then e.buyback_forward else 0 end
  `;
  for (const m of mismatched)
    alerts.push({
      level: 'critical',
      code: 'REWARD_RECONCILE',
      message: `reward epoch ${m.epoch_id}: batches sent ${m.sent} lamports, ledger says ${BigInt(m.paid_lamports) + BigInt(m.buyback_forward)}`,
    });
  if (!cfg.send) return alerts;
  try {
    const [signer, vault, limitInfo] = await rewardChainOf(deps).accounts([
      cfg.send.signer,
      cfg.vault,
      cfg.send.spendingLimit,
    ]);
    if ((signer?.lamports ?? 0n) < REWARD_SIGNER_MIN_LAMPORTS)
      alerts.push({
        level: 'critical',
        code: 'LOW_BALANCE',
        message: `rewards hot wallet ${cfg.send.signer} holds ${Number(signer?.lamports ?? 0n) / 1e9} SOL; it pays the funding fee`,
      });
    const [due] = await deps.sql<{ sum: bigint }[]>`
      select coalesce(sum(fund_lamports), 0)::bigint as sum from reward_epochs where status = 'closed'
    `;
    const [carried] = await deps.sql<{ sum: bigint }[]>`
      select coalesce(sum(carry), 0)::bigint as sum from reward_holders
    `;
    const owed = BigInt(due?.sum ?? 0n);
    // Only when something is actually due: an empty vault with nothing owed is the normal idle state.
    if (owed > 0n && (vault?.lamports ?? 0n) < owed + VAULT_FLOOR)
      alerts.push({
        level: 'critical',
        code: 'REWARD_BALANCE_LOW',
        message: `rewards vault holds ${Number(vault?.lamports ?? 0n) / 1e9} SOL but ${Number(owed) / 1e9} SOL is due (carried: ${Number(carried?.sum ?? 0n) / 1e9} SOL)`,
      });
    const check = checkRewardLimit(limitInfo ?? null, cfg);
    if (!check.ok)
      alerts.push({
        level: 'warn',
        code: 'REWARD_LIMIT',
        message: `holder rewards paused: ${check.reason}`,
      });
    else if (effectiveRemaining(check.limit, Math.floor(now.getTime() / 1000)) < owed)
      alerts.push({
        level: 'warn',
        code: 'REWARD_LIMIT',
        message: 'rewards spending limit has less left this period than the epochs due',
      });
  } catch (err) {
    alerts.push({
      level: 'critical',
      code: 'REWARD_LIMIT',
      message: `rewards check failed: ${(err as Error).message}`,
    });
  }
  return alerts;
}

const sol = (v: unknown) => (Number(BigInt((v as bigint | string | number) ?? 0)) / 1e9).toFixed(9);

export async function recentEpochs(deps: Deps, limit: number) {
  const rows = await deps.sql<Row[]>`
    select * from reward_epochs where status <> 'open' order by starts_at desc, epoch_id desc limit ${limit}
  `;
  const ids = rows.map((r) => r.epoch_id);
  const costs = ids.length
    ? await deps.sql<
        Row[]
      >`select * from reward_costs where epoch_id in ${deps.sql(ids.map((i) => Number(i)))}`
    : [];
  const batches = ids.length
    ? await deps.sql<Row[]>`
        select epoch_id, batch_no, tx_sig, status, lamports, jsonb_array_length(recipients) as n
        from reward_batches where epoch_id in ${deps.sql(ids.map((i) => Number(i)))} order by batch_no`
    : [];
  // Paid = SOL actually sent to holders: holder lines of batches reconciled as sent on chain
  // (includes their carry-in; excludes the buyback forward and anything not yet landed).
  const sent = ids.length
    ? await deps.sql<{ epoch_id: string; lamports: string; n: number }[]>`
        select b.epoch_id, coalesce(sum((r->>'lamports')::bigint), 0)::text as lamports, count(*)::int as n
        from reward_batches b, jsonb_array_elements(b.recipients) r
        where b.epoch_id in ${deps.sql(ids.map((i) => Number(i)))} and b.status = 'sent' and r->>'kind' = 'holder'
        group by b.epoch_id`
    : [];
  return rows.map((e) => {
    const out = sent.find((x) => String(x.epoch_id) === String(e.epoch_id));
    const paidOut = BigInt(out?.lamports ?? 0);
    return {
      epoch: Number(e.epoch_id),
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      status: e.status,
      revenue: { lamports: String(e.revenue_lamports), sol: sol(e.revenue_lamports) },
      costs: Object.fromEntries(
        costs.filter((c) => c.epoch_id === e.epoch_id).map((c) => [c.kind, String(c.lamports)]),
      ),
      costTotal: String(e.cost_lamports),
      holderPool: { lamports: String(e.holder_pool), sol: sol(e.holder_pool) },
      carryIn: String(e.carry_in),
      eligible: e.eligible,
      paidCount: e.paid_count,
      carriedCount: e.carried_count,
      paidLamports: String(e.paid_lamports),
      paid: { lamports: String(paidOut), sol: sol(paidOut), recipients: out?.n ?? 0 },
      buybackForward: String(e.buyback_forward),
      samples: { done: e.samples_done, planned: (e.sample_ticks as number[]).length },
      // The seed is only published once the epoch is closed (it decides the sample times).
      seed: e.seed,
      sampleTicks: e.sample_ticks,
      fundSig: e.status === 'funding' || e.fund_sig ? e.fund_sig : null,
      batches: batches
        .filter((b) => b.epoch_id === e.epoch_id)
        .map((b) => ({
          n: b.batch_no,
          recipients: b.n,
          lamports: String(b.lamports),
          sig: b.tx_sig,
          status: b.status,
        })),
      paidAt: e.paid_at,
    };
  });
}

export async function currentEpoch(deps: Deps) {
  const cfg = rewardConfig(deps.env);
  if (!cfg) return null;
  const id = epochIdAt(deps.now().getTime(), cfg.epochSeconds);
  const { start, end } = epochBounds(id, cfg.epochSeconds);
  const [e] = await deps.sql<Row[]>`select * from reward_epochs where epoch_id = ${id}`;
  const [rev] = await deps.sql<Row[]>`
    select coalesce(sum(net_fee), 0)::bigint as revenue, coalesce(sum(holder_gross), 0)::bigint as holder_gross
    from reward_revenue where epoch_id = ${id}
  `;
  return {
    epoch: id,
    startsAt: start,
    endsAt: end,
    epochSeconds: cfg.epochSeconds,
    samples: {
      done: e?.samples_done ?? 0,
      // min(6, ticks in the epoch): a 900 s test epoch has only 3 five-minute ticks.
      planned:
        (e?.sample_ticks as number[] | undefined)?.length ??
        Math.min(REWARD_DEFAULTS.samplesPerEpoch, sampleRange(cfg)),
    },
    revenueSoFar: String(rev?.revenue ?? 0),
    holderGrossSoFar: String(rev?.holder_gross ?? 0),
    carryIn: String(e?.carry_in ?? 0),
    rules: {
      topN: cfg.topN,
      minSupplyBps: cfg.minSupplyBps,
      minPayoutLamports: String(cfg.minPayout),
      holdEpochs: REWARD_DEFAULTS.holdEpochs,
      samplesPerEpoch: REWARD_DEFAULTS.samplesPerEpoch,
      holderShareBps: 5000,
    },
    mint: cfg.mint,
    vault: cfg.vault,
    sending: cfg.send !== null,
  };
}

export async function walletRewards(deps: Deps, wallet: string) {
  const [holder] = await deps.sql<Row[]>`select * from reward_holders where owner = ${wallet}`;
  const rows = await deps.sql<Row[]>`
    select a.*, b.tx_sig from reward_allocations a
    left join reward_batches b on b.epoch_id = a.epoch_id and b.batch_no = a.batch_no
    join reward_epochs e on e.epoch_id = a.epoch_id
    where a.owner = ${wallet} order by e.starts_at desc limit 20
  `;
  const [cur] = await deps.sql<Row[]>`
    select b.min_amount::text as weight, b.samples from reward_balances b
    join reward_epochs e on e.epoch_id = b.epoch_id
    where b.owner = ${wallet} order by e.starts_at desc limit 1
  `;
  return {
    wallet,
    carry: String(holder?.carry ?? 0),
    firstSeenAt: holder?.first_seen_at ?? null,
    currentMinBalance: cur?.weight ?? null,
    epochs: rows.map((r) => ({
      epoch: Number(r.epoch_id),
      rank: r.rank,
      weight: String(r.weight),
      share: String(r.share),
      carryIn: String(r.carry_in),
      lamports: String(r.lamports),
      status: r.status,
      sig: r.status === 'pay' ? r.tx_sig : null,
    })),
  };
}

export async function resumeEpoch(deps: Deps, epochId: number): Promise<boolean> {
  const r = await deps.sql`
    update reward_epochs set status = 'closed', halted_reason = null, fund_attempts = 0
    where epoch_id = ${epochId} and status = 'halted' returning epoch_id
  `;
  return r.length > 0;
}

/** Top allocations of the latest allocated epoch (public: wallets and amounts are on chain). */
export async function topHolders(deps: Deps, limit: number) {
  const [e] = await deps.sql<Row[]>`
    select epoch_id from reward_epochs where status in ('closed', 'funding', 'paying', 'paid')
    order by starts_at desc limit 1
  `;
  if (!e) return { epoch: null, holders: [] };
  const rows = await deps.sql<Row[]>`
    select owner, rank, weight::text as weight, lamports, status from reward_allocations
    where epoch_id = ${e.epoch_id} order by rank limit ${limit}
  `;
  const [sum] = await deps.sql<Row[]>`
    select coalesce(sum(weight), 0)::text as total from reward_allocations where epoch_id = ${e.epoch_id}
  `;
  const total = BigInt(sum?.total ?? '0');
  return {
    epoch: Number(e.epoch_id),
    holders: rows.map((r) => ({
      wallet: r.owner,
      rank: r.rank,
      weightBps: total > 0n ? Number((BigInt(r.weight) * 10_000n) / total) : 0,
      lamports: String(r.lamports),
      status: r.status,
    })),
  };
}
