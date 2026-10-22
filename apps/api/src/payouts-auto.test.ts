// Automated payouts against real Postgres and a simulated Squads spending limit that enforces
// what the program enforces (member signature, remaining allowance, vault balance).
import { randomUUID } from 'node:crypto';
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
import { createApp } from './app';
import { filesystemBlob } from './blob';
import { readEnv } from './env';
import type { Deps } from './logic';
import { markBatchSent, proposePayouts } from './logic';
import { opsCheck } from './ops';
import { autoPayouts, autoPayoutConfig, type PayoutChain } from './payouts-auto';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const TOKEN = 'internal-token-internal-token-internal-token-0123';
const MULTISIG = 'CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B';
const VAULT = vaultPda(MULTISIG);
const SOL = 1_000_000_000n;
let sql: Sql;
let now = new Date('2026-10-22T00:00:00.000Z');

type Chain = PayoutChain & {
  remaining: bigint;
  vault: bigint;
  signerLamports: bigint;
  members: string[];
  limitExists: boolean;
  height: number;
  landed: Map<string, { err: unknown }>;
  transfers: { to: string; lamports: bigint }[];
  mode: 'ok' | 'drop' | 'throw-but-land' | 'program-error';
  calls: string[];
  account(address: string): Promise<{ data: Uint8Array; owner: string; lamports: bigint } | null>;
  status(sig: string): Promise<{ confirmed: boolean; err: unknown } | null>;
};

function fakeChain(signer: string, spendingLimit: string): Chain {
  const chain: Chain = {
    remaining: 3n * SOL,
    vault: 10n * SOL,
    signerLamports: SOL,
    members: [signer],
    limitExists: true,
    height: 100,
    landed: new Map(),
    transfers: [],
    mode: 'ok',
    calls: [],
    async accounts(addresses) {
      chain.calls.push('getMultipleAccounts');
      return Promise.all(addresses.map((a) => chain.account(a)));
    },
    async statuses(sigs) {
      chain.calls.push('getSignatureStatuses');
      return Promise.all(sigs.map((sig) => chain.status(sig)));
    },
    async account(address) {
      if (address === spendingLimit) {
        if (!chain.limitExists) return null;
        return {
          owner: SQUADS_PROGRAM_ID,
          lamports: 2_000_000n,
          data: encodeSpendingLimitForTest({
            multisig: MULTISIG,
            createKey: randomKeypair().publicKey,
            vaultIndex: 0,
            mint: '11111111111111111111111111111111',
            amount: 3n * SOL,
            period: 'Day',
            remainingAmount: chain.remaining,
            lastReset: BigInt(Math.floor(now.getTime() / 1000)),
            bump: 255,
            members: chain.members,
            destinations: [],
          }),
        };
      }
      if (address === VAULT)
        return { owner: '1'.repeat(32), lamports: chain.vault, data: new Uint8Array() };
      if (address === signer)
        return { owner: '1'.repeat(32), lamports: chain.signerLamports, data: new Uint8Array() };
      return null;
    },
    async send(tx) {
      chain.calls.push('sendTransaction');
      const parsed = parseLegacyTx(tx);
      const sig = bs58.encode(parsed.signatures[0]!);
      if (chain.mode === 'drop') throw new Error('rpc timeout');
      expect(verifyTxSignatures(parsed)).toBe(true);
      const ix = parsed.instructions[0]!;
      expect(ix.programId).toBe(SQUADS_PROGRAM_ID);
      expect(ix.accounts[1]).toBe(signer);
      const lamports = new DataView(ix.data.buffer, ix.data.byteOffset).getBigUint64(8, true);
      if (chain.mode === 'program-error' || lamports > chain.remaining || lamports > chain.vault) {
        chain.landed.set(sig, { err: { InstructionError: [0, { Custom: 6026 }] } });
        return sig;
      }
      chain.remaining -= lamports;
      chain.vault -= lamports;
      chain.transfers.push({ to: ix.accounts[4]!, lamports });
      chain.landed.set(sig, { err: null });
      if (chain.mode === 'throw-but-land') throw new Error('rpc 502 after forwarding');
      return sig;
    },
    async status(sig) {
      const s = chain.landed.get(sig);
      return s ? { confirmed: true, err: s.err } : null;
    },
    blockHeight: async () => (chain.calls.push('getBlockHeight'), chain.height),
    blockhash: async () => {
      chain.calls.push('getLatestBlockhash');
      return {
        blockhash: bs58.encode(nacl.randomBytes(32)),
        lastValidBlockHeight: chain.height + 150,
      };
    },
  };
  return chain;
}

