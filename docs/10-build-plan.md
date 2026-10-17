# 10 · Build plan

Work milestone by milestone. Don't start the next until the acceptance criteria pass.

## M0 · Scaffold (½ day)

- pnpm + Turborepo, `apps/web`, `apps/api`, `apps/sandbox`, `packages/{shared,scanner,db}`.
- TS strict, ESLint, Prettier, Vitest. `wrangler.toml` for api (R2, Queues, Cron bindings), OpenNext config for web.
- Drizzle schema from `03-data-model.md`, first migration, `config` seed.
- GitHub Actions: typecheck, lint, test on PR.
  **Done when:** `pnpm dev` runs web (localhost:3000) and api (localhost:8787); `pnpm db:migrate` creates every table; CI green.

## M1 · Design system + static screens (1–2 days)

- Tailwind theme from `08-design-system.md`, fonts, all components listed there.
- Build the 4 designed pages with mock data from `packages/shared/fixtures.ts` (copy the sample listings from `design/Main.dc.html`).
  **Done when:** each page matches its design file side by side at 1440px and is usable at 390px (no horizontal scroll); terminal filter, listing tabs, tier pills and savings calculator are interactive; Lighthouse a11y ≥ 95.

## M2 · Auth + browse (1–2 days)

- SIWS (`02-architecture.md` Auth), `/me`, wallet button.
- `GET /listings` (search, filter, sort, cursor), `/listings/:slug`, `/creators/top`.
- Seed script: 4 creators, 8 listings (the design's samples) each with a live version, scans and an attestation.
  **Done when:** sign in with Phantom on devnet works; refresh keeps session; nonce reuse fails; home and listing pages render from the API.

## M3 · Upload + scanner (2–3 days)

- Studio requirements, bond deposit + verification (devnet), X linking (can be stubbed with a manual handle in dev).
- Presigned upload, `/complete` hashing + pinning, `scan-static` queue.
- `packages/scanner` with every rule in `05-security-pipeline.md`.
- Studio version page wired to real status.
  **Done when:** scanner tests cover each rule with at least one positive and one negative fixture (e.g. a drainer-style `signTransaction` script fails; `GM_xmlhttpRequest` to an undeclared host warns; a clean filter JSON passes). Uploading the same bytes twice yields the same `r2_key`. A WARN version sits in `needs_creator` until explained.

## M4 · Sandbox + review (2 days)

- `apps/sandbox` runner (Playwright, fake wallet provider, network log), Dockerfile for the VPS.
- `/internal/sandbox/*` endpoints.
- Verifier queue + detail + signed decision; approve makes version live and supersedes the old one.
  **Done when:** a script that calls `window.solana.signTransaction` on page load fails the sandbox; a clean script passes; a verifier can approve with a wallet signature that the API verifies; listing shows `✓ VERIFIED · vX` with attestation details.

## M5 · Checkout, escrow, downloads, tiers (3 days)

- `fee.ts`, `tier.ts` + tests.
- Quote, order, unsigned tx, submit, verify via RPC and Helius webhook (idempotent).
- Signed downloads with watermark; `/verify` tool.
- Cron: expire, release, payout batches; admin batch page.
- Helius $TRENCH webhook (use a devnet test mint), snapshot on first login, reconcile cron, 72h min rule, holder-only window.
  **Done when:** end-to-end on devnet: buyer pays 1.53 SOL at Trencher tier for a 1.5 SOL listing → order paid → download works and watermark line contains the order id → `/verify` says "Matches" → after the escrow window (set to 2 min in dev) payouts appear: creator 1.5 SOL and buckets totaling 0.030 SOL. Sending tokens away drops the tier only after the window passes (test with fake timestamps). Webhook replay creates no duplicates.

## M6 · Disputes, reviews, hardening (2 days)

- Disputes (buyer + admin), slashing, refunds, notifications.
- Buyer reviews (paid orders only), rating aggregates, trending rollup.
- Rate limits, audit log, ledger invariant check, error pages, empty states.
- Remaining screens from `09-screens.md`.
  **Done when:** an upheld malicious dispute refunds the buyer, delists the listing, slashes the bond and logs everything; a rejected dispute releases to the creator; rate limits return 429.

## M7 · Launch prep

- Mainnet config, Squads vault, real bucket wallets, Supabase Pro, Workers paid.
- Security review of api (authz on every route), dependency audit, backup policy.
- `STATUS.md`, runbook (payout batches, disputes, re-scan).

## Test matrix (minimum)

| Area    | Tests                                                                          |
| ------- | ------------------------------------------------------------------------------ |
| scanner | every rule ± fixtures, obfuscated sample, zip traversal                        |
| fee     | rounding, all tiers, split sums                                                |
| tier    | min-balance window, snapshot vs webhook first row, disabled thresholds         |
| orders  | state machine transitions, wrong amount, wrong memo, expired, duplicate sig    |
| auth    | bad signature, expired nonce, reused nonce                                     |
| authz   | creator can't review own; buyer can't download unpaid; non-admin can't resolve |
