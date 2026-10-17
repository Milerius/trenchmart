# TrenchMart UX guidelines

How the product behaves and talks. Visual tokens and components are in `docs/design-system.md`. Every state below has a mockup in `design/explorations/` (01–08).

## 1 · Research summary

| Topic | Practice we follow | Source |
|---|---|---|
| Wallet connect | Wallet Standard discovery; `solana:signIn` (SIWS) connects and signs in **one** user action, with `signMessage` as fallback. Show discovery as loading. Never enable signer actions before a session exists. | solana.com/docs/frontend/messages-and-auth, Solana Mobile UX guidelines |
| Pre-sign clarity | Show the exact money movement, destination and fees before the wallet opens. Our numbers must match the wallet's simulation. Re-quote stale quotes. | MetaMask simulations, Tenderly tx preview, ScamSniffer simulation-spoofing report |
| Tx status | Distinct states: idle, awaiting signature, pending (with signature and explorer link), confirmed or failed. On Solana, `confirmed` is the success moment; `finalized` runs in the background. | Solana cookbook (confirmation), Helius commitment levels |
| Rejection | A wallet rejection is a **cancel**, not an error. Neutral copy, keep the quote. | cryptoskills frontend-ux, MLH Solana error messages |
| Escrow | A role-aware timeline. Each step shows what happens next, who acts and when. Protection copy sits next to the pay button. | Martech Zone "trust by design", ANODA marketplace UX |
| Trust | Specific, checkable signals (checks that ran, pinned hash, bond, disputes lost, verified-buyer reviews) over generic stars. | u1core marketplace patterns, docs/01 principles |
| Accessibility | WCAG 2.2 AA: 4.5:1 text, 3:1 control boundaries and focus, 24px targets, focus not obscured, status messages announced. | w3.org/TR/WCAG22 |

## 2 · Copy rules

### Voice
Plain, short, specific. Say what happened, what it means for the user's money, and what to do next. No hype ("ape in", "moon", "guaranteed"), and no emoji.

### Glossary (use exactly)

| Say | Don't say | Why |
|---|---|---|
| **AI verification**, **AI-verified**, "the AI verifier", "trenchmart-ai-v1" | human review, reviewers, verifiers, staked verifier, "reviewed by humans" | Verification is automated (`packages/ai-verifier`). The `ai_verification` fee bucket funds it. No human verifiers are paid. |
| **Marketplace fee · 5%** | platform fee, commission, rebate | One fee, paid by the buyer |
| **`<Tier>` discount · −60% of fee** | holder rebate, cashback | Tiers discount the fee, not the price |
| **You pay** / **Total to escrow** | total at your tier | The total is what goes into escrow |
| **100% to creator**, **0% creator commission** | creator fee | — |
| **Solana network fee · to validators** | gas, our fee | It isn't our money |
| **Sign a message (not a transaction)** | approve, authorize | SIWS moves nothing |
| **Approve 1.53 SOL in wallet** | Buy, Confirm, Pay now | The button matches what the wallet will show |
| **In escrow · you can dispute for 41h 07m** | processing, pending | Says what it means and how long |
| **Escrow vault** (multisig) | on-chain escrow (POC) | POC is a Squads vault plus a ledger, not a program |
| **Attestation signed by trenchmart-ai-v1** | signed on-chain | POC attestations are signed off-chain (HMAC) and stored |

### Fees: show them exactly

- Buyer pays **list price + 5%**. Tiers cut **the fee**: Scout −25%, Trencher −60%, OG −100%. Creator commission is **0%**.
- The fee split of the net fee is buyback 40% · **AI verification 25%** · ops 20% · safety 15%.
- Worked example for a 1.50 SOL listing: None **1.575** · Scout **1.55625** · Trencher **1.53** · OG **1.50** SOL. The creator receives 1.50 in every case.
- Amounts are exact, with no rounding (see design-system › Money formatting). If a value doesn't fit, wrap it. Don't shorten it.
- All percentages come from config at runtime (`fee_bps`, `tier_rebate_bps`, `fee_split_bps`). The copy above is the current default; render the live values.
- Logged-out cards show `1.50 SOL` with "+ 5% fee · 0% for OG". Connected cards show the exact "you pay" at the user's tier.

## 3 · Flows

### Connect and sign in
1. "Connect wallet" opens `ConnectModal`. While Wallet Standard discovery settles, the list shows "Loading wallets…" (not "No wallets found").
2. Pick a wallet. Use `signIn` (one popup). The modal says: *"You'll sign one message to sign in. It's not a transaction: nothing moves and nothing is approved."* It previews the message (domain, address, nonce, issued at).
3. Success closes the modal, the wallet button shows `7xKp…a9Fq`, and the tier chip appears ("Trencher · 60% off fees", or "No tier · 5% fee").
4. Cancelled in wallet: "You cancelled in your wallet. Nothing was signed." (neutral). Wrong network: "Switch your wallet to Devnet to continue."