async function setup(extra: Record<string, string> = {}) {
  const signer = nacl.sign.keyPair();
  const signerPk = bs58.encode(signer.publicKey);
  const limit = spendingLimitPda(MULTISIG, randomKeypair().publicKey);
  const env = readEnv({
    SOLANA_CLUSTER: 'devnet',
    VAULT_ADDRESS: VAULT,
    MULTISIG_ADDRESS: MULTISIG,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    INTERNAL_TOKEN: TOKEN,
    HELIUS_WEBHOOK_SECRET: 'hook-secret-hook-secret-hook-secret-hook-0123',
    AI_ATTEST_SECRET: 'attest-secret-attest-secret-attest-secret-0123',
    SOLANA_RPC_URL: 'https://rpc.example',
    PAYOUT_SIGNER_SECRET: bs58.encode(signer.secretKey),
    PAYOUT_SPENDING_LIMIT: limit,
    ...extra,
  });
  const chain = fakeChain(signerPk, limit);
  const deps: Deps = {
    sql,
    blob: filesystemBlob(await mkdtemp(join(tmpdir(), 'tm-pay-')), env.sessionSecret, env.apiUrl),
    env,
    now: () => now,
    getTx: async () => null,
    blockhash: chain.blockhash,
    payoutChain: chain,
    opsFetch: (async () => Response.json({ result: 'ok' })) as unknown as typeof fetch,
  };
  return { deps, chain, signerPk };
}

async function line(amount: bigint, status = 'pending', recipient = randomKeypair().publicKey) {
  const [row] = await sql<{ id: string }[]>`
    insert into payouts (recipient, bucket, amount, status) values (${recipient}, 'creator', ${amount}, ${status}::payout_status)
    returning id
  `;
  return { id: row!.id, recipient };
}
const rowsOf = () => sql<Record<string, any>[]>`select * from payouts order by created_at, id`;

