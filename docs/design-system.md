# TrenchMart design system (v2)

Supersedes the visual parts of `docs/08-design-system.md`. Machine-readable values live in `design/tokens.json`. Copy, flows and states are in `docs/ux-guidelines.md`. Visual references are in `design/*.dc.html` (pixel/copy) and `design/explorations/` (concepts with every state).

## Principles

1. **Proof before price.** Trust facts (checks passed, pinned hash, bond, disputes lost) come before or next to the price, never hidden behind a click.
2. **Money is a receipt.** Wherever SOL moves, show every line: list price, the 5% fee, the tier discount, the total and the network fee. Use exact amounts.
3. **One status, one symbol, one word.** Every state reads as symbol + uppercase word + colour. Never colour alone.
4. **Testnet honesty.** A devnet bar is always visible. Explorer links carry `?cluster=devnet`.
5. **Dense, calm, terminal.** Near-black ground, one lime accent, mono for numbers. Thin 1px borders, no shadows, no glow, no emoji.

## Colour

All text tokens pass WCAG 2.2 AA (4.5:1) on `bg`, `bg-inset`, `surface` and `surface-2`. `border-control` passes 3:1 for control boundaries (1.4.11).

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `bg` | `#0A0B0A` | Page | — |
| `bg-inset` | `#0E100E` | Inputs, code, receipts, ticker | — |
| `surface` | `#121412` | Cards, panels, table headers, modals | — |
| `surface-2` | `#161916` | Active nav pill, rows, disabled fill | — |
| `border` / `border-soft` / `border-strong` | `#262A26` / `#1E221E` / `#343A34` | Decorative card edges, dividers, receipt dashes | decorative |
| **`border-control`** (new) | `#646C63` | Inputs, selects, checkboxes, radios, secondary buttons, inactive pills | 3.4:1 on surface |
| `text` | `#EDEFEA` | Primary text | 17:1 |
| `text-2` | `#B4BAB2` | Body on dark | 9.4:1 |
| `muted` | `#9BA19A` | Labels, meta | 7.0:1 |
| **`faint`** (changed) | `#868D86` (was `#6E756D`) | Fine print, help text, licence | 5.4:1 |
| **`decor`** (new) | `#6E756D` | Non-text only: code line numbers, dividers | 3.9:1, never for text people need |
| `accent` | `#C6F432` | Primary buttons, OK state, links, focus | 14.4:1 |
| `on-accent` | `#0A0B0A` | Text on accent | 15.4:1 |
| `accent-bg` / `accent-border` | `#141A08` / `#2E3A12` | OK and holder panels | — |
| `accent-label` / `accent-body` | `#9FAF86` / `#C9D0BE` | Text inside accent panels | 7.6 / 11.2:1 |
| `warn` (+`-bg`, `-border`) | `#F5A524` | Needs action, awaiting signature, warnings | 8.8:1 |
| `danger` (+`-bg` `#1F1210`, `-border` `#4A2620`) | `#FF8A7A` | Fail, disputed, rejected, blocking errors | 8.1:1 |
| **`info`** (new, +`-bg` `#0F1620`, `-border` `#1E3448`) | `#7CC4FF` | On-chain in progress (confirming, in AI review, refunded, holder window) | 9.9:1 |

Category accents are unchanged (see `tokens.json › color.category`). Fee split colours: buyback `#C6F432`, **AI verification** `#7CC4FF`, ops `#C9A2FF`, safety `#F5A524`, all with `#0A0B0A` text.

### Tone map

| Tone | fg / bg / border | Means |
|---|---|---|
| `ok` | accent / accent-bg / accent-border | Done, passed, safe, yours |
| `warn` | warn / warn-bg / warn-border | You need to act, or check something |
| `info` | info / info-bg / info-border | Waiting on the network or the system, no action needed |
| `danger` | danger / danger-bg / danger-border | Failed, blocked, disputed |
| `neutral` | text-2 / surface / border | Draft, expired, cancelled |

## Type

- **Geist** for UI and **Geist Mono** for prices, hashes, addresses, memos, codes and tags. Every number column uses `font-variant-numeric: tabular-nums`.
- Scale: hero `clamp(40px,6vw,68px)`/700/−0.035em · H1 44px (30px on phones) · H2 28px · H3 20px · lead 17–18px · body 15px/1.5 · meta 13px · label 11–12px mono uppercase with +0.04em tracking.
- Prices: mono 600. Buy box total 36px, card 17px, receipt 13px.

## Money formatting

- Store and compute in **lamports** (`bigint`). Display in SOL.
- **Exact:** trim trailing zeros, keep at least 2 decimals, never round or truncate. `1556250000` shows as `1.55625 SOL`, `75000000` as `0.075 SOL`, `1500000000` as `1.50 SOL`.
- The shared `formatSol()` truncates to 3 decimals (`1.556`). Don't use it for user-facing amounts. Use a display-only formatter in the web app (`formatSolExact`).
- Discounts are negative with a real minus sign: `−0.045 SOL`, in `accent`.
- Never show a "holder price" below list price: tiers only discount the fee.

