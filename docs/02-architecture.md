# 02 · Architecture

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js (App Router) on Cloudflare Workers via `@opennextjs/cloudflare`, React, Tailwind, `@solana/wallet-adapter-react` | Preview deploy per branch, edge-fast, free tier |
| API | Hono on Cloudflare Workers | Tiny, typed, same runtime as web |
| DB | Supabase Postgres + Drizzle ORM | Relational marketplace data, full-text search, cheap |
| Files | Cloudflare R2 | No egress fees, signed URLs |
| Jobs | Cloudflare Queues + Cron Triggers | Scans, payouts, tier refresh |
| Static scan | `packages/scanner` (acorn AST + rules) inside a queue consumer Worker | Pure TS, no infra |
| Sandbox | `apps/sandbox`: Node + Playwright + Tampermonkey on a small VPS | Needs a real browser |
| Solana data | Helius RPC + enhanced webhooks | Payments verification, $TRENCH transfers |
| Treasury | Squads multisig vault | POC escrow + fee buckets |
| Validation | zod (shared) | One schema for web + api |
| Tests | Vitest | Fast |

## Repo layout

```
trenchmart/
├─ apps/
│  ├─ web/            Next.js app (screens, wallet connect, SIWS client)
│  ├─ api/            Hono Worker: REST API, webhooks, queue consumers, cron
│  └─ sandbox/        Node service: pulls sandbox jobs, runs Playwright, posts results
├─ packages/
│  ├─ shared/         zod schemas, types, config, fee.ts, tier.ts, siws.ts
│  ├─ scanner/        static scan rules + tests
│  └─ db/             Drizzle schema, migrations, seed
├─ turbo.json
├─ pnpm-workspace.yaml
└─ .env.example
```

## System diagram

```
                          ┌──────────────────────────┐
                          │   Buyer / Creator        │
                          │   browser + wallet       │
                          └────────────┬─────────────┘
                                       │ HTTPS
                ┌──────────────────────▼──────────────────────┐
                │              CLOUDFLARE EDGE                │
                │  ┌──────────────┐       ┌────────────────┐  │
                │  │  web         │──────▶│  api (Hono)    │  │
                │  │  Next.js     │       │  auth · orders │  │
                │  └──────────────┘       │  listings      │  │
                │                         └───┬───┬───┬────┘  │
                │   ┌─────────────────┐       │   │   │       │
                │   │ R2 (files)      │◀──────┘   │   │       │
                │   │ blobs/<sha256>  │ signed    │   │       │
                │   └─────────────────┘ URLs      │   │       │
                │   ┌─────────────────┐  enqueue  │   │       │
                │   │ Queues + Cron   │◀──────────┘   │       │
                │   └───┬─────────┬───┘               │       │
                └───────┼─────────┼───────────────────┼───────┘
                        │         │                   │ SQL
          ┌─────────────▼──┐  ┌───▼──────────────┐  ┌─▼──────────────────┐
          │ Sandbox VPS    │  │ Static scanner   │  │ Supabase Postgres  │
          │ Playwright     │  │ (Worker)         │  │                    │
          └────────────────┘  └──────────────────┘  └─▲──────────────────┘
                                                      │ webhooks → api
          ┌─────────────────────────────────────────┐ │
          │  SOLANA: Squads vault · $TRENCH mint    │─┘ Helius
          └─────────────────────────────────────────┘
```

## Queues

| Queue | Producer | Consumer | Payload |
|-------|----------|----------|---------|
| `scan-static` | api on upload complete | api queue handler | `{versionId}` |
| `scan-sandbox` | static scan done (userscript/alerts only) | sandbox VPS polls `GET /internal/sandbox/next` (pull model, simpler than push to VPS) | `{versionId}` |
| `notify` | anywhere | api | `{userId, kind, data}` (POC: store in `notifications` table) |

## Cron (UTC)

| Schedule | Job |
|----------|-----|
| `*/10 * * * *` | `releaseEscrow`: orders PAID with `escrow_until < now()` and no open dispute → RELEASED, create payout rows |
| `*/15 * * * *` | `executePayouts`: batch pending payouts into vault transactions proposed to Squads (POC: write CSV/JSON for multisig signers, mark `proposed`) |
| `*/5 * * * *` | `expirePendingOrders`: PENDING older than 20 min → EXPIRED |
| `0 * * * *` | `reconcileTiers`: refresh balances for wallets active in last 24h via RPC (backstop to webhooks) |
| `0 3 * * *` | `trendingRollup`: recompute 7d sales per listing |

## Environments

| Env | Chain | DB | Notes |
|-----|-------|----|-------|
| local | devnet | Supabase local (`supabase start`) or a free project | `wrangler dev` for api, `next dev` for web |
| preview | devnet | shared staging project | every PR |
| prod | mainnet-beta | Supabase Pro | after M6 |

## Auth

Sign-In With Solana (SIWS):
1. `POST /auth/nonce {wallet}` → `{nonce, message}` (message includes domain, wallet, nonce, issued-at, expiry 10 min).
2. Wallet `signMessage(message)`.
3. `POST /auth/verify {wallet, signature}` → verify ed25519 (`tweetnacl`), nonce single-use → set `tm_session` cookie (HttpOnly, Secure, SameSite=Lax), JWT signed with `SESSION_SECRET`, 7-day expiry.
4. Roles come from `users.roles` and are re-read on each request (don't trust JWT for roles).

X (Twitter) linking for creators: OAuth 2.0 PKCE, store handle + id only.

## Cross-cutting
- Rate limit by IP and wallet on auth, upload and checkout (Cloudflare Rate Limiting binding or a simple KV counter).
- All webhooks verify a shared secret header (`HELIUS_WEBHOOK_SECRET`).
- Internal endpoints (`/internal/*`) require `INTERNAL_TOKEN` (sandbox VPS uses it).
- Log every state transition into `audit_log`.
