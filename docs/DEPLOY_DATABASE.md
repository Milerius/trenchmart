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
id = "<id printed by the create command>"
```

The API token needs **Account › Hyperdrive › Edit**.

## Per-request connections

The Worker opens one postgres.js client per `fetch` or `scheduled` invocation and closes it in `ctx.waitUntil`. A client cached at module level breaks on the second request with `Cannot perform I/O on behalf of a different request`. Hyperdrive makes the per-request connect cheap.

## Row level security

Supabase serves the `public` schema over PostgREST, so the anon key could read and write any table that has RLS turned off. The API connects as the table owner, which bypasses RLS. `migrate()` therefore ends by enabling RLS, with no policies, on every `public` table that lacks it. Tables added by later migrations get covered the next time `pnpm db:migrate` runs. Only add a policy if the browser really needs direct Supabase access, and none does today.
