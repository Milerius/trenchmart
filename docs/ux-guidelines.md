# TrenchMart UX guidelines

How the product behaves and talks. Visual tokens and components are in `docs/design-system.md`. Every state below has a mockup in `design/explorations/` (01–09; the `-v2` files include the owner decisions).

## 0 · Owner decisions (final)

These override anything else in this file or in the handover docs.

| #   | Decision                                        | What it means in the UI                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AI verification fully replaces human review     | No human-review fallback anywhere: no "appeal to a person", no "reviewed by our team", no "a human will check". A rejection gives the exact reason and a fix path (upload a new version).                                                                  |
| 2   | Logged-out visitors see a preview               | `PreviewNotice` above listings and in the buy box: "Preview prices: you're seeing list prices. Connect your wallet to see your exact price with your $MART tier discount." Cards show the list price plus "+ 5% fee · your tier can cut it".             |
| 3   | Landing stats look good before real data exists | `LandingStats` renders `GET /stats`. While `source` is `mock` it shows the chip "SAMPLE DATA". Once a live listing exists the API switches to `live` and so does the component, with the same layout. Sample numbers only ever appear on the landing page. |
| 4   | AI review feels near-instant                    | Upload works like sending a prompt. The review starts on drop and streams live steps with seconds-level timings and a sandbox log. No "in review, come back later" queue.                                                                                  |
| 5   | Dashboards show real values, with USD           | The studio and purchases pages show values computed from API data only (skeleton while loading, real 0.00 when empty). Every SOL amount that matters gets a USD estimate next to it.                                                                       |
| 6   | Download only after release                     | No download while funds are in escrow or disputed. The download unlocks when the order is `released`.                                                                                                                                                      |

## 1 · Research summary

| Topic            | Practice we follow                                                                                                                                                                                           | Source                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Wallet connect   | Wallet Standard discovery; `solana:signIn` (SIWS) connects and signs in **one** user action, with `signMessage` as fallback. Show discovery as loading. Never enable signer actions before a session exists. | solana.com/docs/frontend/messages-and-auth, Solana Mobile UX guidelines           |
| Pre-sign clarity | Show the exact money movement, destination and fees before the wallet opens. Our numbers must match the wallet's simulation. Re-quote stale quotes.                                                          | MetaMask simulations, Tenderly tx preview, ScamSniffer simulation-spoofing report |
| Tx status        | Distinct states: idle, awaiting signature, pending (with signature and explorer link), confirmed or failed. On Solana, `confirmed` is the success moment; `finalized` runs in the background.                | Solana cookbook (confirmation), Helius commitment levels                          |
| Rejection        | A wallet rejection is a **cancel**, not an error. Neutral copy, keep the quote.                                                                                                                              | cryptoskills frontend-ux, MLH Solana error messages                               |
| Escrow           | A role-aware timeline. Each step shows what happens next, who acts and when. Protection copy sits next to the pay button.                                                                                    | Martech Zone "trust by design", ANODA marketplace UX                              |
| Trust            | Specific, checkable signals (checks that ran, pinned hash, bond, disputes lost, verified-buyer reviews) over generic stars.                                                                                  | u1core marketplace patterns, docs/01 principles                                   |
| Accessibility    | WCAG 2.2 AA: 4.5:1 text, 3:1 control boundaries and focus, 24px targets, focus not obscured, status messages announced.                                                                                      | w3.org/TR/WCAG22                                                                  |

## 2 · Copy rules

### Voice

Plain, short, specific. Say what happened, what it means for the user's money, and what to do next. No hype ("ape in", "moon", "guaranteed"), and no emoji.

### Glossary (use exactly)

