# Escrow security review

Scope: `programs/trench_escrow` (Anchor 1.2.1, devnet `Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw`) and the code that builds, signs and verifies escrow transactions: `packages/chain/src/escrow.ts`, `apps/api/src/escrow.ts`, and the escrow paths in `apps/api/src/logic.ts` (`createOrder`, `verifyEscrowFunding`, `releaseOrders`/`releaseEscrow`, `openDispute`, `disputeTx`, `resolveDispute`). Spot checks of `apps/api/src/app.ts` and `apps/api/src/env.ts` where they decide who can reach those paths.

Reviewed at `origin/main` 74d3370 (2026-10-18). Internal review, not a third-party audit. Nothing was redeployed. The devnet program is unchanged.

## Summary

The program's core money paths hold up. Lamports leave an escrow only to pubkeys stored at `initialize` (seller and four buckets on `release`, buyer on `refund`). Each payout is exactly the deposit. Time gates and signers are enforced. Look-alike, re-initialized and substituted accounts are rejected. Mutation testing confirmed that the new tests catch each of these checks being removed (see [Tests](#tests)).

The real risks are in the design around the program, not in its arithmetic:

- a dispute recorded off chain does not stop a permissionless on-chain release (M-01);
- one hot resolver key per escrow, with no rotation and no timeout (M-02);
- unsafe default secrets and a spoofable rate limiter in the API (H-01, M-03);
- unverified X handles (M-04).

| ID   | Severity | Area    | Title                                                                               | Status                                                                                    |
| ---- | -------- | ------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| H-01 | High\*   | API     | Secrets fall back to public `change-me` defaults                                    | **Fixed** #36 (fail closed, secrets rotated) + #46                                        |
| M-01 | Medium   | Program | An off-chain dispute does not freeze funds until the buyer signs `open_dispute`     | **Fixed** #37 (resolver `freeze`, live on devnet)                                         |
| M-02 | Medium   | Program | One hot resolver key per escrow: no rotation, no timeout; it also pays release fees | **Fixed** #37 (config PDA, `set_resolver`, 7-day `refund_after_timeout`, crank fee payer) |
| M-03 | Medium   | API     | Rate limit keyed on client-controlled `X-Forwarded-For`; one DB write per request   | **Fixed** #38 (Workers rate-limit binding on proxied client IP)                           |
| M-04 | Medium   | API     | X handle linking is unverified (`POST /studio/x`): creators can impersonate         | **Fixed** #42 (X OAuth 2.0 PKCE; needs X app credentials)                                 |
| L-01 | Low      | Program | Escrow rent (0.00294 SOL) is never reclaimed; no `close` instruction                | **Fixed** #37 (`close`, cron housekeeping)                                                |
| L-02 | Low      | Program | PDA seeds omit the buyer, so a known order id can be squatted (griefing)            | **Fixed** #37 (seeds `["escrow", buyer, order_id]`)                                       |
| L-03 | Low      | Program | A sub-rent credit to an empty recipient blocks `release`                            | Mitigated by ops (buckets funded)                                                         |
| L-04 | Low      | Program | `initialize` has no sanity checks; a recipient equal to the escrow bricks `release` | **Fixed** #37 (`initialize` checks)                                                       |
| L-05 | Low      | API     | Escrow checkout memo matched by substring                                           | **Fixed**                                                                                 |
| L-06 | Low      | API     | Release payout ledger used today's env buckets and split, not what the program paid | **Fixed**                                                                                 |
| L-07 | Low      | API     | `resolveDispute` is not transactional and not concurrency-safe                      | **Fixed** #37 (`sql.begin` + `for update`)                                                |
| I-01 | Info     | Program | The buyer can dispute again after a rejection, inside the window                    | Accepted (delay only)                                                                     |
| I-02 | Info     | Program | `Released -> Disputed` is allowed forever, as a status flag only                    | Accepted                                                                                  |
| I-03 | Info     | Program | The program trusts buyer-supplied terms; the API must verify them                   | Mitigated (`escrowMismatch`, tested)                                                      |
| I-04 | Info     | Program | `open_dispute` after the window returns `TooEarly`                                  | **Fixed** #37 (`WindowClosed`)                                                            |
| I-05 | Info     | Program | Unaudited; verified-build CI added (hash may still differ until Squads redeploy)      | Audit declined; `solana-verify` workflow + `docs/ops/verified-build.md` (OtterSec = mainnet) |
| I-06 | Info     | API     | Webhook secret not compared in constant time; webhook token balances are trusted    | **Fixed** #38 (constant-time compare, balances re-read on chain)                          |
| I-07 | Info     | API     | `POST /tx/send` relays any signed transaction for any session                       | Open                                                                                      |
| I-08 | Info     | API     | The funding tx is bound to the order only by memo                                   | Accepted (the account is authoritative)                                                   |
| I-09 | Info     | API     | `decodeEscrow` accepts data longer than the layout                                  | Accepted (owner + discriminator checked)                                                  |
| I-10 | Info     | API     | Order memos carry a 32-bit short id                                                 | Accepted                                                                                  |

