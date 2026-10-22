# $MART holder rewards (every 3 h, devnet)

50% of **net** platform revenue goes to the top 1,000 $MART holders every epoch (3 h), in SOL,
pushed automatically. The other 50% goes to the four fee buckets in their configured
proportions (buyback 40 / verification 25 / ops 20 / safety 15 of that half).

> Legal: sharing revenue with token holders may be treated as a security in some
> jurisdictions. Roman decides; this is a devnet build.

## Money path

| Step      | What                                                                                                                                                                                                                                                                                                                          | Where                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Fee split | With `REWARDS_SPLIT=1`, new fees use the 4-slot split `buyback 7000 / ai 1250 / ops 1000 / safety 750` bps. The buyback slot (holders 50% + buyback 20%) is paid to the **rewards vault** = Squads vault index 1 (`REWARDS_VAULT_INDEX`). Escrow orders keep the split they were created with; settle accepts either routing. | `feeRouting` in `rewards.ts`, `escrow.ts` |
| Revenue   | Each released item that paid the rewards vault is one `reward_revenue` row (`ref` unique: retries never count twice): orders at escrow release, verification fees, featuring, supplements, renewals. Refunded or disputed orders are never released, so they never count.                                                     | `recordRevenue`                           |
| Costs     | Per epoch, ledgered in `reward_costs`: `rpc` and `infra` (env, lamports per epoch, pro-rata), `network_fee` and `priority_fee` (the epoch's own batch transactions, 5000 + 100 lamports each), `payout_fee` (the Squads funding transaction).                                                                                 | `closeEpoch`                              |
| Pool      | `holder_pool = holder_gross − ceil(costs / 2) + carry_in`. The cost half stays in the rewards vault as `cost_reserve` (multisig sweeps it to ops). The buyback 20% (`buyback_forward`) is forwarded to `BUCKET_WALLET_BUYBACK` in batch 0.                                                                                    |                                           |
| Funding   | One `spending_limit_use` (vault 1 → rewards hot wallet, memo `tm-reward-fund:<epoch>`) for exactly the paid shares + buyback forward + fees.                                                                                                                                                                                  | `fund`                                    |
| Push      | Plain SOL transfers from the hot wallet, **20 recipients per legacy transaction** (≈1,206 of 1,232 bytes, ~6k CU, CU limit 10k). One Cloudflare Queue message per batch (`rewards-send`), the cron is the fallback sender.                                                                                                    | `batchTx`, `processBatchMessage`          |

## Eligibility and anti-gaming

- **Top 1,000** owners by weight, after exclusions. Weight = the owner's **lowest** balance
  across **6 random samples** in the epoch (sample ticks come from `HMAC(SESSION_SECRET, epoch)`;
  the seed is published in the feed once the epoch closes). A buy right before "the snapshot"
  earns nothing: the wallet must hold through every sample. An owner that misses any sample
  (or appears after the first) has weight 0.
- **2-epoch hold**: the owner must also have held through every sample of the previous epoch.
- **Minimum 0.05% of supply** (`REWARDS_MIN_SUPPLY_BPS=5`), in both epochs.
- **Ties at rank 1,000**: weight desc → first seen (older holder first) → pubkey bytes asc.
- **Exclusions**: off-curve owners (PDAs: bonding curve, AMM/LP vaults, program accounts), the
  vaults, multisig, hot wallets, bucket wallets, the mint, the escrow program and resolver, the
  incinerator, and `reward_exclusions` (team, CEX…; `POST /internal/rewards/exclusions`).
- Splitting a balance across wallets only lowers each wallet's rank.

## Payouts and carry-over

`share = floor(pool × weight / Σweight)`. With the wallet's carried amount added, totals of at
least **0.01 SOL** (`REWARDS_MIN_PAYOUT_LAMPORTS`) are paid; smaller totals carry over
(`reward_holders.carry`) and are paid once they reach it. Rounding dust and pools with nobody
eligible roll into the next epoch (`carry_in`). Carried lamports stay in the rewards vault.

## Cost (real fees: 5,000 lamports/signature; priority 10,000 µlamports/CU → 100 lamports per batch tx, 600 for the funding tx)

| Recipients            | Tx / epoch (20 per tx + 1 funding) | SOL / epoch | SOL / day (8 epochs) | SOL / 30 days |
| --------------------- | ---------------------------------- | ----------- | -------------------- | ------------- |
| 100                   | 5 + 1                              | 0.0000311   | 0.000249             | 0.0075        |
| 1,000                 | 50 + 1                             | 0.0002606   | 0.002085             | 0.0625        |
| 10,000 (cap is 1,000) | 500 + 1                            | 0.0025556   | 0.020445             | 0.6133        |

## Idempotency and retries

Same pattern as payouts: sign → store signature + blockhash expiry with a conditional update
(`pending → sending`, `closed → funding`) → broadcast. Reconcile with one
`getSignatureStatuses`: confirmed → `sent`; failed on chain or expired unlanded → back to
`pending`, `attempts + 1`; 5 attempts → `failed` (batch) or `halted` (funding). A send error is
never treated as "not sent". Epoch states: `open → closed → funding → paying → paid`
(`halted` needs `POST /api/v1/internal/rewards/resume/:epoch`). One epoch moves at a time.

## Subrequest budget

Cron tick: a balance sample is 2 calls (mint + one `getProgramAccounts`), funding is 3
(`getMultipleAccounts`, `getLatestBlockhash`, `sendTransaction`), reconcile is 1, plus at most
2 inline batch sends. Each queue message (one batch) is ≈ 3 calls in its own invocation.

## Caps, kill switch, alerts

- On chain: rewards spending limit, vault 1, native SOL, member = destination = the rewards hot
  wallet only. The code refuses any other scope.
- `REWARDS_MAX_EPOCH_LAMPORTS` (default 10 SOL, code ceiling 50 SOL) and an anomaly check (pool
  over 3× the median of the last 8 paid epochs and over 1 SOL) **halt** the epoch.
- `REWARDS_AUTO=0`: sampling and allocation keep running, nothing is funded or sent. Removing the
  spending limit through Squads is the hard stop.

| Code                     | Level    | Meaning                                                                              |
| ------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `REWARD_FAILED`          | critical | A batch failed 5 times or funding failed 5 times (epoch halted).                     |
| `REWARD_POOL_ANOMALY`    | warn     | Epoch halted by the per-epoch cap or the anomaly check; review, then resume.         |
| `REWARD_LIMIT`           | warn     | Rewards spending limit missing, mis-scoped, or short this period.                    |
| `REWARD_BALANCE_LOW`     | critical | Rewards vault holds less than the funding due.                                       |
| `REWARD_RECONCILE`       | critical | Sent batches ≠ ledger (paid shares + buyback forward) for a paid epoch.              |
| `REWARD_SNAPSHOT_MISSED` | warn     | An epoch closed without all 6 samples (nobody eligible that epoch; pool rolls over). |
| `REWARDS_WAITING`        | warn     | An epoch ended > 6 h ago and is not paid.                                            |
| `LOW_BALANCE`            | critical | Rewards hot wallet below 0.02 SOL (it pays the funding fee).                         |

## Public feed

- `GET /api/v1/rewards/epochs/recent?limit=` – closed epochs: revenue, cost lines, pool,
  eligible / paid / carried, funding signature, every batch signature, seed and sample ticks.
  `holderPool` ("To holders") is this epoch's net pool; `paid` ("Paid") is the SOL actually sent
  to holders, summed from the holder lines of batches reconciled as `sent` on chain, so it
  includes the carry-in it settles and excludes the buyback forward. A fully carried epoch has
  `paid.lamports = "0"` and the UI shows "carried".
- `GET /api/v1/rewards/current` – current epoch, countdown, revenue so far, rules.
- `GET /api/v1/rewards/wallet/:pubkey` – rank, weight, share, carry and signature per epoch.

Shown on `/rewards`, `/status` and `/docs/treasury` with Solscan devnet links.

## Configuration

Secret `REWARDS_SIGNER_SECRET`; vars `MART_MINT` (alias `TRENCH_MINT` for one release),
`REWARDS_SPENDING_LIMIT`, `REWARDS_SPLIT=1`, optional `REWARDS_VAULT_INDEX` (1),
`REWARDS_EPOCH_SECONDS` (10800; ≥ 900, shortened only for the devnet end-to-end run),
`REWARDS_TOP_N`, `REWARDS_MIN_SUPPLY_BPS`, `REWARDS_MIN_PAYOUT_LAMPORTS`,
`REWARDS_MAX_EPOCH_LAMPORTS`, `REWARDS_COST_RPC_LAMPORTS`, `REWARDS_COST_INFRA_LAMPORTS`,
`REWARDS_AUTO`. Queue `rewards-send` (+ DLQ `rewards-send-dlq`). Manual tick:
`POST /api/v1/internal/cron/rewards` with the internal token.