| Say                                                                         | Don't say                                                                                                              | Why                                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI verification**, **AI-verified**, "the AI verifier", "trenchmart-ai-v1" | human review, reviewers, verifiers, staked verifier, "reviewed by humans", "appeal to our team", "a person will check" | Verification is automated (`packages/ai-verifier`) and final (owner decision 1). The `ai_verification` fee bucket funds it. No human verifiers are paid. |
| **AI review · 00:14** (live elapsed), **Running in an isolated sandbox**    | in queue, pending review, "come back later", "usually within 24h"                                                      | The review streams while you watch (decision 4)                                                                                                          |
| **Download unlocks 19 Oct 06:01 UTC** / **Unlocks in 41h**                  | "Download now" during escrow                                                                                           | Downloads open only after release (decision 6)                                                                                                           |
| **≈ $275.40** next to `1.53 SOL`                                            | "$275.40" without ≈, USD instead of SOL                                                                                | USD is an estimate; SOL is what moves                                                                                                                    |
| **Preview prices**                                                          | "Sign up to see prices"                                                                                                | Prices are visible logged out; only the tier discount needs a wallet                                                                                     |
| **Marketplace fee · 5%**                                                    | platform fee, commission, rebate                                                                                       | One fee, paid by the buyer                                                                                                                               |
| **`<Tier>` discount · −60% of fee**                                         | holder rebate, cashback                                                                                                | Tiers discount the fee, not the price                                                                                                                    |
| **You pay** / **Total to escrow**                                           | total at your tier                                                                                                     | The total is what goes into escrow                                                                                                                       |
| **100% to creator**, **0% creator commission**                              | creator fee                                                                                                            | —                                                                                                                                                        |
| **Solana network fee · to validators**                                      | gas, our fee                                                                                                           | It isn't our money                                                                                                                                       |
| **Sign a message (not a transaction)**                                      | approve, authorize                                                                                                     | SIWS moves nothing                                                                                                                                       |
| **Approve 1.53 SOL in wallet**                                              | Buy, Confirm, Pay now                                                                                                  | The button matches what the wallet will show                                                                                                             |
| **In escrow · you can dispute for 41h 07m**                                 | processing, pending                                                                                                    | Says what it means and how long                                                                                                                          |
| **Escrow vault** (multisig)                                                 | on-chain escrow (POC)                                                                                                  | POC is a Squads vault plus a ledger, not a program                                                                                                       |
| **Attestation signed by trenchmart-ai-v1**                                  | signed on-chain                                                                                                        | POC attestations are signed off-chain (HMAC) and stored                                                                                                  |

### Fees: show them exactly

- Buyer pays **list price + 5%**. Tiers cut **the fee**: Scout −25%, Trencher −60%, OG −100%. Creator commission is **0%**.
- The fee split of the net fee is buyback 40% · **AI verification 25%** · ops 20% · safety 15%.
- Worked example for a 1.50 SOL listing: None **1.575** · Scout **1.55625** · Trencher **1.53** · OG **1.50** SOL. The creator receives 1.50 in every case.
- Amounts are exact, with no rounding (see design-system › Money formatting). If a value doesn't fit, wrap it. Don't shorten it.
- All percentages come from config at runtime (`fee_bps`, `tier_rebate_bps`, `fee_split_bps`). The copy above is the current default; render the live values.
- Logged-out cards show `1.50 SOL` and `≈ $270.00 · list price`, plus "+ 5% fee · your tier can cut it", under a `PreviewNotice`. Connected cards show the exact "you pay" at the user's tier ("1.53 SOL · you pay · Trencher rate").

### USD next to SOL

- SOL is the primary amount and is always exact. USD sits next to it or under it in `muted`, prefixed with "≈": `1.53 SOL · ≈ $275.40`.
- Show USD on every money amount a person decides on or checks: card prices, buy box rows, checkout totals, receipts, escrow and refund amounts, dashboard tiles and table cells, payouts, bonds and the verification fee. Skip it on network fees below a cent ("< $0.01") and inside code or logs.
- Convert in lamports × integer cents (no floats) and truncate to the cent. Below one cent show "< $0.01".
- The page or sheet shows the source once: "USD at $180.00/SOL · CoinGecko · 1 min ago · estimate".
- If the price feed fails or is older than 10 minutes, keep the SOL amount and show "USD unavailable" in `faint`. Never block a flow on the USD rate.
- On devnet, USD is still shown (owner decision 5), and the devnet banner already says nothing has real value.