## Spacing, shape, layout

- 4px base. Steps: 4 6 8 10 12 14 16 20 24 28 32 48 64 72.
- Radius: tag 6 · control 10 · card 14 · panel 16 · bottom sheet 20 (top corners) · pill 999.
- No shadows. Elevation is surface colour plus border. Modals add a `rgba(0,0,0,.7)` scrim.
- Max width 1280, gutter 24 (16 on phones). Breakpoints: sm 640 · md 768 · lg 960 · xl 1280.
- Cards: `repeat(auto-fill, minmax(280px, 1fr))`. Sidebars (buy box, filters, studio aside) wrap under content below 960.
- Targets: at least 24×24 everywhere (2.5.8), 44 for touch, 48–52 for primary actions on phones.

## Components

Each component lists variants, states and its `data-testid`. Test IDs are stable contracts for Playwright, so don't rename them without updating the e2e suite.

| Component | Variants / states | Spec | `data-testid` |
|---|---|---|---|
| `NetworkBanner` | devnet, mainnet (hidden) | warn-bg strip, mono 12px: "DEVNET · test SOL only · nothing here has real value". `role="note"`. | `network-banner` |
| `TopTicker` | — | 12px mono, live dot, `$TRENCH [PRICE]`, holder line, trust line "Every version scanned, sandboxed and AI-verified before it goes live". Hidden under 640. | `top-ticker` |
| `NavBar` | logged out · connecting · connected | Logo, Explore / Sell / $TRENCH / Purchases, search (`/` focuses), tier chip, wallet button. Mobile: logo, search icon, wallet button, menu. | `nav`, `nav-search`, `tier-chip` |
| `WalletButton` | disconnected "Connect wallet" · discovering "Loading wallets…" (disabled) · connecting "Check your wallet…" · connected `7xKp…a9Fq` (menu: copy address, Purchases, Studio, Disconnect) | primary 44px | `wallet-button` |
| `ConnectModal` | wallet list · signing · error | Wallet Standard list (detected / not installed), "Use installed wallet" on Android, preview of the SIWS message, "not a transaction" line | `connect-modal` |
| `Button` | primary · secondary (`border-control`) · ghost · danger · disabled; sm 36 / md 44 / lg 48 / xl 52 | 600 weight; `aria-busy` while working; disabled = surface-2 + faint text, not opacity | — |
| `Tag` | category · ok · wait · bad · inf · neutral · dark | mono 11px, 3×8 padding, radius 6, 1px border in tone | — |
| `StatusTag` | every value in `tokens.json › status` | symbol + WORD, tone colours | `status-tag` + `data-status` |
| `ListingCard` | logged out (`1.50 SOL` + "+ 5% fee · 0% for OG") · connected ("1.53 SOL you pay · Trencher rate") · in review (not buyable) · holder-only lock (countdown) · skeleton | 112px tinted header (category tag, status tag, terminals), body: title, `@creator · bond 5 SOL · 412 sold · ★ 4.9`, price line | `listing-card` |
| `TerminalFilter` | pill group, `aria-pressed` | inactive border `border-control`, active accent fill | `terminal-filter` |
| `TrustStrip` | 4 cells / phone checklist | Static + sandbox scan · AI verification · Hash-pinned versions · 48h escrow | `trust-strip` |
| `SecuritySummary` | pass · warn · fail | accent-bg panel, shield, "Passed · 9 of 9 checks", "Attestation signed by trenchmart-ai-v1 on <date>", "View attestation" | `security-summary` |
| `CheckItem` / `ScanRow` | pass ✓ · warn ! · fail × · n/a – | 22px square + title + detail + mono label | `check-item` |
| `PermissionsTable` | — | @match, @grant, @connect, sha256 (copy button) | `permissions` |
| `BuyBox` | logged out · ready · owned/in escrow · holder-locked · in review · loading quote | "You pay · <tier>" + tier tag, total 36px, `TierPreview`, `FeeReceipt`, "Review & buy" xl, escrow note, licence | `buy-box`, `buybox-total`, `buy-button` |
| `TierPreview` | 4 pills; user's tier says "your tier", others "preview" | `role="group"`, `aria-pressed` | `tier-preview` |
| `FeeReceipt` | compact (card) · full (buy box, checkout, order) | Dashed inset box. Rows: List price · 100% to creator / Marketplace fee · 5% / `<Tier>` discount · −X% of fee / **Total to escrow** / Solana network fee · to validators | `fee-breakdown` |
| `CheckoutSheet` | review · awaiting-signature · confirming · confirmed · cancelled · insufficient · expired · failed | Modal 480px, bottom sheet under 640. 3-segment progress. `role="dialog"`, focus trap, Esc closes (except while signing). Live region for state changes. | `checkout`, `checkout-state` + `data-state` |
| `TxProgress` | signed → processed → confirmed → checked by TrenchMart | 4 rows of status squares; explorer link | `tx-progress` |
| `EscrowTimeline` | paid · licence · in escrow (countdown + bar) · released / disputed / refunded | Vertical list, accent connector for done steps, exact UTC times | `escrow-timeline` |
| `Countdown` | running · paused · elapsed | mono, `aria-live="off"` (announce only at thresholds), plus a bar | `countdown` |
| `PurchasesTable` | table ≥ 640 · cards < 640 | item, version, paid, status, escrow, actions | `purchases-table` |
| `DisputeForm` | — | reason radios, details (min 20 chars), evidence drop zone, window banner | `dispute-form` |
| `CreatorCard` | — | avatar, handle, 2×2 stats: bond, disputes lost, identity, tier; report link | `creator-card` |
| `PipelineStepper` | done · now · next · blocked | 5 steps: Identity & bond · Upload · Automated scan · AI verification · Live | `pipeline` |
| `PipelineBar` | compact 5-segment bar for tables | segment tones as stepper | — |
| `FlaggedCode` | — | warn-border panel, highlighted line, explain textarea ("The AI verifier reads this note"), quick fix | `flagged-code` |
| `StatTile` | — | label, mono value, meta | `stat-tile` |
| `FeeTable`, `SplitBar`, `TierCard`, `SavingsCalc` | as handover | split label "AI verification"; SplitBar `role="img"` with a full aria-label | `fee-table`, `split-bar`, `tier-card`, `savings-calc` |
| `EmptyState` | search · first-run · no purchases · no listings | icon 36px muted, title, one sentence, 1–2 actions | `empty-state` |
| `ErrorState` | inline · page | danger panel, what failed, what is **not** affected, retry, ref code | `error-state` |
| `Skeleton` | card · row · text | surface-2 to border-soft shimmer; static under `prefers-reduced-motion` | `skeleton` |
| `Toast` | info · ok · warn · danger | bottom-right desktop, top on phones; `role="status"` (danger uses `role="alert"`); auto-dismiss 6s except danger | `toast` |

