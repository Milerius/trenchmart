# Deploying the database (Supabase + Cloudflare Hyperdrive)

The API Worker talks to Supabase Postgres with postgres.js. It picks its connection string in this order:

1. `env.HYPERDRIVE.connectionString`, from a Hyperdrive binding named `HYPERDRIVE`. Use this one in production.
2. `env.DATABASE_URL`, a Worker secret. It is the fallback for local `wrangler dev` and for accounts without Hyperdrive.

## Why Hyperdrive

Supabase signs its Postgres certificates with its own CA. workerd cannot verify that CA, so `sslmode=require` from a Worker hangs during the TLS handshake. A plain `DATABASE_URL` to the Supavisor pooler works, but the traffic is unencrypted. The password is still protected, because Supavisor uses SCRAM. Hyperdrive opens the TLS connection to Supabase from Cloudflare's side and pools connections between requests.

## One-time setup

```bash
# Session pooler (port 5432) or the direct host. Hyperdrive does its own pooling.
npx wrangler hyperdrive create trenchmart-db \
  --connection-string="postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Then add the binding to `apps/api/wrangler.toml` and redeploy:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "067fbd6cc9a949e7a62155bf3fd2fe91"   # trenchmart-db, created 2026-10-18
```

Already bound in `apps/api/wrangler.toml` and `wrangler.deploy.toml`. The API token needs
**Account › Hyperdrive › Edit** to create or update the config.

## Per-request connections

The Worker opens one postgres.js client per `fetch` or `scheduled` invocation and closes it in `ctx.waitUntil`. A client cached at module level breaks on the second request with `Cannot perform I/O on behalf of a different request`. Hyperdrive makes the per-request connect cheap.

## Row level security

Supabase serves the `public` schema over PostgREST, so the anon key could read and write any table that has RLS turned off. The API connects as the table owner, which bypasses RLS. `migrate()` therefore ends by enabling RLS, with no policies, on every `public` table that lacks it. Tables added by later migrations get covered the next time `pnpm db:migrate` runs. Only add a policy if the browser really needs direct Supabase access, and none does today.

## Migrations before every API deploy

Deploy the API with `scripts/deploy-api.sh` (default config `apps/api/wrangler.deploy.toml`). It
runs `pnpm db:migrate`, then `pnpm db:pending` as a hard gate, then `wrangler deploy`, then checks
`/api/v1/health`. On 2026-10-18 the Worker for #54/#57 was deployed without `0020_reviews.sql`
and `0021_upvotes_ranking.sql`, and `/studio` answered 500 for every creator.

- `pnpm db:pending` lists repo migrations missing from `schema_migrations` and exits 1 if any.
  With `DATABASE_URL` it connects directly; without it, `SUPABASE_ACCESS_TOKEN` +
  `SUPABASE_PROJECT_REF` go through the Supabase Management API (one query per file, file and
  its `schema_migrations` row together).
- The Worker carries the list (`MIGRATIONS` in `packages/db/src/migrations-list.ts`, checked
  against the directory in CI). `/api/v1/health` answers `503 SCHEMA_BEHIND` and the ops check
  raises `SCHEMA_BEHIND` while production is behind; a query on a missing column answers
  `503 SCHEMA_BEHIND` instead of a bare 500.
- CI job `migrations applied live` runs `pnpm db:pending` against production after every merge
  to main.
- Every migration has its own 4-digit number (CI test). A file renamed after it was applied goes
  in `RENAMED_MIGRATIONS`; `migrate()` rewrites the old `schema_migrations` row instead of
  running the file again (`0011_profiles.sql` became `0013_profiles.sql`).