## 3 · Flows

### Connect and sign in

1. "Connect wallet" opens `ConnectModal`. While Wallet Standard discovery settles, the list shows "Loading wallets…" (not "No wallets found").
2. Pick a wallet. Use `signIn` (one popup). The modal says: _"You'll sign one message to sign in. It's not a transaction: nothing moves and nothing is approved."_ It previews the message (domain, address, nonce, issued at).
3. Success closes the modal, the wallet button shows `7xKp…a9Fq`, and the tier chip appears ("Trencher · 60% off fees", or "No tier · 5% fee").
4. Cancelled in wallet: "You cancelled in your wallet. Nothing was signed." (neutral). Wrong network: "Switch your wallet to Devnet to continue."

### Buy

1. Listing → **Review & buy** opens `CheckoutSheet` › Review. Never open the wallet straight from the listing page.
2. Review shows the item, version and sha, the full `FeeReceipt`, "Sent to: Escrow vault 9WzD…Tm4q", the memo `tm:<id8>`, release terms, the balance check, and a quote timer ("Quote held for 19:42"). The tier is re-checked (72h minimum balance).
3. **Approve 1.53 SOL in wallet** moves to Awaiting signature: "Check Phantom. Your wallet should show a transfer of 1.53 SOL to 9WzD…Tm4q with memo tm:8c1d2e0a. If it shows anything else, reject it."
4. Confirming: signed ✓ → processed ✓ → confirmed ◑ → checked by TrenchMart ○, with a Solscan (devnet) link. "You can close this. The order keeps confirming and shows up in Purchases."
5. Confirmed: "Payment confirmed · 1.53 SOL (≈ $275.40) is in escrow" + `● PAID · IN ESCROW` + a disabled `download-button` "Download unlocks 19 Oct 06:01 UTC" + receipt + "Open a dispute before release" + a link to Purchases.
6. Released (after the 1h escrow window with no dispute, or a rejected dispute): the order becomes `RELEASED`, the download button turns primary ("Download"), and a toast/notification says "Trade finished. Your download is ready."

### Escrow and disputes

- Order states map 1:1 to `ORDER_STATUSES`: `pending` AWAITING PAYMENT · `paid` PAID · IN ESCROW · `disputed` DISPUTED · `released` RELEASED · `refunded` REFUNDED · `expired` EXPIRED.
- The timeline is Paid → In escrow → Released to @creator → Download unlocks. The current step always says what is happening, who acts next, and an exact UTC time plus a countdown bar.
- Download state by order status: `paid` and `disputed` show it locked ("Unlocks in 41h" / "Download stays locked during the dispute"); `released` shows it enabled; `refunded` and `expired` don't show it.
- Disputed shows both outcomes before the decision ("If upheld: 0.612 SOL (≈ $110.16) back to you · If rejected: released to creator"). Disputes are resolved by the TrenchMart admin multisig (the escrow `resolve` instruction). This is about payments, not listing review, so it doesn't conflict with decision 1.
- Dispute form reasons, written for a buyer who doesn't have the file yet: "Listing changed or was delisted after I paid" · "Not as described on the listing page" · "Malicious" (after download; open for 30 days from release). Details need at least 20 characters, plus optional evidence. "Release is paused as soon as you submit."

### Creator upload (live AI review)

