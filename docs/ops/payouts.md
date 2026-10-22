# Automated payouts (Squads v4 spending limit)

Payout lines (creator price, fee buckets, refunds and verification fees that are paid from the
treasury vault) are paid by the backend, without a Squads proposal per batch, inside hard
limits that the multisig sets on chain and can revoke at any time.

## Trust model

| Party                                                                     | Can do                                                                                                                        | Cannot do                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Squads multisig `CaatcAQa…` (2-of-3)                                      | Everything: owns vault 0, the program upgrade authority, and the spending limit. Can remove the limit in one config proposal. | n/a                                                                                                                                                                                  |
| Payout signer `DmvdrZhd…` (hot key, Worker secret `PAYOUT_SIGNER_SECRET`) | Move native SOL out of vault 0 through `spending_limit_use`, up to the on-chain allowance per day. Pays its own tx fees.      | Vote, propose, execute vault or config transactions (it is **not** a multisig member). Touch SPL tokens, other vaults, the program, or the limit itself. Exceed the daily allowance. |
| API code                                                                  | Choose which ledger line to pay and to whom, inside the caps below.                                                           | Raise any cap past the code ceilings; pay a line twice.                                                                                                                              |

The worst case after a full compromise of the Worker and the payout key: an attacker drains at
most **one day's allowance** (3 SOL on devnet) to addresses of their choice, then nothing until
the next period. The ops watchdog alerts on every automated send failure and on low balances,
and the multisig stops it by removing the spending limit (or rotating the key: remove the
limit, add a new one with the new member).

## Caps

| Layer                                 | Cap (devnet)                                                                                          | Where                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| On chain, Squads program              | 3 SOL per Day period, mint = native SOL, vault index 0, members = [payout signer], destinations = any | Spending limit `AouBPFgDADdskb1fxETGHBLaSzDUH25PSb3PWq3zzJUd` (create key `CaF3d39o…`) |
| Backend, rolling 24 h                 | `PAYOUT_DAILY_CAP_LAMPORTS`, default 3 SOL, code ceiling 20 SOL                                       | `payouts-auto.ts`                                                                      |
| Backend, per line (= per transaction) | `PAYOUT_MAX_LINE_LAMPORTS`, default 0.5 SOL, code ceiling 5 SOL                                       | `payouts-auto.ts`                                                                      |
| Backend, per run                      | 10 lines per cron tick (every 5 min)                                                                  | `PAYOUT_LINES_PER_RUN`                                                                 |
| Vault floor                           | 0.001 SOL is never spent (rent)                                                                       | `payouts-auto.ts`                                                                      |

Squads v4 has no per-transaction field, so the per-transaction cap is the backend's per-line
cap; the period cap is enforced by the program. Destinations stay open because creators and
refunded buyers are arbitrary wallets. A line over the per-line cap is **held**
(`held_reason`), raises `PAYOUT_HELD`, and goes to the old Squads batch flow
(`proposePayouts`). Lines are paid oldest first; when the allowance runs out the rest waits
for the next period (no skipping ahead).

## Idempotency and retries

One payout line = one transaction = one `spending_limit_use` instruction with memo
`tm-payout:<payout id>`. The worker:

1. **Reconciles** every `sending` line: confirmed without error → `sent` (audit
   `auto_sent`); landed with an error or blockhash expired without landing → back to
   `pending`, `attempts + 1` (nothing moved); 5 attempts → `failed` (`PAYOUT_FAILED`).
2. Reads and **verifies the spending limit** (owner = Squads program, this multisig, vault 0,
   native SOL, signer is a member). Anything else pauses payouts (`PAYOUT_LIMIT`).
3. For each due line: signs the transaction, then **claims the row** with a conditional
   update `pending|proposed → sending` that stores the signature and the blockhash's last
   valid block height, and only then broadcasts. Overlapping runs cannot both claim a row; a
   crash after the claim leaves a stored signature that reconcile settles. A send error is
   never treated as "not sent": the line is only retried after its blockhash expired and the
   signature is not on chain.

Old Squads batches (`payout-batches/*.json`) whose lines were paid automatically are void:
`POST /admin/payouts/batches/:id/sent` answers `409 BATCH_SUPERSEDED` for them. Never execute
an old batch JSON in Squads.

## Alerts (`/internal/ops`)

| Code                 | Level    | Meaning                                                                                                           |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `PAYOUT_FAILED`      | critical | A line failed 5 times. Read `last_error`; set it back to `pending` after fixing, or pay it in Squads.             |
| `PAYOUT_LIMIT`       | warn     | Spending limit missing or mis-scoped (automation paused), or its allowance left this period is below what is due. |
| `PAYOUT_BALANCE_LOW` | critical | Vault 0 holds less than the payouts due.                                                                          |
| `LOW_BALANCE`        | critical | Payout signer below 0.02 SOL (fees).                                                                              |
| `PAYOUT_HELD`        | warn     | Lines over the per-line cap wait for a Squads batch.                                                              |
| `PAYOUTS_WAITING`    | warn     | Lines older than 48 h are still unpaid.                                                                           |

## Configuration

Worker secret `PAYOUT_SIGNER_SECRET` (never in a file in the repo); vars `MULTISIG_ADDRESS`,
`PAYOUT_SPENDING_LIMIT`, optional `PAYOUT_MAX_LINE_LAMPORTS`, `PAYOUT_DAILY_CAP_LAMPORTS`.
`PAYOUTS_AUTO=0` is the kill switch (back to manual batches). Without the secret or the limit
address the feature is off. Manual run: `POST /api/v1/internal/cron/auto-payouts` with the
internal token.

## Setting up the spending limit (one multisig signature)

The limit is a Squads **config transaction** `AddSpendingLimit` — it needs the multisig
threshold (2 of 3). Devnet proposal: **transaction index 9**, proposal
`2x4KQsYoPKr5ZAHefnQJ1bghoKENjhPssZjkYAJoKUx8`, created and approved by member-2
(`7K8W3Ekr…`). It needs one more approval (Roman, member-1 `Hhk5r1zJ…`) and then an execute:

- In the Squads app (devnet, multisig `CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B`) open
  transaction #9 "TrenchMart: automated payout spending limit", check it adds a spending limit
  of **3 SOL / day, SOL, vault 0, member `DmvdrZhdmokDeSGXLWHKetR1usxUHaf2SHve4nC4o3VP`, any
  destination**, then **Approve** and **Execute**.
- Or approve in Squads and run `node payout-limit.mjs execute` in `/workspace/trenchmart/devnet-setup`
  on the box (member-2 executes; executing is not a vote).

`node payout-limit.mjs status` shows the approvals and whether the limit exists. The next cron
tick after execution starts paying the waiting lines. To revoke: a config proposal
`RemoveSpendingLimit` for `AouBPFgD…`.