\* High if any of those secrets is unset in a deployed Worker. I could not see the Cloudflare secrets, so this is conditional.

## Status update (2026-10-18)

Program v2 (#37) was upgraded on devnet through the Squads vault (execute sig `423paLho…6Q1pSacng1KrE7ZK`). The on-chain hash matches the build. The config PDA `DWgrsny5…Z4joJ` is initialized: resolver `7q5UJ8…`, dispute timeout 7 days.

Live smoke test, order `54ad8cd9…`:

| Step                                           | Signature         |
| ---------------------------------------------- | ----------------- |
| Checkout into the buyer-keyed PDA              | `5BZNfyJG…QK7NWF` |
| Resolver freeze, without the buyer's signature | `3cgda7vh…Grds`   |
| Admin refund                                   | `5qiRbgdQ…94LWP`  |

Owner decisions (2026-10-18): no third-party audit, no hardware-wallet multisig. The owner holds the mainnet upgrade authority and resolver keys himself. Remaining open items: I-05 (verified build) and I-07 (`/tx/send` relay; low impact because the wallet signs every transaction).

## What was verified as correct

Each item below is covered by `programs/trench_escrow/tests/escrow.rs`.

- **Signers.** `fund` and `open_dispute` need the stored buyer: `Signer` + `has_one = buyer`. `refund` and `reject_dispute` need the stored resolver. A wrong key, a missing signature, or another escrow's resolver all fail with `ConstraintHasOne` / `AccountNotSigner`.
- **Destinations.** `release` pins all five recipients with `address = escrow.<field>`. `refund` pins the buyer the same way. Substituted, swapped, cross-escrow and read-only recipients are all rejected. No instruction takes a destination from its arguments, and nothing pays the resolver, so even a compromised resolver cannot redirect funds to itself.
- **Amounts.** `fund` moves exactly `total = price + floor(price*fee_bps/1e4) - floor(fee*rebate_bps/1e4)`, recomputed from stored terms. `release` pays exactly `price + net_fee == total`, with rounding dust to ops. `refund` returns exactly `deposit`. The rent floor always stays behind. The tests assert that no instruction creates or burns lamports, and a 48-case property test checks this for random terms.
- **Overflow.** `u128` multiply-divide, checked adds and subs, `overflow-checks = true`. The only reachable overflow is `price + fee > u64::MAX`, and `initialize` rejects it. The split is summed in `u32`, so values that would wrap in `u16` are still rejected.
- **State machine.** `release` runs only from `Paid`: never from `Disputed`, even long after the window. `Refunded` and `Expired` are terminal. A second fund, release, refund or expire fails. `expire` cannot touch a funded escrow. `reject_dispute` back to `Paid` does not skip `escrow_until`.
- **Time gates, at the exact boundaries.** Funding is allowed at `expires_at` and refused one second later. Release is refused one second before `escrow_until` and allowed at it. A dispute is allowed one second before `escrow_until` and refused at it. Expiry is refused at `expires_at` and allowed after.
- **Account authenticity.** Foreign-owner look-alikes fail (`AccountOwnedByWrongProgram`). Wrong discriminators fail. Uninitialized accounts fail. Unknown instructions and missing accounts fail. A non-canonical-bump address, a PDA from another order id, or a random keypair address fails `ConstraintSeeds`. Re-initialization fails, even when the attacker brings their own resolver and seller, and the stored terms do not change. A PDA pre-funded by a griefer still initializes.
- **API.** `readEscrow` checks the owner and discriminator. `escrowMismatch` compares every term, the deposit and the order id with what the server issued before an order counts as paid. `resolverOf` refuses a resolver pubkey that does not match its secret. Checkout transactions have the buyer as the only signer and fee payer, and are preflighted.

## Findings

### H-01 Secrets fall back to public `change-me` defaults

- **Location:** `apps/api/src/env.ts` `readEnv`: `SESSION_SECRET` (`'change-me-32-bytes-min'`), `INTERNAL_TOKEN`, `HELIUS_WEBHOOK_SECRET`, `AI_ATTEST_SECRET` (`'change-me'`); also `packages/db/src/cli.ts`.
- **Impact:** if a Worker deploys without one of these secrets, that secret is public. A known `SESSION_SECRET` lets anyone mint an HS256 session for any user id, including an admin. An admin session can resolve disputes, and `resolveDispute` then has the resolver key sign refunds. A known `HELIUS_WEBHOOK_SECRET` lets anyone post `tokenBalances` rows that feed tier discounts, or mark payments. A known `INTERNAL_TOKEN` opens the `/internal` jobs.
- **Recommendation:** fail closed. When `APP_URL` is not `localhost`, `readEnv` should throw if any secret is missing, equal to a default, or shorter than 32 bytes. Rotate all four secrets before mainnet.
- **Status:** open. Not changed here: on a deployment that relies on a default, a startup check would take the API down. The owner should first confirm that `wrangler secret list` shows all four.

### M-01 An off-chain dispute does not freeze funds until the buyer signs `open_dispute`

- **Location:** `lib.rs` `open_dispute` (buyer-only `Signer`) and `release` (permissionless). `logic.ts` `openDispute` records the dispute in Postgres and returns an unsigned `open_dispute` tx; `releaseOrders` skips orders with an open DB dispute.
- **Impact:** if the buyer never signs the returned transaction, or signs it after `escrow_until`, anyone (typically the seller) can crank `release` once the window ends. The server's cron holds back, but the chain does not. `resolveDispute` then sees `fundsAlreadyReleased` and pays the refund from the creator's bond, with the safety bucket covering any shortfall. This is a slower, off-escrow path, and it depends on bond and safety-fund solvency. With the 1-hour window being introduced in PR #33, the gap is easy to hit.
- **Recommendation:** on the next upgrade, let the resolver also call `open_dispute` (or a `freeze` instruction) on a `Paid` escrow inside the window, so the API can freeze funds the moment a dispute is filed. Until then, make the web flow treat a dispute as filed only after the on-chain signature confirms, and warn the buyer before the window closes.
- **Status:** open. Needs a program change and redeploy, so it is not done here.

### M-02 One hot resolver key per escrow: no rotation, no timeout; it also pays release fees

- **Location:** `Escrow.resolver` is fixed at `initialize`. `refund` and `reject_dispute` have no deadline. `apps/api/src/escrow.ts` `resolverSigned` uses `ESCROW_RESOLVER_SECRET`, a Worker secret, as fee payer for `release`, `refund` and `reject_dispute`. Devnet resolver: `7q5UJ8PcPrL59GgcqqwC8D1p3v9VFxVyA5BRDaVZ5bww`, a plain system account.
- **Impact:** if the key is lost, every `Disputed` escrow is frozen forever: there is no fallback, and `release` refuses `Disputed`. If it is compromised, the attacker can refund any disputed escrow to its buyer or reject disputes. Funds cannot be redirected to the attacker, but a colluding buyer gets goods for free. A resolver whose balance runs dry also stops the release cron.
- **Recommendation:** on mainnet, make the resolver a Squads multisig PDA, with refunds and rejections executed as proposals. Use a separate low-value crank key as fee payer for `release`: it needs no authority, because `release` is permissionless. On the next upgrade, add a dispute deadline (for example, after N days either party may trigger a default outcome) and store the resolver in a config PDA, so it can be rotated for in-flight escrows.
- **Status:** open. Program and ops change.

### M-03 Rate limit keyed on client-controlled `X-Forwarded-For`; one DB write per request

- **Location:** `apps/api/src/app.ts`, global middleware: `ip = x-forwarded-for.split(',')[0]`, then `insert ... on conflict` into `rate_buckets` for every non-GET request.
- **Impact:** the first `X-Forwarded-For` entry is whatever the client sends, so a random value per request bypasses the limit. Each write also costs a Postgres round trip, which amplifies a flood into DB load. Routes behind it include `/auth/nonce` (unauthenticated inserts), `/orders` and `/tx/send`.
- **Recommendation:** enforce limits at the edge (a Cloudflare WAF rate-limiting rule on `trenchmart.fun/api/*`), or use the Workers Rate Limiting binding keyed on `CF-Connecting-IP`. Web traffic reaches the API through the Next rewrite proxy (`apps/web/next.config.ts`), so first confirm which client-IP header survives that hop. Keying on the wrong header would put every user in one bucket.
- **Status:** open. Not changed blind, for the reason above.

### M-04 X handle linking is unverified

- **Location:** `apps/api/src/app.ts`: `GET /auth/x/start` returns 501, and `POST /studio/x` stores any `handle` as `x_handle` with `x_user_id = 'dev:<handle>'`. Listings require `x_handle` (`X_REQUIRED`), and creator pages display it.
- **Impact:** any creator can claim any X account, for example a known trader's. That defeats the reason a linked X account is required.
- **Recommendation:** implement X OAuth 2.0 PKCE (`X_CLIENT_ID`/`X_CLIENT_SECRET` are already in `.env.example`) and store the X user id. Remove `/studio/x`, or restrict it to localnet.
- **Status:** open.

### L-01 Escrow rent is never reclaimed

- **Location:** `lib.rs`: no `close` instruction. `Escrow` is 295 bytes, so its rent floor is 2,944,080 lamports.
- **Impact:** every order permanently locks about 0.00294 SOL of the buyer's SOL, including expired orders that were never funded. Escrow accounts accumulate forever.
- **Recommendation:** add `close` for terminal states (`Released`, `Refunded`, `Expired`), with `close = buyer`. Keep released escrows until any post-release dispute period has passed.
- **Status:** open. Program change.

### L-02 PDA seeds omit the buyer

- **Location:** `Initialize`, `seeds = [b"escrow", order_id]`.
- **Impact:** whoever initializes first owns the PDA. Anyone who sees the order id before the checkout lands (for example, in the broadcast transaction) can front-run `initialize` with themselves as buyer. The honest checkout then fails. No funds are at risk: `fund` needs the stored buyer, and the API rejects the mismatch. It is griefing only. Test: `initialize_front_run_by_other_buyer_blocks_real_buyer`.
- **Recommendation:** use `seeds = [b"escrow", buyer, order_id]` on the next program version, and derive the address the same way in `packages/chain` `escrowAddress`.
- **Status:** open. Program change.

### L-03 A sub-rent credit to an empty recipient blocks `release`

- **Location:** `lib.rs` `move_lamports`, plus the runtime rent rule.
- **Impact:** if a recipient has 0 lamports and its share is below the rent-exempt minimum (890,880 lamports for a 0-byte account), the runtime rejects `release` atomically. Funds stay safe, and anyone can unblock the release by topping up the wallet. Test: `release_to_empty_wallet_below_rent_floor_fails_and_keeps_funds`.
- **Recommendation:** keep every bucket wallet above the rent floor; on devnet all four hold 1.07 to 1.2 M lamports. Alert when one drops near it. Seller wallets are signing wallets, so they are normally funded.
- **Status:** mitigated operationally.

### L-04 `initialize` has no sanity checks

- **Location:** `lib.rs` `initialize`.
- **Impact:** the program accepts `escrow_until < expires_at`, `expires_at` in the past, `price == 0` (`fund` then fails `BadAmount`), and recipients equal to the buyer or to the escrow PDA. If a recipient is the escrow itself, every `release` fails with `AccountBorrowFailed`; the only way out is a dispute and refund inside the window. Test: `release_with_escrow_as_recipient_fails_closed`. Only a buyer who hand-builds `initialize` can create these, and the API refuses to treat such an escrow as payment.
- **Recommendation:** on the next upgrade, require `expires_at <= escrow_until`, `price > 0`, and no recipient equal to the escrow key.
- **Status:** open. Program change.

### L-05 Escrow checkout memo matched by substring (fixed)

- **Location:** `apps/api/src/logic.ts` `verifyEscrowFunding`: `memo.includes(order.memo)`.
- **Impact:** a transaction whose memo merely contains `tm:<8 hex>` was accepted as the order's checkout signature. The escrow account itself was still verified, so no false payment was possible, but the stored `tx_sig` could point at the wrong transaction. The vault path (`assessPayment`) already required an exact match.
- **Fix:** exact match. Test: `product.test.ts`, "settles orders through the on-chain escrow" (superstring memo → `WRONG_MEMO`).

### L-06 Release payout ledger used today's env, not what the program paid (fixed)

- **Location:** `apps/api/src/logic.ts` `releaseOrders`: `releasePayouts({ creatorWallet: order.creator_wallet, buckets: deps.env.buckets, splitBps: config.fee_split_bps })`.
- **Impact:** for escrow orders, the program pays the seller and buckets stored in the escrow, using the stored split. If a bucket wallet, the creator's wallet or the fee-split config changed between checkout and release, the `payouts` and `ledger` rows (marked `sent` with the release signature) named recipients and amounts that differ from the chain. The old code produced 2 rows instead of 5 after a split change.
- **Fix:** `releaseEscrow` returns the escrow account it read, and payout lines now use its `seller`, buckets and `split_*_bps`. Vault orders are unchanged. Test: `product.test.ts` rotates the buckets and split before release and asserts that the on-chain recipients and 40/25/20/15 amounts are recorded.

### L-07 `resolveDispute` is not transactional and not concurrency-safe

- **Location:** `apps/api/src/logic.ts` `resolveDispute`.
- **Impact:** it reads `status = 'open'`, sends the on-chain refund, then runs 4 to 8 separate statements, and the final `update disputes` does not re-check `status = 'open'`. On the escrow path the chain prevents a double refund. On a vault order, two concurrent admin resolutions can both insert refund payouts (the Squads vote is the last line of defence). A failure mid-way leaves an on-chain refund with a half-written ledger.
- **Recommendation:** run it in `sql.begin` with `select ... for update` on the dispute row, and make every write conditional on the dispute still being open. Write the on-chain signature in the same transaction, or reconcile from the chain on retry.
- **Status:** open.

### I-01 The buyer can dispute again after a rejection

`reject_dispute` to `Paid` clears `disputed_from`, and `open_dispute` works again while `now < escrow_until`. This can only delay payout until the window closes. Funds still move only to stored parties. Test: `buyer_can_redispute_after_rejection_inside_window`. Option: store a `disputed_once` flag.

### I-02 `Released -> Disputed` is allowed at any time

This is a status record only. `refund` refuses (`FundsAlreadyReleased`), and `release` cannot run twice. While the flag is set, explorers show `Disputed` for an escrow whose funds already left. Test: `dispute_after_release_cannot_claw_back_funds`.

### I-03 The program trusts buyer-supplied terms

`initialize` stores the seller, resolver, buckets, fees, split and times exactly as the buyer signed them. The program cannot know the marketplace's real fee or resolver. This is safe only because the API issues the terms (`orderEscrowArgs`) and compares every stored field after funding (`escrowMismatch`, covered in `product.test.ts`: a forged seller and a short deposit are refused). Any other integrator must do the same.

### I-04 Misleading error code

`open_dispute` on a `Paid` escrow at or after `escrow_until` fails with `TooEarly` (6005), which means "too late" there. Append a `WindowClosed` variant on the next upgrade. Do not renumber: clients match on codes.

### I-05 Unaudited, unverified build

`security.txt` says `auditors: None`. `/verify` reports `verifiedBuild: not_verified`. The devnet upgrade authority is the Squads vault PDA `47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7` (2-of-3 multisig `CaatcAQa…`), which is good. This PR adds doc comments only. That shifts source line numbers, which the binary embeds in panic locations, so a rebuild from `main` no longer hashes to the devnet deploy. The program logic is unchanged. Verified builds should be tied to the git tag of the commit actually deployed.

### I-06 Webhook authentication

`/hooks/helius` compares the `authorization` header with `!==`, not in constant time; remote timing attacks on Workers are impractical. It inserts `tokenBalances` from the body as tier inputs. Prefer reading balances from chain (on-chain snapshots exist since PR #28) over trusting webhook bodies.

### I-07 `POST /tx/send` is an open relay for signed-in users

It forwards any base64 transaction to the RPC and spends Helius credits. It is bounded only by the M-03 limiter.

### I-08 / I-09 / I-10

The funding signature is tied to the order only by its memo, but the account state is authoritative. `decodeEscrow` requires `length >= layout`, not `==`. Memos use the first 8 hex digits of the order UUID. None of these is exploitable given the account checks.

## Tests

`programs/trench_escrow/tests/escrow.rs` runs 72 tests against the real SBF binary in Mollusk (Agave 4.3 program runtime). Together with 14 unit and property tests in `fee.rs` and `state.rs`, that makes 86 Rust tests.

| Instruction      | Happy path                                                                                                   | Failure paths covered                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`     | stored terms, canonical bump, rent-only charge                                                               | fee/rebate bps > 100%, bad split (incl. u16 wrap), total overflow, max price, other order's PDA, non-canonical bump, random address, no signature, fake system program, re-init, pre-funded PDA, front-run                                                                                    |
| `fund`           | exact total in, full-rebate total == price                                                                   | wrong signer, no signature, after expiry (and boundary), double fund, zero total, insufficient lamports, after expire, foreign owner, bad discriminator, uninitialized                                                                                                                        |
| `release`        | exact seller and bucket amounts, rent stays                                                                  | 1 s early, double, from Pending/Disputed/Refunded/Expired, each recipient substituted, swapped buckets, buyer as seller, other escrow's recipients, read-only accounts, foreign owner, tampered deposit, dust rounding, empty buckets, sub-rent recipient, shared wallet, escrow as recipient |
| `expire`         | Pending → Expired, permissionless, rent stays                                                                | at/before deadline, funded escrow, double                                                                                                                                                                                                                                                     |
| `open_dispute`   | Paid → Disputed, no funds move                                                                               | at window end (boundary), seller/resolver/stranger, no signature, from Pending/Disputed/Refunded/Expired, after release (status only)                                                                                                                                                         |
| `refund`         | full deposit to buyer, rent stays, works late                                                                | wrong resolver (buyer/seller/stranger/other escrow's), no signature, wrong recipient, no dispute, double, disputed from Released, forged origin                                                                                                                                               |
| `reject_dispute` | → Paid (window still applies), → Released                                                                    | wrong resolver, no signature, no dispute, forged origin, refund after reject, re-dispute                                                                                                                                                                                                      |
| cross-cutting    | lamport conservation on every successful ix, a full lifecycle, and a 48-case property test over random terms | unknown discriminator, missing accounts, non-resolver moving disputed funds                                                                                                                                                                                                                   |

Mutation check: five checks were removed one at a time (refund `has_one`, the release window comparison, the ops `address` constraint, fund expiry, release-only-from-Paid). Each mutant failed 1 to 3 tests.

**How it runs in CI.** `anchor test` executes `[scripts] test` in `Anchor.toml`, which now runs `cargo test` (with `TRENCH_ESCROW_REQUIRE_SBF=1`, so a missing binary fails instead of skipping) and then the existing TypeScript client test. The `clippy` job compiles the tests with `--all-targets`. No workflow file changed.

## Recommended program changes for the next deploy

Not deployed. Batch them into one upgrade through the Squads upgrade authority, then re-run this suite and update the tests that document today's behaviour:

1. A resolver-callable freeze or dispute inside the window (M-01).
2. A resolver in a config PDA (rotatable), a dispute deadline with a default outcome, and a separate crank fee payer (M-02).
3. `close` for terminal escrows, refunding rent to the buyer (L-01).
4. Seeds `[escrow, buyer, order_id]` (L-02).
5. `initialize` sanity checks (L-04).
6. A `WindowClosed` error variant (I-04).
7. Optionally, at most one dispute per escrow (I-01).
