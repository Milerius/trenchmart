// Automated payouts (docs/ops/payouts.md). The payout signer is a hot key that is NOT a
// multisig member: it is only a member of one Squads v4 spending limit (native SOL, vault 0,
// N lamports per day). The program enforces the period cap; this module adds a per-line cap,
// a rolling 24 h cap and one-line-per-transaction idempotency. The multisig can remove the
// spending limit at any time, which stops every automated payout.
import bs58 from 'bs58';
import {
  accountData,
  compileLegacyTx,
  decodeSpendingLimit,
  effectiveRemaining,
  latestBlockhash,
  NATIVE_MINT_DEFAULT,
  parseSecretKey,
  publicKeyOf,
  rpc,
  sendRaw,
  signatureOf,
  signTx,
  spendingLimitUseSolIx,
  SQUADS_PROGRAM_ID,
  type SpendingLimitAccount,
  vaultPda,
} from '@trenchmart/chain';
import { audit, type Deps } from './logic';

/** Code ceilings: env can lower the caps, never raise them past these. */
export const PAYOUT_CEILINGS = {
  maxLineLamports: 5_000_000_000n,
  dailyCapLamports: 20_000_000_000n,
};
export const PAYOUT_MAX_ATTEMPTS = 5;
export const PAYOUT_LINES_PER_RUN = 10;
/** The signer pays ~5000 lamports per payout; warn well before it runs dry. */
export const PAYOUT_SIGNER_MIN_LAMPORTS = 20_000_000n;

export type SigStatus = { confirmed: boolean; err: unknown } | null;
export type PayoutChain = {
  account(address: string): Promise<{ data: Uint8Array; owner: string; lamports: bigint } | null>;
  send(tx: Uint8Array): Promise<string>;
  status(signature: string): Promise<SigStatus>;
  blockHeight(): Promise<number>;
  blockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
};

export function rpcPayoutChain(url: string): PayoutChain {
  return {
    account: (address) => accountData(url, address),
    send: (tx) => sendRaw(url, tx),
    async status(signature) {
      const result = (await rpc(url, 'getSignatureStatuses', [
        [signature],
        { searchTransactionHistory: true },
      ])) as { value: Array<{ confirmationStatus?: string; err: unknown } | null> };
      const s = result.value[0];
      if (!s) return null;
      return {
        confirmed: s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized',
        err: s.err ?? null,
      };
    },
    blockHeight: async () =>
      Number(await rpc(url, 'getBlockHeight', [{ commitment: 'confirmed' }])),
    blockhash: () => latestBlockhash(url),
  };
}

export function payoutChainOf(deps: Deps): PayoutChain {
  return deps.payoutChain ?? rpcPayoutChain(deps.env.rpcUrl);
}

export type AutoPayoutConfig = {
  secret: Uint8Array;
  signer: string;
  multisig: string;
  vault: string;
  spendingLimit: string;
  maxLineLamports: bigint;
  dailyCapLamports: bigint;
};

/** Null when automation is off or not configured; throws on a contradictory configuration. */
export function autoPayoutConfig(env: Deps['env']): AutoPayoutConfig | null {
  const p = env.payout;
  if (!p.enabled || !p.signerSecret || !p.spendingLimit || !env.multisigAddress) return null;
  const secret = parseSecretKey(p.signerSecret);
  const signer = publicKeyOf(secret);
  const vault = vaultPda(env.multisigAddress, 0);
  if (env.vaultAddress && env.vaultAddress !== vault)
    throw new Error('VAULT_ADDRESS is not vault 0 of MULTISIG_ADDRESS');
  if (signer === vault) throw new Error('payout signer must not be the vault');
  return {
    secret,
    signer,
    multisig: env.multisigAddress,
    vault,
    spendingLimit: p.spendingLimit,
    maxLineLamports:
      p.maxLineLamports < PAYOUT_CEILINGS.maxLineLamports
        ? p.maxLineLamports
        : PAYOUT_CEILINGS.maxLineLamports,
    dailyCapLamports:
      p.dailyCapLamports < PAYOUT_CEILINGS.dailyCapLamports
        ? p.dailyCapLamports
        : PAYOUT_CEILINGS.dailyCapLamports,
  };
}

export type LimitCheck =
  { ok: true; limit: SpendingLimitAccount; lamports: bigint } | { ok: false; reason: string };