describe('automated payouts (Squads spending limit)', () => {
  beforeEach(async () => {
    sql ??= createSql(databaseUrl);
    await migrate(sql);
    await sql`truncate table ops_events, ops_alerts, audit_log, payouts restart identity cascade`;
    now = new Date('2026-10-22T00:00:00.000Z');
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('pays pending and proposed lines once, then confirms them', async () => {
    const { deps, chain } = await setup();
    const a = await line(10_000_000n);
    const b = await line(250_000_000n, 'proposed');
    const first = await autoPayouts(deps);
    expect(first).toMatchObject({ submitted: 2, confirmed: 0 });
    expect((await rowsOf()).map((r) => r.status)).toEqual(['sending', 'sending']);
    const second = await autoPayouts(deps);
    expect(second).toMatchObject({ submitted: 0, confirmed: 2 });
    const rows = await rowsOf();
    expect(rows.map((r) => [r.status, r.mode])).toEqual([
      ['sent', 'auto'],
      ['sent', 'auto'],
    ]);
    expect(chain.transfers).toEqual([
      { to: a.recipient, lamports: 10_000_000n },
      { to: b.recipient, lamports: 250_000_000n },
    ]);
    // Re-running never pays again.
    await autoPayouts(deps);
    await autoPayouts(deps);
    expect(chain.transfers).toHaveLength(2);
    const events = await sql`select action from audit_log where entity = 'payout' order by id`;
    expect(events.map((e) => e.action)).toEqual([
      'auto_submitted',
      'auto_submitted',
      'auto_sent',
      'auto_sent',
    ]);
  });

  it('two overlapping runs never double pay', async () => {
    const { deps, chain } = await setup();
    for (let i = 0; i < 6; i += 1) await line(1_000_000n);
    await Promise.all([autoPayouts(deps), autoPayouts(deps), autoPayouts(deps)]);
    await autoPayouts(deps);
    expect(chain.transfers).toHaveLength(6);
    expect((await rowsOf()).every((r) => r.status === 'sent')).toBe(true);
  });

  it('a send error that still landed is confirmed, not repaid', async () => {
    const { deps, chain } = await setup();
    await line(5_000_000n);
    chain.mode = 'throw-but-land';
    await autoPayouts(deps);
    chain.mode = 'ok';
    chain.height += 500; // even past expiry the landed signature wins
    expect(await autoPayouts(deps)).toMatchObject({ confirmed: 1, submitted: 0 });
    expect(chain.transfers).toHaveLength(1);
  });

  it('a dropped transaction is retried only after its blockhash expires', async () => {
    const { deps, chain } = await setup();
    await line(5_000_000n);
    chain.mode = 'drop';
    await autoPayouts(deps);
    chain.mode = 'ok';
    expect(await autoPayouts(deps)).toMatchObject({ retried: 0, submitted: 0 });
    chain.height += 151;
    expect(await autoPayouts(deps)).toMatchObject({ retried: 1, submitted: 1 });
    await autoPayouts(deps);
    const [row] = await rowsOf();
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(chain.transfers).toHaveLength(1);
  });

  it('gives up after repeated on-chain failures and raises PAYOUT_FAILED', async () => {
    const { deps, chain } = await setup();
    await line(5_000_000n);
    chain.mode = 'program-error';
    for (let i = 0; i < 12; i += 1) await autoPayouts(deps);
    const [row] = await rowsOf();
    expect(row).toMatchObject({ status: 'failed', attempts: 5 });
    expect(row!.last_error).toMatch(/failed on chain/);
    expect(chain.transfers).toHaveLength(0);
    expect((await opsCheck(deps)).map((a) => a.code)).toContain('PAYOUT_FAILED');
  });

  it('enforces the per-line cap, the rolling daily cap and the spending limit', async () => {
    const { deps, chain } = await setup({
      PAYOUT_MAX_LINE_LAMPORTS: String(SOL),
      PAYOUT_DAILY_CAP_LAMPORTS: String(2n * SOL),
    });
    const big = await line(2n * SOL);
    for (let i = 0; i < 3; i += 1) await line(800_000_000n);
    await autoPayouts(deps);
    await autoPayouts(deps);
    // 2 SOL/day: two 0.8 lines fit, the third waits; the 2 SOL line is held for Squads.
    expect(chain.transfers.map((t) => t.lamports)).toEqual([800_000_000n, 800_000_000n]);
    const held = (await rowsOf()).find((r) => r.id === big.id)!;
    expect(held.held_reason).toMatch(/per-line cap/);
    expect((await opsCheck(deps)).map((a) => a.code)).toContain('PAYOUT_HELD');
    // Only the held line goes to a Squads batch now.
    const batch = await proposePayouts(deps);
    expect(batch?.count).toBe(1);
    now = new Date(now.getTime() + 86_400_000 + 1000);
    await autoPayouts(deps);
    await autoPayouts(deps);
    expect(chain.transfers).toHaveLength(3);
    // The program's own allowance is respected too.
    chain.remaining = 100n;
    await line(5_000n);
    await autoPayouts(deps);
    expect(chain.transfers).toHaveLength(3);
  });

  it('keeps each run to a fixed, batched RPC budget and carries the rest over', async () => {
    const { deps, chain } = await setup();
    for (let i = 0; i < 12; i += 1) await line(1_000_000n);
    const first = await autoPayouts(deps);
    expect(first.submitted).toBe(5);
    expect(chain.calls.filter((c) => c === 'getMultipleAccounts')).toHaveLength(1);
    expect(chain.calls.filter((c) => c === 'getLatestBlockhash')).toHaveLength(1);
    expect(chain.calls.filter((c) => c === 'sendTransaction')).toHaveLength(5);
    expect(chain.calls.length).toBeLessThanOrEqual(8);
    chain.calls = [];
    // Next run: 5 confirmations in ONE status call, then 5 more lines.
    expect(await autoPayouts(deps)).toMatchObject({ confirmed: 5, submitted: 5 });
    expect(chain.calls.filter((c) => c === 'getSignatureStatuses')).toHaveLength(1);
    expect(chain.calls.length).toBeLessThanOrEqual(9);
    await autoPayouts(deps);
    await autoPayouts(deps);
    expect(chain.transfers).toHaveLength(12);
    expect((await rowsOf()).every((r) => r.status === 'sent')).toBe(true);
    chain.calls = [];
    await opsCheck(deps);
    expect(chain.calls).toEqual(['getMultipleAccounts']);
  });

  it('reports a Worker subrequest-limit error as SUBREQUEST_LIMIT, not RPC_DOWN', async () => {
    const { deps, chain } = await setup();
    chain.accounts = async () => {
      throw new Error('getMultipleAccounts: Too many subrequests by single Worker invocation.');
    };
    const codes = (await opsCheck(deps)).map((a) => a.code);
    expect(codes).toContain('SUBREQUEST_LIMIT');
    expect(codes).not.toContain('RPC_DOWN');
  });

  it('counts in-flight sends against the vault balance', async () => {
    const { deps, chain } = await setup();
    chain.vault = 500_000_000n;
    const a = await line(300_000_000n);
    await sql`update payouts set status = 'sending', mode = 'auto', tx_sig = 'inflight', valid_until_height = 10000, sent_at = ${now} where id = ${a.id}`;
    await line(300_000_000n);
    expect(await autoPayouts(deps)).toMatchObject({ submitted: 0 });
    expect(chain.transfers).toHaveLength(0);
  });

  it('pauses, and alerts, while the spending limit is missing or does not list the signer', async () => {
    const { deps, chain } = await setup();
    await line(5_000_000n);
    chain.limitExists = false;
    expect((await autoPayouts(deps)).skipped).toMatch(/does not exist/);
    const alerts = await opsCheck(deps);
    expect(alerts.find((a) => a.code === 'PAYOUT_LIMIT')?.message).toMatch(/proposal/);
    chain.limitExists = true;
    chain.members = [randomKeypair().publicKey];
    expect((await autoPayouts(deps)).skipped).toMatch(/not a member/);
    expect(chain.transfers).toHaveLength(0);
  });

  it('alerts on a low vault, a low signer and an exhausted allowance', async () => {
    const { deps, chain } = await setup();
    await line(2n * SOL, 'pending');
    await sql`update payouts set held_reason = null`;
    chain.vault = SOL;
    chain.signerLamports = 1000n;
    chain.remaining = SOL;
    const codes = (await opsCheck(deps)).map((a) => a.code);
    expect(codes).toEqual(
      expect.arrayContaining(['PAYOUT_BALANCE_LOW', 'LOW_BALANCE', 'PAYOUT_LIMIT']),
    );
  });

  it('refuses to mark a Squads batch sent once a line was paid automatically', async () => {
    const { deps } = await setup();
    const a = await line(5_000_000n, 'proposed');
    await sql`update payouts set batch_id = 'b1' where id = ${a.id}`;
    await autoPayouts(deps);
    await expect(markBatchSent(deps, 'b1', 'sig')).rejects.toMatchObject({
      code: 'BATCH_SUPERSEDED',
    });
  });

  it('stays off with PAYOUTS_AUTO=0 or without config, and rejects a wrong vault', async () => {
    const off = await setup({ PAYOUTS_AUTO: '0' });
    await line(5_000_000n);
    expect((await autoPayouts(off.deps)).skipped).toMatch(/off/);
    expect(off.chain.transfers).toHaveLength(0);
    const wrong = await setup({ VAULT_ADDRESS: randomKeypair().publicKey });
    expect(() => autoPayoutConfig(wrong.deps.env)).toThrow(/vault 0/);
    const capped = await setup({ PAYOUT_MAX_LINE_LAMPORTS: String(1000n * SOL) });
    expect(autoPayoutConfig(capped.deps.env)!.maxLineLamports).toBe(5n * SOL);
  });

  it('runs through POST /internal/cron/auto-payouts', async () => {
    const { deps, chain } = await setup();
    await line(5_000_000n);
    const app = createApp(deps);
    const call = () =>
      app.request('/api/v1/internal/cron/auto-payouts', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
    expect((await call()).status).toBe(200);
    const body = (await (await call()).json()) as { confirmed: number };
    expect(body.confirmed).toBe(1);
    expect(chain.transfers).toHaveLength(1);
    const denied = await app.request('/api/v1/internal/cron/auto-payouts', { method: 'POST' });
    expect(denied.status).toBeGreaterThanOrEqual(401);
  });
});
void randomUUID;
