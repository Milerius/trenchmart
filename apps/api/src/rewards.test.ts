// $MART holder rewards against real Postgres and a simulated chain: token accounts, the mint,
// a Squads spending limit on vault 1 that enforces what the program enforces, and SOL transfers.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import {
  encodeSpendingLimitForTest,
  parseLegacyTx,
  randomKeypair,
  spendingLimitPda,
  SQUADS_PROGRAM_ID,
  vaultPda,
  verifyTxSignatures,
} from '@trenchmart/chain';
import { releasePayouts } from '@trenchmart/shared/payouts';
import { epochIdAt } from '@trenchmart/shared/rewards';
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';
import { opsCheck } from './ops';
import {
  currentEpoch,
  feeRouting,
  processBatchMessage,
  recentEpochs,
  recordRevenue,
  resumeEpoch,
  rewardsTick,
  TOKEN_PROGRAM_ID,
  type RewardChain,
} from './rewards';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const TOKEN = 'internal-token-internal-token-internal-token-0123';
const MULTISIG = 'CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B';
const VAULT0 = vaultPda(MULTISIG, 0);
const VAULT1 = vaultPda(MULTISIG, 1);
const MINT = randomKeypair().publicKey;
const BUYBACK = randomKeypair().publicKey;
const SOL = 1_000_000_000n;
const SUPPLY = 1_000_000_000_000_000n; // 1B tokens, 6 decimals
const EPOCH = 10_800;
let sql: Sql;
let now = new Date('2026-10-22T00:00:00.000Z');

type Fake = RewardChain & {
  balances: Map<string, bigint>;
  vault: bigint;
  remaining: bigint;
  destinations: string[];
  landed: Map<string, { err: unknown }>;
  paid: Map<string, bigint>;
  funded: bigint;
  failBatches: boolean;
  height: number;
  calls: string[];
  maxTxBytes: number;
};

function fakeChain(signer: string, limit: string): Fake {
  const f: Fake = {
    balances: new Map(),
    vault: 100n * SOL,
    remaining: 100n * SOL,
    destinations: [signer],
    landed: new Map(),
    paid: new Map(),
    funded: 0n,
    failBatches: false,
    height: 1000,
    calls: [],
    maxTxBytes: 0,
    async accounts(addresses) {
      f.calls.push('getMultipleAccounts');
      return addresses.map((a) => {
        if (a === MINT) {
          const data = new Uint8Array(82);
          new DataView(data.buffer).setBigUint64(36, SUPPLY, true);
          return { owner: TOKEN_PROGRAM_ID, lamports: 1_000_000n, data };
        }
        if (a === limit)
          return {
            owner: SQUADS_PROGRAM_ID,
            lamports: 2_000_000n,
            data: encodeSpendingLimitForTest({
              multisig: MULTISIG,
              createKey: randomKeypair().publicKey,
              vaultIndex: 1,
              mint: '11111111111111111111111111111111',
              amount: 100n * SOL,
              period: 'Day',
              remainingAmount: f.remaining,
              lastReset: BigInt(Math.floor(now.getTime() / 1000)),
              bump: 255,
              members: [signer],
              destinations: f.destinations,
            }),
          };
        if (a === VAULT1)
          return { owner: '1'.repeat(32), lamports: f.vault, data: new Uint8Array() };
        if (a === signer) return { owner: '1'.repeat(32), lamports: SOL, data: new Uint8Array() };
        return null;
      });
    },
    async tokenHolders(mint, programId) {
      f.calls.push('getProgramAccounts');
      expect([mint, programId]).toEqual([MINT, TOKEN_PROGRAM_ID]);
      return [...f.balances].map(([owner, amount]) => ({ owner, amount }));
    },
    async send(tx) {
      f.calls.push('sendTransaction');
      f.maxTxBytes = Math.max(f.maxTxBytes, tx.length);
      expect(tx.length).toBeLessThanOrEqual(1232);
      const parsed = parseLegacyTx(tx);
      expect(verifyTxSignatures(parsed)).toBe(true);
      const sig = bs58.encode(parsed.signatures[0]!);
      if (f.landed.has(sig)) return sig; // duplicate broadcast of the same signed tx: no-op
      const squads = parsed.instructions.find((i) => i.programId === SQUADS_PROGRAM_ID);
      if (squads) {
        const lamports = new DataView(squads.data.buffer, squads.data.byteOffset).getBigUint64(
          8,
          true,
        );
        if (lamports > f.remaining || lamports > f.vault || squads.accounts[4] !== signer) {
          f.landed.set(sig, { err: { InstructionError: [3, { Custom: 6026 }] } });
          return sig;
        }
        f.remaining -= lamports;
        f.vault -= lamports;
        f.funded += lamports;
      } else {
        if (f.failBatches) {
          f.landed.set(sig, { err: { InstructionError: [3, 'InsufficientFunds'] } });
          return sig;
        }
        for (const ix of parsed.instructions.filter(
          (i) => i.programId === '11111111111111111111111111111111',
        )) {
          const lamports = new DataView(ix.data.buffer, ix.data.byteOffset).getBigUint64(4, true);
          f.paid.set(ix.accounts[1]!, (f.paid.get(ix.accounts[1]!) ?? 0n) + lamports);
        }
      }
      f.landed.set(sig, { err: null });
      return sig;
    },
    async statuses(sigs) {
      f.calls.push('getSignatureStatuses');
      return sigs.map((s) => {
        const l = f.landed.get(s);
        return l ? { confirmed: true, err: l.err } : null;
      });
    },
    blockHeight: async () => f.height,
    blockhash: async () => ({
      blockhash: bs58.encode(nacl.randomBytes(32)),
      lastValidBlockHeight: f.height + 150,
    }),
  };
  return f;
}

