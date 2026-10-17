# 06 · Payments, escrow, payouts, disputes

## Fee model (proposed, all in `config`)

| Fee                | Who pays            | Amount                                                     | Holder discount                                | Why                             |
| ------------------ | ------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------- |
| Marketplace fee    | Buyer at checkout   | 5% of price (`fee_bps=500`)                                | Scout −25%, Trencher −60%, OG −100% of the fee | Main revenue                    |
| Creator commission | Creator             | 0%                                                         | —                                              | Attract supply                  |
| Verification fee   | Creator per version | 0.25 SOL                                                   | Free from Trencher                             | Pays reviewers, stops spam      |
| Creator bond       | Creator, refundable | 1–5 SOL by category (UI also shows larger voluntary bonds) | OG −50%                                        | Slashed for malicious listings  |
| Featured slot      | Creator, optional   | `[X]` SOL / week                                           | −20% if paid in $TRENCH                        | Promotion (phase 2)             |
| Subscriptions      | Buyer, recurring    | 5% of each renewal                                         | Same as marketplace                            | Live wallet lists / alert feeds |

**Fee split** of each collected fee (after rebate): buyback 40% · verifiers 25% · ops 20% · safety 15%. Verification fees go 100% to the verifiers bucket.

## Fee math (`packages/shared/fee.ts`)

```ts
export function quote(price: bigint, feeBps: number, rebateBps: number) {
  const fee = (price * BigInt(feeBps)) / 10_000n; // floor
  const rebate = (fee * BigInt(rebateBps)) / 10_000n; // floor
  const total = price + fee - rebate;
  return { price, fee, rebate, total, netFee: fee - rebate };
}

export function splitFee(netFee: bigint, split: Record<string, number>) {
  // allocate by bps, give rounding dust to 'ops'
  const out: Record<string, bigint> = {};
  let used = 0n;
  for (const [k, bps] of Object.entries(split)) {
    out[k] = (netFee * BigInt(bps)) / 10_000n;
    used += out[k];
  }
  out.ops += netFee - used;
  return out;
}
```

Worked example (matches the listing design): price 1.5 SOL, Trencher → fee 0.075, rebate 0.045, total 1.530 SOL.

Tests: zero price, OG (total == price), rounding never makes `sum(split) != netFee`.

## Checkout sequence

```
 BUYER                      API                         SOLANA
 Click "Buy" ───────────▶ quote (tier from 72h min balance)
                          create order PENDING (ttl 20m, memo tm:<id8>)
          ◀──── unsigned tx: SystemProgram.transfer(buyer → VAULT, total)
                            + Memo("tm:<id8>")
 Sign & send ────────────────────────────────────────▶ confirmed
 POST /orders/:id/submitted {txSig}
                          verify (see 04-api) ◀── also Helius webhook
                          PAID · escrow_until = +48h · license created
          ◀──── download button enabled (signed URL, watermarked)
```

Build the tx server-side with `@solana/web3.js` (or `@solana/kit`), return base64; client deserializes and calls `wallet.sendTransaction`. Price snapshot is locked into the order; price edits don't affect pending orders.

## Escrow vault (POC)

- `VAULT_ADDRESS` = a Squads multisig vault PDA. The API **never** holds a key that can move vault funds.
- The `ledger` table tracks what portion of the vault belongs to whom. Invariant (checked hourly, alert on mismatch): `on-chain vault balance ≥ sum(ledger where account='vault')`.

## Release & payout

- `releaseEscrow` cron: for each `paid` order with `escrow_until < now()`, no open dispute and tx `finalized`:
  - status → released
  - payouts: `creator` = price → creator wallet; for each fee bucket → its configured wallet (`BUCKET_WALLET_*`).
  - ledger: `-total vault`, `+price creator:<id>`, `+bucket amounts`.
- `executePayouts` cron groups pending payouts into a batch (≤ 15 transfers per tx), writes a batch JSON to R2 `payout-batches/<id>.json`, marks `proposed`. Admin page shows the batch; a signer creates the Squads proposal (or, phase 2, the API proposes via Squads SDK using a proposer-only key). After execution admin posts the tx sig → `sent`.

## Disputes

- Buyer can open while `now < escrow_until` (any reason) or up to 30 days for `malicious`.
- Opening sets order → `disputed` and pauses release.
- Admin resolves:
  - **upheld** → refund payout of `order.total` to buyer (from vault if not released; else from creator bond via slash; else safety fund). Order → refunded. For `malicious`: delist, slash bond, re-check every other order of that version.
  - **rejected** → order → paid (release on next cron if window passed).
- Every resolution writes `audit_log` and notifies both sides.

## Bonds

- Deposit: transfer to vault with memo `bond:<id8>` → active on verify.
- Required amount = `bond_lamports_by_category[max category of live listings]` × (OG ? 0.5 : 1).
- Withdraw: request → unlocking; `unlock_at = last delist + bond_unlock_days`; then payout.
- Slash: move from `bond:<id>` ledger account to `refund`/`safety`. If remaining < required, pause creator's listings (`holder_only=false`, hide from browse) until topped up.

## Phase 2: on-chain escrow (Anchor)

Program `trench_escrow` with accounts `Config`, `Order` (PDA per order id), `Bond` (PDA per creator). Instructions: `pay`, `release` (permissionless after `escrow_until`), `dispute` (buyer), `resolve` (admin multisig), `deposit_bond`, `slash`, `withdraw_bond`. Fee split executed on release. **Requires an external audit before mainnet.**
