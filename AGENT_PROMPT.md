# Brief for the building agent

You are building **Trenchmart**, a verified marketplace for Solana trading tooling (userscripts, wallet lists, terminal filters, setups, strategies, alert configs). This folder is your complete spec. Read `README.md`, then every file in `docs/` in order, before writing code.

## What to build

A working POC on **Solana devnet** with:

1. A pnpm + Turborepo monorepo: `apps/web` (Next.js on Cloudflare Workers via OpenNext), `apps/api` (Hono on Cloudflare Workers), `apps/sandbox` (Node + Playwright runner for a VPS), `packages/shared` (zod schemas, types, fee math, tier math), `packages/scanner` (static scanner, pure TS, runs in a Worker), `packages/db` (Drizzle schema + migrations for Supabase Postgres).
2. The four designed screens (`design/` + `docs/09-screens.md`) implemented faithfully with React + Tailwind using the tokens in `docs/08-design-system.md`, plus the extra screens listed in `docs/09-screens.md` (reviewer queue, my purchases, creator dashboard, dispute form).
3. Every backend flow in `docs/04`–`docs/07`: Sign-In With Solana, listings, versioned uploads to R2 with sha256 pinning, the scan pipeline, human review, checkout with a payment to the escrow vault, payment verification, signed downloads with a watermark, 48h escrow and payout cron, disputes, holder tiers from Helius webhooks.

## Rules

- Follow `docs/10-build-plan.md` milestone by milestone. Each milestone's acceptance criteria must pass before you start the next.
- TypeScript strict mode. Validate every request body with the zod schemas in `packages/shared`.
- Money is **integer lamports** (`bigint` in TS, `bigint` in Postgres). Never floats. Fee math uses basis points.
- All fee percentages, tier thresholds, bond sizes and the escrow window come from the `config` table / `packages/shared/config.ts`, never hard-coded in handlers.
- Never store or request private keys or seed phrases. The only signatures you ask users for are a SIWS login message and transactions they send themselves.
- Downloads are always served via short-lived signed R2 URLs to wallets with a PAID or RELEASED order.
- A version's file is immutable once uploaded. A changed file is a new version and runs the whole pipeline again.
- Write tests: unit tests for the scanner rules, fee math and tier math; integration tests for the order state machine. Use Vitest.
- Use placeholder values from `.env.example`. Ask the owner for real keys; don't invent them.
- Keep the design's copy. Stats marked `[X]`/`[PRICE]` etc. stay as placeholders until real data exists.

## Deliver

- The repo, a root `README.md` with local setup (`pnpm i`, `pnpm db:migrate`, `pnpm dev`), deploy steps for Cloudflare, Supabase and the sandbox VPS, and a seed script that creates demo creators, listings and versions on devnet.
- A short `STATUS.md` listing what's done, what's stubbed, and known gaps.