async function setup(extra: Record<string, string> = {}) {
  const signer = nacl.sign.keyPair();
  const signerPk = bs58.encode(signer.publicKey);
  const limit = spendingLimitPda(MULTISIG, randomKeypair().publicKey);
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: VAULT0,
    MULTISIG_ADDRESS: MULTISIG,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    INTERNAL_TOKEN: TOKEN,
    HELIUS_WEBHOOK_SECRET: 'hook-secret-hook-secret-hook-secret-hook-0123',
    AI_ATTEST_SECRET: 'attest-secret-attest-secret-attest-secret-0123',
    SOLANA_RPC_URL: 'https://rpc.example',
    MART_MINT: MINT,
    BUCKET_WALLET_BUYBACK: BUYBACK,
    BUCKET_WALLET_AI_VERIFICATION: randomKeypair().publicKey,
    BUCKET_WALLET_OPS: randomKeypair().publicKey,
    BUCKET_WALLET_SAFETY: randomKeypair().publicKey,
    REWARDS_SPLIT: '1',
    REWARDS_SIGNER_SECRET: bs58.encode(signer.secretKey),
    REWARDS_SPENDING_LIMIT: limit,
    REWARDS_MAX_EPOCH_LAMPORTS: String(50n * SOL),
    REWARDS_COST_RPC_LAMPORTS: '1000000',
    REWARDS_COST_INFRA_LAMPORTS: '2000000',
    ...extra,
  });
  const chain = fakeChain(signerPk, limit);
  const deps: Deps = {
    sql,
    blob: filesystemBlob(await mkdtemp(join(tmpdir(), 'tm-rw-')), env.sessionSecret, env.apiUrl),
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: chain.blockhash,
    rewardChain: chain,
    payoutChain: chain,
    opsFetch: (async () => Response.json({ result: 'ok' })) as unknown as typeof fetch,
  };
  return { deps, chain, signerPk };
}

const epochStart = (id: number) => new Date(id * EPOCH * 1000);

/** Runs every 5-minute tick of an epoch (taking all 6 samples), then the first tick after it. */
async function runEpoch(deps: Deps, id: number, during?: (tick: number) => void) {
  for (let t = 0; t < EPOCH / 300; t++) {
    now = new Date(epochStart(id).getTime() + t * 300_000 + 1000);
    during?.(t);
    await rewardsTick(deps);
  }
  now = new Date(epochStart(id + 1).getTime() + 1000);
  await rewardsTick(deps);
}

/** Revenue that paid the rewards vault: a released order with the routed split. */
async function revenue(deps: Deps, netFee: bigint, ref: string = crypto.randomUUID()) {
  const routing = feeRouting(deps.env, {
    fee_split_bps: { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 },
  });
  const lines = releasePayouts({
    price: 0n,
    netFee,
    splitBps: routing.splitBps,
    creatorWallet: '',
    buckets: routing.buckets,
  });
  await recordRevenue(deps, { source: 'order', ref, netFee, lines });
  return lines;
}