- Upload works like sending a prompt. Dropping a file hashes and freezes it, then starts the review right away. The details form (title, category, price, licence) fills in in parallel and autosaves. Publishing waits only for the verdict.
- Live steps, driven by `version.status` plus streamed step events: **Received** (`uploading`, about 0.5s) → **Static checks** (`scanning`, about 2s, with each rule ticking) → **Isolated sandbox** (`scanning`, fresh browser, a fake wallet that logs every call and never signs, a live log line per event) → **AI verdict** (`in_review`, seconds) → **Live** (`live`). Each finished step shows its duration ("2.1s"), and the header shows total elapsed ("◑ 00:14").
- Copy: "Usually done in under a minute. You can leave: we'll notify you the moment there's a verdict." If a step runs past 60s: "Taking longer than usual · still on step 3". Never "in queue" or "check back later".
- Request changes (`needs_creator`) pauses the run at that step with the exact finding ("The sandbox saw POST api.telegram.org, which isn't in your @connect"). Help text: "At least 20 characters. 'ok' or 'lgtm' gets sent back." **Send note · re-check** resumes from that step. It doesn't restart or wait in line.
- Rejected: name the failing call and where it happened ("called signTransaction during the sandbox run, gmgn.ai, 00:16.2"), and give one path forward: **Fix and upload a new version**. There is no appeal (decision 1).
- Approved: "Approved · live" with total time ("00:27 total"), the verifier's one-line summary, and the attestation signature.

## 4 · States per screen