### Buy
1. Listing → **Review & buy** opens `CheckoutSheet` › Review. Never open the wallet straight from the listing page.
2. Review shows the item, version and sha, the full `FeeReceipt`, "Sent to: Escrow vault 9WzD…Tm4q", the memo `tm:<id8>`, release terms, the balance check, and a quote timer ("Quote held for 19:42"). The tier is re-checked (72h minimum balance).
3. **Approve 1.53 SOL in wallet** moves to Awaiting signature: "Check Phantom. Your wallet should show a transfer of 1.53 SOL to 9WzD…Tm4q with memo tm:8c1d2e0a. If it shows anything else, reject it."
4. Confirming: signed ✓ → processed ✓ → confirmed ◑ → checked by TrenchMart ○, with a Solscan (devnet) link. "You can close this. The order keeps confirming and shows up in Purchases."
5. Confirmed: "Payment confirmed" + `● PAID · IN ESCROW · 48h` + Download + receipt + "Open a dispute within 48h".

### Escrow and disputes
- Order states map 1:1 to `ORDER_STATUSES`: `pending` AWAITING PAYMENT · `paid` PAID · IN ESCROW · `disputed` DISPUTED · `released` RELEASED · `refunded` REFUNDED · `expired` EXPIRED.
- The current step always has: what is happening, who acts next, and an exact UTC time plus a countdown bar.
- Disputed shows both outcomes before the decision ("If upheld: 0.612 SOL refunded to you · If rejected: released to creator").
- Dispute form: reason (doesn't match report / doesn't work / malicious, which is open for 30 days), details (min 20 characters), and evidence. "Release is paused as soon as you submit."

### Creator upload
- Stepper: Identity & bond · Upload · Automated scan · **AI verification** · Live, driven by `version.status`.
- A warning sets `needs_creator`. The dashboard banner reads "1 version needs your explanation" with **Fix now**. Explain-field help: "The AI verifier reads this note. Say what the call does, which host it reaches and what data it sends. One-word notes like 'ok' are sent back."
- Rejected: show the failing rule in plain words ("sandbox: signTransaction call") and the fix path ("upload a new version").

## 4 · States per screen

| Screen | Loading | Empty | Error | Other |
|---|---|---|---|---|
| Home / Explore | Card skeletons at final size, `aria-busy` | "No listings for "<q>" on <terminal>" + Clear filters | "Couldn't load listings. Your wallet and open orders aren't affected." + Try again + ref | Holder-only lock, in-review (not buyable) |
| Listing | Skeleton header + buy box with "Getting your price…" | 404: "This listing doesn't exist or was delisted" + Explore | Quote failed: "Couldn't get a price. Try again." Buy disabled | Owned, holder-locked, delisted ("Delisted on <date>. Your download still works.") |
| Checkout | "Preparing your transaction…" | — | Insufficient SOL (blocked before signing, shows the shortfall + devnet faucet link) · Quote expired · Tx failed (says what was and wasn't charged) | Cancelled = neutral |
| Purchases | Row skeletons | "No purchases yet. Everything you buy shows up here with its escrow timer." + Browse | Inline error + retry | Disputed, refunded |
| Studio | Tile + row skeletons | First run: 3-step checklist (wallet ✓, link X, stake bond) | Upload failed: "Upload stopped at 62%. Nothing was published." + Retry | needs_creator banner, rejected reason |
| $TRENCH | Static | Tier thresholds not set: "Thresholds are set after launch" | — | — |

### Error copy

| Cause | Title | Body | Action | Tone |
|---|---|---|---|---|
| Wallet rejected (4001 / `WalletSignTransactionError` user reject) | You cancelled in your wallet | Nothing was sent. | Approve again | neutral |
| Not enough SOL | Not enough SOL | You need 1.530005 SOL (1.53 + network fee). This wallet has 0.9 SOL. | Get devnet SOL | danger, blocks the button |
| Quote expired (order TTL 20 min) | Quote expired | Quotes are held for 20 minutes. Nothing was charged. | Get a new quote | warn |
| Blockhash expired / dropped | Payment didn't go through | Solana rejected the transaction. At most the network fee left your wallet. | Try again | danger |
| Amount or memo mismatch (server) | We couldn't match this payment | Your payment of X SOL is in the vault but didn't match order tm:… We've flagged it for a refund. | Contact support | danger |
| Wallet disconnected mid-flow | Wallet disconnected | Reconnect to continue. Your quote is still held. | Reconnect | warn |
| Wrong network | Wrong network | Switch your wallet to Devnet. | — | warn |
| API down | Couldn't load … | What failed. What is not affected. | Try again · ref | danger |
| Rate limited (429) | Slow down a little | Try again in a few seconds. | auto-retry | neutral |

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

## 8 · Open questions for the owner

1. Should creators be able to appeal an AI rejection to a person? Today the flow is AI-only.
2. Logged-out cards show "1.50 SOL + 5% fee · 0% for OG". Would you prefer the no-tier total (1.575)?
3. Should "In AI review" listings be visible to buyers (not buyable), or hidden until live?
4. Should downloads during escrow stay as specified (download-then-dispute risk), or wait for confirmation + 1h?
5. Should "Disputes lost: 0 of 1,204" show total sales, or a rate?
6. Fiat estimate (≈ $) on mainnet only?
7. Live landing stats (verified listings, SOL in escrow, refunds) once real data exists?
