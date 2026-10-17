# Trenchmart — Build Handover

Verified marketplace for Solana "trench" tooling: Tampermonkey userscripts for trading terminals, wallet tracker lists, terminal filter presets, full setups, wallet strategies and alert configs. Every upload is scanned and human-reviewed before it goes live. Payments in SOL with a 48h escrow. A pump.fun token ($TRENCH, placeholder ticker) gives holders fee discounts and perks.

> Working names: **Trenchmart** and **$TRENCH** are placeholders. Search-and-replace when the real names are chosen.

## Read in this order

| #   | File                           | What it covers                                         |
| --- | ------------------------------ | ------------------------------------------------------ |
| 0   | `AGENT_PROMPT.md`              | Paste this to the building agent as its brief          |
| 1   | `docs/01-product.md`           | Users, categories, features, scope (POC vs later)      |
| 2   | `docs/02-architecture.md`      | Stack, repo layout, diagrams, environments             |
| 3   | `docs/03-data-model.md`        | Full Postgres schema (SQL) + state machines            |
| 4   | `docs/04-api.md`               | Every endpoint, auth, request/response shapes          |
| 5   | `docs/05-security-pipeline.md` | Upload → hash → static scan → sandbox → human review   |
| 6   | `docs/06-payments-escrow.md`   | Checkout, escrow, payouts, disputes, fee math          |
| 7   | `docs/07-token-tiers.md`       | $TRENCH holder tiers, 72h min-balance rule, Helius     |
| 8   | `docs/08-design-system.md`     | Colors, type, spacing, components                      |
| 9   | `docs/09-screens.md`           | Screen-by-screen spec of the 4 designed pages + extras |
| 10  | `docs/10-build-plan.md`        | Milestones, tasks, acceptance criteria, test plan      |
| 11  | `docs/11-costs.md`             | Hosting cost estimate by stage                         |
| —   | `design/`                      | Design sources (`*.dc.html`) + `tokens.json`           |
| —   | `.env.example`                 | Every env var the system needs                         |

## Design reference

The visual design lives on a Claude Design canvas (link in the conversation where this pack was made; it's private until the owner shares it). The same four screens are in `design/` as source files. They are written in a templated HTML format (`.dc.html`): markup is plain HTML with inline styles, `{{holes}}` are filled from the `renderVals()` script at the bottom of each file, `<sc-for>` is a loop and `<sc-if>` is a conditional. Treat them as **pixel and copy reference**, then rebuild them as React + Tailwind components. Don't try to run them.

## Decisions already made

- Solana only for v1. Chain-specific code isolated so other chains can be added.
- Cloudflare (Workers, R2, Queues, Cron) + Supabase Postgres + Helius.
- TypeScript everywhere, pnpm + Turborepo monorepo.
- Creator keeps 100% of the list price; buyer pays a 5% platform fee, discounted by tier.
- POC escrow = platform vault (Squads multisig) + off-chain ledger + cron payouts. On-chain Anchor escrow is phase 2 and must be audited.
- Content-hash pinning: reviewers approve a hash; buyers only ever receive that hash (plus a strippable watermark header).
- All numbers in the fee model and tier thresholds are **proposals** and live in config, not code.