| Screen         | Loading                                              | Empty                                                                                               | Error                                                                                                                                              | Other                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing        | `LandingStats` skeleton tiles                        | No real stats yet: sample set with "SAMPLE DATA" chip (`data-source="mock"`)                        | Stats API failed: keep the sample set, never an error on the landing page                                                                          | Live: "● LIVE · updated 2 min ago" (`data-source="live"`)                                                                                                                                                               |
| Home / Explore | Card skeletons at final size, `aria-busy`            | "No listings for "<q>" on <terminal>" + Clear filters                                               | "Couldn't load listings. Your wallet and open orders aren't affected." + Try again + ref                                                           | Logged out: `PreviewNotice` + list prices. Holder-only lock. Versions in AI review aren't public; buyers only see live listings.                                                                                        |
| Listing        | Skeleton header + buy box with "Getting your price…" | 404: "This listing doesn't exist or was delisted" + Explore                                         | Quote failed: "Couldn't get a price. Try again." Buy disabled                                                                                      | Logged out: preview notice in the buy box. Owned in escrow: "You own this · download unlocks in 41h". Owned and released: Download. Holder-locked. Delisted ("Delisted on <date>. Released orders can still download.") |
| Checkout       | "Preparing your transaction…"                        | —                                                                                                   | Insufficient SOL (blocked before signing, shows the shortfall + devnet faucet link) · Quote expired · Tx failed (says what was and wasn't charged) | Cancelled = neutral. Success = "in escrow" with the download locked.                                                                                                                                                    |
| Purchases      | Row skeletons                                        | "No purchases yet. Everything you buy shows up here with its escrow timer." + Browse                | Inline error + retry                                                                                                                               | Download locked for `paid` / `disputed`, enabled for `released`                                                                                                                                                         |
| Studio         | Tile + row skeletons (never placeholder numbers)     | First run: 3-step checklist (wallet ✓, link X, stake bond). No sales yet: real `0.00 SOL · ≈ $0.00` | "Couldn't load your numbers." + Retry. Upload failed: "Upload stopped at 62%. Nothing was published." + Retry                                      | Live AI review card, needs_creator banner, rejected reason with fix path. Price feed down: SOL stays, "USD unavailable".                                                                                                |
| $MART        | Static                                               | Tier thresholds not set: "Thresholds are set after launch"                                          | —                                                                                                                                                  | —                                                                                                                                                                                                                       |

### Error copy

| Cause                                                             | Title                          | Body                                                                                                   | Action          | Tone                      |
| ----------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------- | ------------------------- |
| Wallet rejected (4001 / `WalletSignTransactionError` user reject) | You cancelled in your wallet   | Nothing was sent.                                                                                      | Approve again   | neutral                   |
| Not enough SOL                                                    | Not enough SOL                 | You need 1.530005 SOL (1.53 + network fee). This wallet has 0.9 SOL.                                   | Get devnet SOL  | danger, blocks the button |
| Quote expired (order TTL 20 min)                                  | Quote expired                  | Quotes are held for 20 minutes. Nothing was charged.                                                   | Get a new quote | warn                      |
| Blockhash expired / dropped                                       | Payment didn't go through      | Solana rejected the transaction. At most the network fee left your wallet.                             | Try again       | danger                    |
| Amount or memo mismatch (server)                                  | We couldn't match this payment | Your payment of X SOL is in the vault but didn't match order tm:… We've flagged it for a refund.       | Contact support | danger                    |
| Wallet disconnected mid-flow                                      | Wallet disconnected            | Reconnect to continue. Your quote is still held.                                                       | Reconnect       | warn                      |
| Wrong network                                                     | Wrong network                  | Switch your wallet to Devnet.                                                                          | —               | warn                      |
| API down                                                          | Couldn't load …                | What failed. What is not affected.                                                                     | Try again · ref | danger                    |
| Rate limited (429)                                                | Slow down a little             | Try again in a few seconds.                                                                            | auto-retry      | neutral                   |
| Download requested before release                                 | Download unlocks after release | Your 1.53 SOL is in escrow until 19 Oct 06:01 UTC. The file unlocks when it's released to the creator. | View order      | info                      |
| AI review step slow (> 60s)                                       | Taking longer than usual       | Still on step 3 · isolated sandbox. You can leave; we'll notify you.                                   | —               | info                      |
| AI review crashed (infra, not a verdict)                          | The review stopped             | Something broke on our side, not in your file. Nothing was published.                                  | Run again       | danger                    |
| USD price unavailable                                             | —                              | Show the SOL amount and "USD unavailable" in `faint`. No banner.                                       | —               | neutral                   |

Never show raw errors, hex or stack traces. Put a short ref code (`ref 7f2c`) in fine print.

## 5 · Mobile-first rules

- Design at 390px first. No horizontal scroll at 360–390 (except code blocks and tables inside their own scroll container with a visible edge).
- Listing page: a sticky bottom buy bar (total + tier + "Review & buy"), 76px tall plus the safe-area inset, and `scroll-padding-bottom: 96px`.
- Checkout is a bottom sheet with a grab handle. The primary action is at the bottom.
- Tables (purchases, studio, payouts) become stacked cards under 640, with the main action first.
- Filters go in a bottom sheet behind "Filters · N"; terminal pills stay in a horizontal row.
- Android: show "Use installed wallet" (MWA) first and call `signIn` straight from the tap.

## 6 · Accessibility checklist (WCAG 2.2 AA)

- [ ] Text ≥ 4.5:1 (use only `text`, `text-2`, `muted`, `faint`; `decor` never for text)
- [ ] Control boundaries and focus indicator ≥ 3:1 (`border-control`, lime ring)
- [ ] Targets ≥ 24px; primary touch targets ≥ 44px
- [ ] Every status = symbol + word (never colour alone)
- [ ] Checkout and escrow state changes announced through one `aria-live="polite"` region; blocking errors use `role="alert"`
- [ ] Modal: `role="dialog"`, `aria-modal`, labelled title, focus trap, focus returns to the trigger, Esc closes (not while awaiting signature)
- [ ] Tabs with arrow keys; toggle groups with `aria-pressed`
- [ ] `lang="en"`, one `<h1>` per page, landmarks (`header`, `nav`, `main`, `footer`), skip link "Skip to content"
- [ ] Focus is never hidden behind the sticky buy bar or header (2.4.11)
- [ ] `prefers-reduced-motion` respected
- [ ] axe-core: zero serious or critical violations on home, explore, listing, checkout, purchases, studio and token pages

## 7 · Testing contract

- Use the `data-testid` values in `docs/design-system.md › Components`. Prefer them over text or CSS selectors.
- State-bearing components expose `data-state` / `data-status` (for example `checkout-state[data-state="confirming"]`) so tests can assert state without matching copy.
- Fee assertions compare against `packages/shared` `quote()` output formatted with the exact formatter. Never hard-code rounded strings.
- Playwright runs `@axe-core/playwright` on key pages and fails on serious or critical violations.

## 8 · Decisions log

| Question                                | Resolution                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Appeal an AI rejection to a person?     | No. AI verification is final (owner decision 1). Rejections give the reason and a fix path. |
| Logged-out card price                   | List price + USD + "+ 5% fee · your tier can cut it", under a `PreviewNotice` (decision 2)  |
| Show "In AI review" listings to buyers? | No. Reviews take seconds now (decision 4), so only live versions are public.                |
| Download during escrow?                 | No. It unlocks on `released` only (decision 6).                                             |
| Fiat estimate                           | USD next to every relevant SOL amount, on devnet too (decision 5)                           |
| Live landing stats                      | Sample set until real data exists, then live automatically (decision 3)                     |
| "Disputes lost" format                  | Still open: `0 lost` today. A rate needs more volume to mean anything.                      |

## 9 · API contract the UI binds to

The build branch (`cursor/trenchmart-poc-a7ef`, `apps/api`) already implements the owner decisions. The UI uses these exact shapes:

| Decision                   | API                                                                                                                                                                                                  | UI binding                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 · Download after release | `POST /orders/:id/download` → 403 `ESCROW_LOCKED` unless `status === 'released'`                                                                                                                     | `download-button` is disabled (`data-state="locked"`) for `paid` / `disputed`, with "Download unlocks <escrow_until UTC>". If the API still returns `ESCROW_LOCKED`, show the "Download unlocks after release" info toast.                                                                                                                                 |
| 4 · Live AI review         | `POST /studio/versions/:id/complete?stream=1` (SSE). Events are named `static`, `sandbox`, `ai` and `done`, with data `{step, status: running\|done, summary?, verdict?, decision?, versionStatus?}` | `LiveReviewStream` steps: Received (client upload progress) → Static checks → Isolated sandbox (`verdict: 'na'` shows "Not needed for this file type") → AI verdict → Live / Needs your note / Rejected (from `versionStatus`). The client times each step from the event timestamps. Details come from `GET /studio/versions/:id` (checks, review notes). |
| 5 · USD                    | Money fields are `moneyView` = `{lamports, sol, usdCents}` plus `solUsd: {centsPerSol, source}`. `GET /prices/sol` adds `fetchedAt`.                                                                 | Format SOL from `lamports` with the exact formatter. The API `sol` field is 3-digit truncated, so don't print it. Format USD from `usdCents`. If `usdCents` is null or `source === 'unavailable'`, show "USD unavailable".                                                                                                                                 |
| 3 · Landing stats          | `GET /stats` → `{source: 'mock'\|'live', listings, creators, orders, volume, note}`. Mock until a live listing exists.                                                                               | `LandingStats` renders the payload as-is, with `data-source` set to `source`. `mock` shows the "SAMPLE DATA" chip and `note`; `live` shows "● LIVE".                                                                                                                                                                                                       |
| 1 · No human review        | `ai_reviews` table, agent `trenchmart-ai-v1`. `/internal/sandbox/next` reports no queue.                                                                                                             | No reviewer UI, queue or appeal surfaces.                                                                                                                                                                                                                                                                                                                  |

Small asks, all optional, for the build agent:

- `docs/04-api.md` still says download "requires status paid/released/disputed", but the code only allows `released`. Worth syncing.
- Sandbox log lines in the `sandbox` event (for example `lines: string[]`) would let the live log in `09-upload-live-ai-review` stream for real. Until then the UI shows the summary when the step finishes.
- `MOCK_LANDING_STATS` (8 listings, 4 creators, 128 trades, 11.5 SOL) could be bolder for decision 3. The UI shows whatever the API sends.