const tokens = (n: number) => BigInt(n) * 1_000_000n;

describe('$MART holder rewards', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`truncate table reward_batches, reward_allocations, reward_costs, reward_balances,
      reward_holders, reward_exclusions, reward_revenue, reward_epochs, ops_events, ops_alerts cascade`;
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('routes 70% of each fee (holders 50% + buyback 20%) to the rewards vault', async () => {
    const { deps } = await setup();
    const lines = await revenue(deps, 1_000_000_000n, 'r1');
    expect(lines.find((l) => l.recipient === VAULT1)?.amount).toBe(700_000_000n);
    await revenue(deps, 1_000_000_000n, 'r1'); // retried release: counted once
    const rows = await sql`select * from reward_revenue`;
    expect(rows).toHaveLength(1);
    expect(BigInt(rows[0]!.holder_gross)).toBe(500_000_000n);
  });

  it('pays the top 1000 of 1,050 holders in 20-recipient batches, once, via the queue', async () => {
    const { deps, chain } = await setup();
    const holders = Array.from({ length: 1050 }, () => randomKeypair().publicKey);
    // Balances 600k..1.65M tokens (all ≥ 0.05% of supply = 500k). Ranks are unique.
    holders.forEach((h, i) => chain.balances.set(h, tokens(600_000 + i * 1000)));
    const lp = vaultPda(randomKeypair().publicKey, 3); // off-curve owner: pool / bonding curve
    chain.balances.set(lp, tokens(100_000_000));
    chain.balances.set(VAULT0, tokens(50_000_000)); // treasury
    const excluded = randomKeypair().publicKey;
    chain.balances.set(excluded, tokens(90_000_000));
    await sql`insert into reward_exclusions (address, reason) values (${excluded}, 'team')`;
    chain.balances.set(randomKeypair().publicKey, tokens(400_000)); // under the 0.05% floor
    const washer = randomKeypair().publicKey;
    const seller = holders[1049]!; // biggest holder sells mid-epoch

    const e0 = epochIdAt(Date.UTC(2026, 9, 22), EPOCH);
    await runEpoch(deps, e0); // qualifying epoch (2-epoch hold)
    await revenue(deps, 40n * SOL); // revenue in e1 → holder gross 20 SOL
    let samplesSeen = 0;
    await runEpoch(deps, e0 + 1, () => {
      const [e] = [samplesSeen];
      void e;
      // A wash buyer appears with a huge balance after the first sample.
      if (!chain.balances.has(washer) && now.getTime() > epochStart(e0 + 1).getTime() + 3_600_000)
        chain.balances.set(washer, tokens(500_000_000));
      if (now.getTime() > epochStart(e0 + 1).getTime() + 7_200_000) chain.balances.delete(seller);
      samplesSeen += 1;
    });
    const [epoch] = await sql`select * from reward_epochs where epoch_id = ${e0 + 1}`;
    expect(epoch!.samples_done).toBe(6);
    expect(epoch!.eligible).toBe(1000);
    const costs =
      await sql`select kind, lamports from reward_costs where epoch_id = ${e0 + 1} order by kind`;
    expect(Object.fromEntries(costs.map((c) => [c.kind, BigInt(c.lamports)]))).toMatchObject({
      rpc: 1_000_000n,
      infra: 2_000_000n,
    });
    const costTotal = BigInt(epoch!.cost_lamports);
    expect(BigInt(epoch!.holder_pool)).toBe(20n * SOL - (costTotal + 1n) / 2n);
    expect(BigInt(epoch!.buyback_forward)).toBe(8n * SOL);
    const allocs = await sql`select * from reward_allocations where epoch_id = ${e0 + 1}`;
    const owners = new Set(allocs.map((a) => a.owner));
    expect(owners.has(washer)).toBe(false); // missed sample 1 → not even a candidate
    expect(owners.has(seller)).toBe(false); // lowest balance 0
    expect(owners.has(lp)).toBe(false);
    expect(owners.has(VAULT0)).toBe(false);
    expect(owners.has(excluded)).toBe(false);
    expect(allocs).toHaveLength(1000);
    // The 1000 smallest-but-one... the cut is by weight: holders[0..48] are out (seller is too).
    expect(owners.has(holders[0]!)).toBe(false);
    expect(owners.has(holders[1048]!)).toBe(true);

    // Funding, then 20-recipient batches through a fake queue.
    const queued: { epochId: number; batchNo: number }[] = [];
    const queue = {
      sendBatch: async (m: { body: unknown }[]) => {
        for (const x of m) queued.push(x.body as { epochId: number; batchNo: number });
      },
    };
    now = new Date(now.getTime() + 300_000);
    await rewardsTick(deps, queue); // fund
    now = new Date(now.getTime() + 300_000);
    await rewardsTick(deps, queue); // funded → paying → enqueue
    const batches = await sql`select * from reward_batches where epoch_id = ${e0 + 1}`;
    expect(queued).toHaveLength(batches.length);
    expect(batches.every((b) => (b.recipients as unknown[]).length <= 20)).toBe(true);
    for (let round = 0; round < 3; round++)
      for (const m of queued) await processBatchMessage(deps, m);
    // Duplicate deliveries do nothing.
    for (const m of queued) expect(await processBatchMessage(deps, m)).toBe('done');
    const [paid] = await sql`select * from reward_epochs where epoch_id = ${e0 + 1}`;
    expect(paid!.status).toBe('paid');
    const sent = [...chain.paid.values()].reduce((a, b) => a + b, 0n);
    expect(sent).toBe(BigInt(paid!.paid_lamports) + BigInt(paid!.buyback_forward));
    expect(chain.paid.get(BUYBACK)).toBe(8n * SOL);
    expect(chain.funded).toBe(BigInt(paid!.fund_lamports));
    expect(chain.maxTxBytes).toBeGreaterThan(1100);
    // Every paid wallet got ≥ 0.01 SOL; smaller shares are carried, not sent.
    for (const [to, lamports] of chain.paid)
      if (to !== BUYBACK) expect(lamports).toBeGreaterThanOrEqual(10_000_000n);
    const alerts = await opsCheck(deps);
    expect(alerts.filter((a) => a.code.startsWith('REWARD'))).toEqual([]);

    const app = createApp(deps);
    const feed = (await (await app.request('/api/v1/rewards/epochs/recent')).json()) as {
      epochs: { epoch: number; batches: { sig: string }[]; fundSig: string; costs: object }[];
    };
    const row = feed.epochs.find((e) => e.epoch === e0 + 1)!;
    expect(row.fundSig).toBeTruthy();
    expect(row.batches.every((b) => b.sig)).toBe(true);
    const me = (await (await app.request(`/api/v1/rewards/wallet/${holders[1048]}`)).json()) as {
      epochs: { status: string; sig: string | null }[];
    };
    expect(me.epochs[0]!.status).toBe('pay');
    const top = (await (await app.request('/api/v1/rewards/top?limit=3')).json()) as {
      holders: { wallet: string; rank: number }[];
    };
    expect(top.holders.map((h) => h.rank)).toEqual([1, 2, 3]);
    expect(top.holders[0]!.wallet).toBe(holders[1048]);
    expect(me.epochs[0]!.sig).toBeTruthy();
  }, 120_000);

  it('carries shares under 0.01 SOL over and pays them once they reach it', async () => {
    const { deps, chain } = await setup({
      REWARDS_COST_RPC_LAMPORTS: '0',
      REWARDS_COST_INFRA_LAMPORTS: '0',
    });
    const big = randomKeypair().publicKey;
    const small = randomKeypair().publicKey;
    chain.balances.set(big, tokens(9_000_000));
    chain.balances.set(small, tokens(1_000_000));
    const e0 = epochIdAt(Date.UTC(2026, 9, 23), EPOCH);
    await runEpoch(deps, e0);
    await revenue(deps, 160_000_000n); // holder gross 0.08 SOL → small gets ~0.008
    await runEpoch(deps, e0 + 1);
    const [a] =
      await sql`select * from reward_allocations where epoch_id = ${e0 + 1} and owner = ${small}`;
    expect(a!.status).toBe('carried');
    const [h] = await sql`select carry from reward_holders where owner = ${small}`;
    expect(BigInt(h!.carry)).toBe(BigInt(a!.lamports));
    await revenue(deps, 160_000_000n);
    await runEpoch(deps, e0 + 2);
    const [b] =
      await sql`select * from reward_allocations where epoch_id = ${e0 + 2} and owner = ${small}`;
    expect(b!.status).toBe('pay');
    expect(BigInt(b!.carry_in)).toBe(BigInt(a!.lamports));
  }, 60_000);

  it('a holder needs two epochs; REWARDS_AUTO=0 allocates but never sends', async () => {
    const { deps, chain } = await setup({ REWARDS_AUTO: '0' });
    const late = randomKeypair().publicKey;
    const e0 = epochIdAt(Date.UTC(2026, 9, 24), EPOCH);
    chain.balances.set(randomKeypair().publicKey, tokens(2_000_000));
    await runEpoch(deps, e0);
    chain.balances.set(late, tokens(5_000_000));
    await revenue(deps, 10n * SOL);
    await runEpoch(deps, e0 + 1);
    const owners = (await sql`select owner from reward_allocations where epoch_id = ${e0 + 1}`).map(
      (r) => r.owner,
    );
    expect(owners).not.toContain(late);
    expect(owners).toHaveLength(1);
    const [e] = await sql`select status from reward_epochs where epoch_id = ${e0 + 1}`;
    expect(e!.status).toBe('closed');
    expect(chain.calls).not.toContain('sendTransaction');
  }, 60_000);

  it('halts on the per-epoch cap (REWARD_POOL_ANOMALY), resumes after review', async () => {
    const { deps, chain } = await setup({ REWARDS_MAX_EPOCH_LAMPORTS: String(SOL) });
    chain.balances.set(randomKeypair().publicKey, tokens(2_000_000));
    const e0 = epochIdAt(Date.UTC(2026, 9, 25), EPOCH);
    await runEpoch(deps, e0);
    await revenue(deps, 10n * SOL);
    await runEpoch(deps, e0 + 1);
    const [e] = await sql`select status from reward_epochs where epoch_id = ${e0 + 1}`;
    expect(e!.status).toBe('halted');
    expect((await opsCheck(deps)).map((a) => a.code)).toContain('REWARD_POOL_ANOMALY');
    expect(chain.calls).not.toContain('sendTransaction');
    expect(await resumeEpoch(deps, e0 + 1)).toBe(true);
    now = new Date(now.getTime() + 300_000);
    await rewardsTick(deps);
    expect(chain.funded).toBeGreaterThan(0n);
  }, 60_000);

  it('a wrongly scoped spending limit pauses sending (REWARD_LIMIT); failing batches alert', async () => {
    const { deps, chain } = await setup();
    chain.balances.set(randomKeypair().publicKey, tokens(2_000_000));
    const e0 = epochIdAt(Date.UTC(2026, 9, 26), EPOCH);
    await runEpoch(deps, e0);
    await revenue(deps, 2n * SOL);
    chain.destinations = [randomKeypair().publicKey, chain.destinations[0]!];
    await runEpoch(deps, e0 + 1);
    expect((await opsCheck(deps)).map((a) => a.code)).toContain('REWARD_LIMIT');
    expect(chain.funded).toBe(0n);
    chain.destinations = chain.destinations.slice(1);
    chain.failBatches = true;
    for (let i = 0; i < 20; i++) {
      now = new Date(now.getTime() + 300_000);
      await rewardsTick(deps); // inline sender (no queue): fund, pay, fail ×5
    }
    const [b] = await sql`select status, attempts from reward_batches where epoch_id = ${e0 + 1}`;
    expect(b).toMatchObject({ status: 'failed', attempts: 5 });
    expect((await opsCheck(deps)).map((a) => a.code)).toContain('REWARD_FAILED');
  }, 60_000);

  it('internal cron endpoint needs the token', async () => {
    const { deps } = await setup();
    const app = createApp(deps);
    expect((await app.request('/api/v1/internal/cron/rewards', { method: 'POST' })).status).toBe(
      401,
    );
    const ok = await app.request('/api/v1/internal/cron/rewards', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.status).toBe(200);
  });

  it('survives an epoch-length change (900 s test epochs, then back to 3 h) without losing carry', async () => {
    const short = await setup({ REWARDS_EPOCH_SECONDS: '900' });
    const holders = [randomKeypair().publicKey, randomKeypair().publicKey];
    for (const h of holders) short.chain.balances.set(h, tokens(2_000_000));
    const tickAll = async (deps: Deps, from: number, to: number) => {
      for (let t = from; t <= to; t += 300_000) {
        now = new Date(t + 1000);
        await rewardsTick(deps);
      }
    };
    const start = epochStart(epochIdAt(now.getTime(), EPOCH) + 1).getTime(); // a 3 h boundary
    await tickAll(short.deps, start, start + 900_000 * 3);
    now = new Date(start + 900_000 * 3 + 1000);
    await revenue(short.deps, 30_000_000n); // holder share 15M: under the 0.01 SOL minimum → carried
    await tickAll(short.deps, start + 900_000 * 3, start + 900_000 * 4);
    // Back to 3 h mid-way through a 3 h epoch: the open 900 s row closes and hands its carry on.
    const long = await setup();
    for (const h of holders) long.chain.balances.set(h, tokens(2_000_000));
    await tickAll(long.deps, start + 900_000 * 4, start + EPOCH * 1000 * 2 + 300_000);
    const stale =
      await sql`select epoch_id from reward_epochs where status = 'open' and ends_at <= ${now}`;
    expect(stale).toHaveLength(0);
    const [held] = await sql<
      { c: string }[]
    >`select coalesce(sum(carry), 0)::text as c from reward_holders`;
    const [open] = await sql<
      { c: string }[]
    >`select coalesce(sum(carry_in), 0)::text as c from reward_epochs where status = 'open'`;
    const [paid] = await sql<
      { c: string }[]
    >`select coalesce(sum(paid_lamports), 0)::text as c from reward_epochs`;
    const [net] = await sql<
      { c: string }[]
    >`select sum(holder_gross - cost_reserve)::text as c from reward_epochs where status <> 'open'`;
    expect(BigInt(net!.c)).toBeGreaterThan(10_000_000n); // 15M minus the ledgered cost half
    expect(BigInt(held!.c) + BigInt(open!.c) + BigInt(paid!.c)).toBe(BigInt(net!.c));
    // Newest first by time, whatever the id scale (900 s ids are ~12x the 3 h ids).
    const feed = await recentEpochs(long.deps, 20);
    const starts = feed.map((e) => new Date(e.startsAt as string | Date).getTime());
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    expect(starts.length).toBeGreaterThan(3);
  });

  it('reports the samples actually planned (2 in a 900 s epoch, 6 in 3 h)', async () => {
    const short = await setup({ REWARDS_EPOCH_SECONDS: '900' });
    expect((await currentEpoch(short.deps))?.samples.planned).toBe(2);
    await rewardsTick(short.deps);
    expect((await currentEpoch(short.deps))?.samples.planned).toBe(2);
    const long = await setup();
    expect((await currentEpoch(long.deps))?.samples.planned).toBe(6);
  });

  it('a missed cron tick is caught up on the last tick (never scheduled), 900 s and 3 h', async () => {
    for (const len of [900, EPOCH]) {
      await sql`truncate table reward_balances, reward_holders, reward_epochs cascade`;
      const { deps, chain } = await setup({ REWARDS_EPOCH_SECONDS: String(len) });
      chain.balances.set(randomKeypair().publicKey, tokens(2_000_000));
      const id = epochIdAt(now.getTime(), len) + 1;
      const start = id * len * 1000;
      const ticks = len / 300;
      // Worst case: every scheduled tick is the one the cron misses; the sample lands one tick later.
      const [row] = await sql<{ sample_ticks: number[] }[]>`select 1`.then(async () => {
        now = new Date(start + 1000);
        await rewardsTick(deps);
        return sql<
          { sample_ticks: number[] }[]
        >`select sample_ticks from reward_epochs where epoch_id = ${id}`;
      });
      const planned = row!.sample_ticks;
      expect(Math.max(...planned)).toBeLessThan(ticks - 1); // last tick is free
      expect(planned).toHaveLength(Math.min(6, ticks - 1));
      const last = planned[planned.length - 1]!;
      for (let t = 1; t < ticks; t++) {
        if (t === last) continue; // the cron misses the last scheduled tick
        now = new Date(start + t * 300_000 + 1000);
        await rewardsTick(deps);
      }
      const [e] = await sql<
        { samples_done: number }[]
      >`select samples_done from reward_epochs where epoch_id = ${id}`;
      expect(e!.samples_done).toBe(planned.length);
    }
  });
});