/** Reads the spending limit and refuses anything but the exact scope the design allows. */
export async function readSpendingLimit(
  chain: PayoutChain,
  cfg: AutoPayoutConfig,
): Promise<LimitCheck> {
  const info = await chain.account(cfg.spendingLimit);
  if (!info) return { ok: false, reason: 'spending limit account does not exist yet' };
  if (info.owner !== SQUADS_PROGRAM_ID)
    return { ok: false, reason: 'spending limit is not owned by the Squads program' };
  let limit: SpendingLimitAccount;
  try {
    limit = decodeSpendingLimit(info.data);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (limit.multisig !== cfg.multisig)
    return { ok: false, reason: 'spending limit belongs to another multisig' };
  if (limit.vaultIndex !== 0) return { ok: false, reason: 'spending limit is not on vault 0' };
  if (limit.mint !== NATIVE_MINT_DEFAULT)
    return { ok: false, reason: 'spending limit is not for native SOL' };
  if (!limit.members.includes(cfg.signer))
    return { ok: false, reason: 'payout signer is not a member of the spending limit' };
  return { ok: true, limit, lamports: info.lamports };
}

function validRecipient(recipient: string, cfg: AutoPayoutConfig): boolean {
  if (recipient === cfg.vault || recipient === cfg.multisig || recipient === cfg.spendingLimit)
    return false;
  try {
    return bs58.decode(recipient).length === 32;
  } catch {
    return false;
  }
}

type Row = Record<string, any>;

export type AutoPayoutResult = {
  skipped?: string;
  confirmed: number;
  retried: number;
  failed: number;
  submitted: number;
  held: number;
};

/** Settle in-flight lines: confirmed → sent; failed or expired → retry (nothing moved). */
async function reconcile(deps: Deps, chain: PayoutChain, out: AutoPayoutResult): Promise<void> {
  const rows = await deps.sql<Row[]>`
    select * from payouts where status = 'sending' and mode = 'auto' order by sent_at asc limit 50
  `;
  if (rows.length === 0) return;
  let height: number | null = null;
  for (const row of rows) {
    const status = await chain.status(row.tx_sig as string);
    if (status && status.confirmed && !status.err) {
      const done = await deps.sql`
        update payouts set status = 'sent', last_error = null
        where id = ${row.id} and status = 'sending' and tx_sig = ${row.tx_sig} returning id
      `;
      if (done.length) {
        out.confirmed += 1;
        await audit(deps.sql, null, 'payout', row.id as string, 'auto_sent', {
          txSig: row.tx_sig,
          lamports: String(row.amount),
          recipient: row.recipient,
        });
      }
      continue;
    }
    let reason: string | null = null;
    if (status?.err) reason = `transaction failed on chain: ${JSON.stringify(status.err)}`;
    else if (!status) {
      height ??= await chain.blockHeight();
      // Expired: the signed transaction can never land, so a new one is safe.
      if (height > Number(row.valid_until_height)) reason = 'blockhash expired before landing';
    }
    if (!reason) continue; // still in flight
    const attempts = (row.attempts as number) + 1;
    const next = attempts >= PAYOUT_MAX_ATTEMPTS ? 'failed' : 'pending';
    await deps.sql`
      update payouts set status = ${next}, attempts = ${attempts}, last_error = ${reason}
      where id = ${row.id} and status = 'sending' and tx_sig = ${row.tx_sig}
    `;
    if (next === 'failed') {
      out.failed += 1;
      console.error('ALERT payout failed', row.id, reason);
      await audit(deps.sql, null, 'payout', row.id as string, 'auto_failed', { reason });
    } else out.retried += 1;
  }
}

export async function autoPayouts(deps: Deps): Promise<AutoPayoutResult> {
  const out: AutoPayoutResult = { confirmed: 0, retried: 0, failed: 0, submitted: 0, held: 0 };
  const cfg = autoPayoutConfig(deps.env);
  if (!cfg) return { ...out, skipped: 'automation is off or not configured' };
  const chain = payoutChainOf(deps);
  await reconcile(deps, chain, out);

  const check = await readSpendingLimit(chain, cfg);
  if (!check.ok) return { ...out, skipped: check.reason };
  const nowSec = Math.floor(deps.now().getTime() / 1000);
  const [spent] = await deps.sql<{ sum: bigint }[]>`
    select coalesce(sum(amount), 0)::bigint as sum from payouts
    where mode = 'auto' and status in ('sending', 'sent')
      and sent_at > ${new Date(deps.now().getTime() - 86_400_000)}
  `;
  const vault = await chain.account(cfg.vault);
  // Keep the vault rent-exempt and never spend more than the program or our cap allows.
  let budget = [
    effectiveRemaining(check.limit, nowSec),
    cfg.dailyCapLamports - (spent?.sum ?? 0n),
    (vault?.lamports ?? 0n) - 1_000_000n,
  ].reduce((a, b) => (a < b ? a : b));

  const rows = await deps.sql<Row[]>`
    select * from payouts
    where status in ('pending', 'proposed') and held_reason is null
      and recipient not like 'UNCONFIGURED:%' and attempts < ${PAYOUT_MAX_ATTEMPTS}
    order by created_at asc
    limit ${PAYOUT_LINES_PER_RUN}
  `;
  for (const row of rows) {
    const amount = row.amount as bigint;
    const hold =
      amount <= 0n
        ? 'non-positive amount'
        : amount > cfg.maxLineLamports
          ? `over the per-line cap of ${cfg.maxLineLamports} lamports`
          : !validRecipient(row.recipient as string, cfg)
            ? 'invalid recipient'
            : null;
    if (hold) {
      await deps.sql`update payouts set held_reason = ${hold} where id = ${row.id} and held_reason is null`;
      await audit(deps.sql, null, 'payout', row.id as string, 'auto_held', { reason: hold });
      out.held += 1;
      continue;
    }
    if (amount > budget) break; // oldest first: wait for the next period instead of skipping
    const latest = await chain.blockhash();
    const tx = signTx(
      compileLegacyTx({
        feePayer: cfg.signer,
        recentBlockhash: latest.blockhash,
        instructions: [
          spendingLimitUseSolIx({
            multisig: cfg.multisig,
            member: cfg.signer,
            spendingLimit: cfg.spendingLimit,
            vault: cfg.vault,
            destination: row.recipient as string,
            lamports: amount,
            memo: `tm-payout:${row.id}`,
          }),
        ],
      }),
      [cfg.secret],
    );
    const sig = signatureOf(tx);
    // Claim and persist the signature before broadcast: the row is the idempotency key.
    const claimed = await deps.sql`
      update payouts set status = 'sending', mode = 'auto', tx_sig = ${sig},
        valid_until_height = ${latest.lastValidBlockHeight}, sent_at = ${deps.now()}
      where id = ${row.id} and status in ('pending', 'proposed') and held_reason is null
      returning id
    `;
    if (claimed.length === 0) continue;
    budget -= amount;
    out.submitted += 1;
    try {
      await chain.send(tx);
    } catch (err) {
      // Not proof that it did not land: reconcile decides after the blockhash expires.
      await deps.sql`update payouts set last_error = ${(err as Error).message.slice(0, 500)} where id = ${row.id}`;
    }
    await audit(deps.sql, null, 'payout', row.id as string, 'auto_submitted', {
      txSig: sig,
      lamports: String(amount),
      recipient: row.recipient,
    });
  }
  return out;
}

export type PayoutHealth = { level: 'warn' | 'critical'; code: string; message: string }[];

/** Watchdog checks for /internal/ops: failures, holds, and the money left to pay with. */
export async function payoutHealth(deps: Deps): Promise<PayoutHealth> {
  const alerts: PayoutHealth = [];
  const [failed] = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from payouts where status = 'failed'
  `;
  if ((failed?.n ?? 0) > 0)
    alerts.push({
      level: 'critical',
      code: 'PAYOUT_FAILED',
      message: `${failed!.n} payout line(s) failed ${PAYOUT_MAX_ATTEMPTS} times; see last_error, then reset to pending or pay through Squads`,
    });
  const [held] = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from payouts where status in ('pending', 'proposed') and held_reason is not null
  `;
  if ((held?.n ?? 0) > 0)
    alerts.push({
      level: 'warn',
      code: 'PAYOUT_HELD',
      message: `${held!.n} payout line(s) are over the automated caps and need a Squads batch`,
    });
  let cfg: AutoPayoutConfig | null;
  try {
    cfg = autoPayoutConfig(deps.env);
  } catch (err) {
    alerts.push({ level: 'critical', code: 'PAYOUT_LIMIT', message: (err as Error).message });
    return alerts;
  }
  if (!cfg) return alerts;
  const chain = payoutChainOf(deps);
  const [due] = await deps.sql<{ sum: bigint }[]>`
    select coalesce(sum(amount), 0)::bigint as sum from payouts
    where status in ('pending', 'proposed', 'sending') and held_reason is null
      and recipient not like 'UNCONFIGURED:%'
  `;
  const owed = due?.sum ?? 0n;
  try {
    const signer = await chain.account(cfg.signer);
    if ((signer?.lamports ?? 0n) < PAYOUT_SIGNER_MIN_LAMPORTS)
      alerts.push({
        level: 'critical',
        code: 'LOW_BALANCE',
        message: `payout signer ${cfg.signer} holds ${Number(signer?.lamports ?? 0n) / 1e9} SOL; top it up so payout fees can be paid`,
      });
    const vault = await chain.account(cfg.vault);
    if ((vault?.lamports ?? 0n) < owed + 1_000_000n)
      alerts.push({
        level: 'critical',
        code: 'PAYOUT_BALANCE_LOW',
        message: `vault holds ${Number(vault?.lamports ?? 0n) / 1e9} SOL but ${Number(owed) / 1e9} SOL of payouts are due`,
      });
    const check = await readSpendingLimit(chain, cfg);
    if (!check.ok)
      alerts.push({
        level: 'warn',
        code: 'PAYOUT_LIMIT',
        message: `automated payouts are paused: ${check.reason} (the Squads spending-limit proposal needs its signatures)`,
      });
    else {
      const left = effectiveRemaining(check.limit, Math.floor(deps.now().getTime() / 1000));
      if (left < owed)
        alerts.push({
          level: 'warn',
          code: 'PAYOUT_LIMIT',
          message: `spending limit has ${Number(left) / 1e9} SOL left this period; ${Number(owed) / 1e9} SOL is due, the rest waits for the reset`,
        });
    }
  } catch (err) {
    alerts.push({
      level: 'critical',
      code: 'RPC_DOWN',
      message: `payout check failed: ${(err as Error).message}`,
    });
  }
  return alerts;
}
