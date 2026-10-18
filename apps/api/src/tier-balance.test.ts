import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrate, type Sql } from '@trenchmart/db';
import { parseAppConfig } from '@trenchmart/shared';
import { BALANCE_RECONCILE_MS, ensureSnapshot, tierForWallet, type Deps } from './logic';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const WHOLE = 1_000_000n; // 6 decimals
const wallet = 'TierWa11et1111111111111111111111111111111111';

let sql: Sql;
let clock = new Date('2026-06-01T00:00:00.000Z');
let onChain: bigint | Error = 0n;

function deps(): Deps {
  return {
    sql,
    now: () => clock,
    trenchBalance: async () => {
      if (onChain instanceof Error) throw onChain;
      return onChain;
    },
  } as unknown as Deps;
}

beforeAll(async () => {
  sql = createSql(databaseUrl);
  await migrate(sql);
});
afterAll(async () => sql.end({ timeout: 5 }));
beforeEach(async () => {
  await sql`delete from token_balances where wallet = ${wallet}`;
  clock = new Date('2026-06-01T00:00:00.000Z');
});

describe('$TRENCH holder tiers read from chain', () => {
  const config = parseAppConfig({});

  it('trusts the first on-chain snapshot: 1.5M TRENCH is Trencher (60% off the fee)', async () => {
    onChain = 1_500_000n * WHOLE;
    await ensureSnapshot(deps(), wallet);
    const tier = await tierForWallet(deps(), wallet, config);
    expect(tier.tier).toBe('trencher');
    expect(config.tier_rebate_bps[tier.tier]).toBe(6000);
  });

  it('an increase only counts after the 72h window; a drop counts at once', async () => {
    onChain = 150_000n * WHOLE;
    await ensureSnapshot(deps(), wallet);
    expect((await tierForWallet(deps(), wallet, config)).tier).toBe('scout');

    clock = new Date(clock.getTime() + BALANCE_RECONCILE_MS + 1);
    onChain = 20_000_000n * WHOLE;
    expect((await tierForWallet(deps(), wallet, config)).tier).toBe('scout');

    clock = new Date(clock.getTime() + 73 * 3_600_000);
    expect((await tierForWallet(deps(), wallet, config)).tier).toBe('og');

    clock = new Date(clock.getTime() + BALANCE_RECONCILE_MS + 1);
    onChain = 0n;
    expect((await tierForWallet(deps(), wallet, config)).tier).toBe('none');
  });

  it('an RPC failure never invents a balance', async () => {
    onChain = new Error('rpc down');
    await ensureSnapshot(deps(), wallet);
    const rows = await sql`select 1 from token_balances where wallet = ${wallet}`;
    expect(rows.length).toBe(0);
    expect((await tierForWallet(deps(), wallet, config)).tier).toBe('none');
  });
});