## Iconography

Inline stroke SVG, 2px, round caps (lucide-compatible). Sizes 16 / 18 / 22 / 40. Decorative icons get `aria-hidden="true"`. No emoji.

## Motion

120ms for hover and press, 200ms for sheets and modals, easing `cubic-bezier(.2,0,0,1)`. Under `prefers-reduced-motion: reduce`: no skeleton shimmer, the spinner becomes a static ◑, and sheets appear without sliding.

## Focus and accessibility rules

- Focus ring: `outline: 2px solid #C6F432; outline-offset: 2px` on every interactive element (`:focus-visible`).
- `scroll-padding-bottom: 96px` on pages with the sticky mobile buy bar, so focused elements aren't hidden behind it (2.4.11).
- Toggle groups use `aria-pressed`. Tabs use `role="tablist"`/`tab`/`tabpanel` with `aria-selected`, `aria-controls` and arrow-key movement.
- Status changes in checkout and escrow go through one `aria-live="polite"` region. Blocking errors use `role="alert"`.
- Forms: every input has a visible `<label>`, help and errors are linked with `aria-describedby`, and errors use the danger border plus text, not colour alone.
- Truncated addresses carry the full value in `title` and in an accessible name (`aria-label="Wallet 7xKp…a9Fq, full address …"`).

## Tailwind mapping

```ts
theme: { extend: {
  colors: {
    bg: '#0A0B0A', inset: '#0E100E', surface: '#121412', surface2: '#161916',
    line: { DEFAULT: '#262A26', soft: '#1E221E', strong: '#343A34', control: '#646C63' },
    ink: { DEFAULT: '#EDEFEA', 2: '#B4BAB2', muted: '#9BA19A', faint: '#868D86', decor: '#6E756D' },
    lime: { DEFAULT: '#C6F432', hover: '#DDFF7A', bg: '#141A08', line: '#2E3A12', label: '#9FAF86', body: '#C9D0BE' },
    warn: { DEFAULT: '#F5A524', bg: '#1C160A', line: '#3A2C0E' },
    danger: { DEFAULT: '#FF8A7A', bg: '#1F1210', line: '#4A2620' },
    info: { DEFAULT: '#7CC4FF', bg: '#0F1620', line: '#1E3448' },
    sky: '#7CC4FF', violet: '#C9A2FF', teal: '#6EE7C8',
  },
  fontFamily: { sans: ['Geist', 'system-ui'], mono: ['Geist Mono', 'ui-monospace', 'monospace'] },
  borderRadius: { tag: '6px', ctl: '10px', card: '14px', panel: '16px', sheet: '20px' },
}}
```
