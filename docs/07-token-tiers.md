# 07 · $TRENCH token & holder tiers

- Token launches on **pump.fun** (fair launch). The marketplace never mints; it only reads balances. `TRENCH_MINT` env var; until launch, use a devnet SPL token you create for testing.
- pump.fun tokens use 6 decimals; read `decimals` from the mint, don't hard-code.

## Tiers

Thresholds are whole $TRENCH (1,000,000,000 supply, 6 decimals), stored in `config.tier_thresholds` and compared with base-unit balances (`× 10^trench_decimals`).

| Tier         | Requirement        | Perks                                                                                                                               |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| None         | —                  | Standard 5% fee                                                                                                                     |
| **Scout**    | ≥ 100,000 (0.01%)  | −25% marketplace fee · holder price on listings · holder badge on reviews                                                           |
| **Trencher** | ≥ 1,000,000 (0.1%) | −60% fee · free verification for own uploads · 48h early access to new listings · holder-only listings · vote on featured (phase 2) |
| **OG**       | ≥ 10,000,000 (1%)  | 0% marketplace fee · everything in Trencher · 50% creator bond · private alpha room link · can apply to be a verifier               |

## Anti-gaming rule

Tier = based on the **lowest balance held at any point in the last 72h** (`tier_window_hours`).

- One tier per wallet. Linked wallets don't stack (POC: tiers only look at the signed-in wallet).
- Re-computed at quote time and stored on the order (`tier_at_purchase`).
- Phase 2: count tokens staked in an on-site staking program as held.

## Data flow

```
  $TRENCH transfer on-chain
          │
          ▼
  Helius enhanced webhook (type: TRANSFER, accountAddresses: [TRENCH_MINT])
          │
          ▼
  POST /hooks/helius ──▶ for each affected owner wallet:
                          read post-balance from tx meta (postTokenBalances)
                          insert token_balances(wallet, amount, ts=blockTime, 'webhook', sig)
                          (idempotent on (wallet, tx_sig))

  First sign-in of a wallet ──▶ RPC getTokenAccountsByOwner(wallet, {mint})
                                insert 'snapshot' row (ts = now)
  Hourly reconcile ──▶ same RPC for wallets active in 24h; insert 'reconcile' row if differs
```

## Min-balance query

Need the balance at the window start plus every change inside the window:

```sql
with w as (select now() - make_interval(hours => $2) as start)
select coalesce(min(amount), 0) as min_balance from (
  -- balance in effect at window start
  (select amount from token_balances, w
    where wallet = $1 and ts <= w.start
    order by ts desc limit 1)
  union all
  -- every balance inside the window
  (select amount from token_balances, w
    where wallet = $1 and ts > w.start)
) b;
```

Edge: a wallet whose first ever row is inside the window has no "at start" row. Treat missing pre-window history as **0** only if the first row is a `webhook` row (they acquired during the window); if the first row is a `snapshot` (we just never saw them before), trust the snapshot. Encode that in `packages/shared/tier.ts` with tests.

```ts
export function tierFor(
  minBalance: bigint,
  t: { scout?: bigint; trencher?: bigint; og?: bigint },
): Tier {
  if (t.og && minBalance >= t.og) return 'og';
  if (t.trencher && minBalance >= t.trencher) return 'trencher';
  if (t.scout && minBalance >= t.scout) return 'scout';
  return 'none';
}
```

Thresholds are stored as whole-token integer strings in config (`"100000"`, `"1000000"`, `"10000000"`). A value that is not an integer string → undefined → that tier is disabled.

## Where tier is used

- `/me` (navbar chip "Trencher tier · 60% off fees")
- `/orders/quote` and `/orders` (rebate)
- Browse: holder-only window (`listings.first_live_at + holder_only_hours > now()` → only tier ≥ scout can buy; others see a lock)
- Studio: verification fee waiver, bond discount
- Verifier application gating

## Revenue → token

- POC: `bucket:buyback` accumulates in the ledger; ops manually swaps SOL→$TRENCH (Jupiter) on a published schedule and posts tx sigs on the $TRENCH page. Burn vs reward split decided later by governance.
- Show on the $TRENCH page: total buyback SOL to date, last buyback tx (from a `buybacks` admin-entered table, add if needed).
