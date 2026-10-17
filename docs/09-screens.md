# 09 · Screens

Four screens are fully designed (`design/*.dc.html`). Others below are specified in words; build them with the same components. All pages are fluid: max-width 1280, cards in `auto-fill minmax(280px,1fr)` grids, sidebars wrap under content below ~960px.

## Designed

### 1. Home & browse — `/` (`design/Main.dc.html`)

1. **Top ticker**: "Solana devnet · live", `$TRENCH [PRICE]`, "Holders: up to 100% off the 5% fee", right: "Every version scanned, sandboxed and AI-verified before it goes live". A devnet banner sits above it (see `docs/ux-guidelines.md`).
2. **Nav**: logo, Explore / Sell / $TRENCH / Creators, search (focus with `/`), tier chip, wallet button (or "Connect wallet").
3. **Hero** (2 columns): pill "Solana first · more chains later"; H1 "The verified edge, / for sale."; lead copy; buttons "Browse the market" (primary) + "Sell your tooling". Right: featured listing as a `CodeWindow` showing its header, permission ticks and a filter snippet, footer with title/creator/price → links to listing.
4. **Trust strip**: Static + sandbox scan · Human review · Hash-pinned versions · Escrowed payouts.
5. **Categories** (6 cards).
6. **Trending this week**: terminal filter pills (All, Axiom, GMGN, Photon, BullX, Padre) → filters cards; grid of `ListingCard`. Data: `GET /listings?sort=trending&terminal=`.
7. **Bottom split**: "Top verified creators" list (rank, avatar, handle, category · bond, 30d volume) + $TRENCH holder banner (3 tier mini-tiles, CTA → `/token`).
8. **Footer**: Security policy, Report a listing, Become a verifier, Docs; "Not financial advice. Tools don't guarantee profits."

### 2. Listing — `/l/[slug]` (`design/Listing.dc.html`)

- Breadcrumb Explore / Category / Title.
- **Left**: tags (category, `✓ VERIFIED · v2.1.3`, terminals), H1, summary, meta line (rating, sold, updated). Preview panel (screenshots carousel; design shows a mock filter rail + pair list as placeholder). Tabs: **Security report** (default) · Overview · Reviews · Changelog.
  - Security report: `SecuritySummary`, grid of `CheckItem`s from `security.checks`, `PermissionsTable`.
  - Overview: "What's inside" bullet list from description.
  - Reviews: verified-buyer reviews, note "Only wallets that bought this listing can review it."
  - Changelog: version, note, "reviewed ✓".
- **Right (BuyBox)**: total at your tier (mono 34px), tier preview pills (None/Scout/Trencher/OG — in production, pre-select the user's tier and label others "preview"), breakdown (list price, platform fee 5%, holder rebate, you pay), "Buy with SOL", escrow note, license note. If owned: "Download" + "Open dispute" instead. If holder-only locked: disabled with countdown.
- **CreatorCard** below.

### 3. Creator upload & verification — `/studio/listings/[id]/versions/[vid]` (`design/Upload.dc.html`)

- Header "Creator studio".
- H1 "New listing", explainer.
- `PipelineStepper`: Identity & bond · Upload · Automated scan · Human review · Live — live states from `version.status`.
- **Left**: "Step 3 · Automated scan" with file row (name, size, sha256, Replace file), `ScanRow` list, status line "1 warning · fix or explain to continue". `FlaggedCode` per warn with explain textarea → `POST /explain`, and quick fix "Declare @connect host" (opens new version flow with header patched suggestion — POC: just copy text).
- **Right**: Listing details form (title, category, price SOL, license, holder-only early access checkbox) and Trust requirements (wallet signed, X linked, bond progress, verification fee + waiver note, bond explanation).

### 4. Fees & $TRENCH — `/token` (`design/Economics.dc.html`)

- Hero: pill "$TRENCH · fair launch on pump.fun", H1 "Fees fund the token. / The token cuts your fees.", 3 stat tiles (5% / 100% / 40%).
- Fee model table with "PROPOSED" tag (drop the tag when final).
- "Where every fee goes": `SplitBar` + 4 explainer cards.
- Holder tiers: 3 `TierCard`s.
- Savings calculator + "How holding is checked" (4 steps).

## Not designed yet — build with same system

| Screen                  | Route                        | Contents                                                                                                             |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Connect / sign-in modal | —                            | wallet list, "Sign message to continue (no transaction)"                                                             |
| Checkout modal          | —                            | quote, "Approve in wallet", pending → confirmed states, tx link (Solscan), "Download"                                |
| My purchases            | `/me/purchases`              | table: item, version, paid, escrow ends, status, Download / Dispute / Review                                         |
| Dispute form            | `/me/purchases/[id]/dispute` | reason radio, details, evidence upload (R2), escrow timer                                                            |
| Creator dashboard       | `/studio`                    | requirements checklist, listings table (status per version), payouts, bond panel                                     |
| New listing form        | `/studio/listings/new`       | metadata, media upload, then version upload (drag-drop)                                                              |
| Verifier queue          | `/review`                    | table of in_review versions, age, category, warnings count                                                           |
| Verifier detail         | `/review/[vid]`              | code viewer with highlighted locations, diff toggle, checks, sandbox network log, creator note, decision form + sign |
| Admin                   | `/admin`                     | disputes, payout batches, config editor, users/roles                                                                 |
| Verify a file           | `/verify`                    | drop a file → "Matches reviewed v2.1.3 of <listing>" / "No match"                                                    |
| Category page           | `/c/[category]`              | browse filtered + sort                                                                                               |
| Creator profile         | `/u/[handle]`                | listings, stats, bond                                                                                                |
| Search results          | `/search?q=`                 | listing grid                                                                                                         |
