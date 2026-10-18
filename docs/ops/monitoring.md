# Monitoring, alerts and runbooks

Status: live on devnet (2026-10-18). Everything here runs on free tiers. No paid service and no
third-party account is needed for the default setup.

## What runs

| Layer                 | Where                                                                                                            | Covers                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API ops check**     | `apps/api/src/ops.ts`, every 5 min in the API cron (`*/5`), and `GET /internal/ops`                              | RPC, web uptime, R2, DB, hot-wallet balances, upgrade authority, business and safety signals (table below)                                                                                                 |
| **External watchdog** | separate Worker `trenchmart-watchdog` (`apps/api/src/watchdog.ts`, `watchdog.wrangler.toml`), its own 5 min cron | web, API `/api/v1/health` and Solana RPC, checked from outside the API Worker, so an API outage still surfaces                                                                                             |
| **Error tracking**    | Workers Logs (`[observability] enabled` on both Workers) plus the `ops_events` table                             | every unhandled API error (`console.error` stack in Workers Logs, `5xx` row in `ops_events`); webhook, scan and R2 errors are tagged separately                                                            |
| **Status dashboard**  | `https://trenchmart.fun/admin/status` (admin wallets only, `GET /admin/ops`)                                     | current checks, firing alerts, delivery = assistant, error counts for 24 h, alert history                                                                                                                  |
| **Status probes**     | `apps/api/src/status.ts`, the `status` step of the API cron (`*/5`), `POST /internal/status/run`                 | one timed probe per public component (web, API, RPC via the watchdog; escrow, DB, uploads, sign-in from the API) into `status_probes`, incidents and a daily roll-up; see [status-page.md](status-page.md) |
| **Assistant poller**  | box script `/workspace/tm-alerts/check.sh` every 10 min                                                          | open + resolved from `GET /api/v1/internal/ops/alerts` (Bearer `INTERNAL_TOKEN`) plus watchdog `GET /`                                                                                                     |

### Alert delivery

**Chat only (owner decision, 2026-10-18).** There is no ntfy, email, Telegram, or webhook push.
Roman's assistant polls every **10 minutes**, reads open/resolved alert state, and relays anything
new in chat. The Workers still run the checks and persist state; they just do not push.

How the assistant reads state (no secrets printed by the helper script):

1. **Preferred:** `GET https://api.trenchmart.fun/api/v1/internal/ops/alerts` with
   `Authorization: Bearer $INTERNAL_TOKEN` (token file:
   `~/.config/trenchmart/internal-token`, also in `api-secrets.env`). Returns JSON
   `{ checkedAt, ok, live, open, resolved, delivery: "assistant" }`.
2. **Admin UI / wallet session:** `GET /api/v1/admin/ops` (same payload as `/admin/status`).
3. **DB:** `ops_alerts` via `~/.config/trenchmart/sbq.sh` (Supabase Management API).
4. **Watchdog:** `GET https://trenchmart-watchdog.trenchmart.workers.dev/` →
   `{ ok, checks: [{name, ok, detail}] }`.

On the ops box, run `/workspace/tm-alerts/check.sh` — it calls (1) and (4) and prints one JSON
object. Schedule it every 10 min from the assistant.

How often state changes:

- The API cron keeps state in `ops_alerts`. A row opens **once**, is refreshed every **6 h** while
  still firing (`notified_at`), and gets `resolved_at` when it clears.
- The watchdog is stateless: each cron tick logs `ALERT {...}` for failing targets; the poller
  sees current `checks` on `GET /`.
- If the DB itself is down, `/internal/ops` still returns live probe failures; `ops_alerts` rows
  cannot update until the DB is back.

Manual check (same as the script):

```bash
curl -sS -H "authorization: Bearer $INTERNAL_TOKEN" \
  https://api.trenchmart.fun/api/v1/internal/ops/alerts
curl -sS https://trenchmart-watchdog.trenchmart.workers.dev/
# Optional: force a check + persist notices (still no push):
curl -X POST -H "authorization: Bearer $INTERNAL_TOKEN" \
  https://api.trenchmart.fun/api/v1/internal/ops/run
```

`ALERT_NTFY_*`, `TELEGRAM_*`, and `ALERT_WEBHOOK_URL` are ignored if set. Leave them unset.

## Alerts and runbooks

Each heading below matches an alert code. _Critical_ means money or availability is at risk:
act now. _Warn_ means look at it today.

### DB_ERROR

Critical. A database query in the ops check failed.

1. Check the Supabase status page and the project dashboard (paused project, connection limit).
2. Search Workers Logs for `ALERT` and `PostgresError`.
3. Checkout and releases need the DB. If the outage lasts, turn on the kill switch: set `CHECKOUT_PAUSED=1` as a Worker var and deploy, or set `checkout_paused` in the config table if the DB answers intermittently.
4. Funds are safe while the DB is down: they sit in escrow PDAs, and buyers can always call `refund_after_timeout` on chain.

### SCHEMA_BEHIND

Critical. The deployed API expects a migration that production has not applied, so every query
touching the new tables or columns fails (API answers `503 SCHEMA_BEHIND`; Workers Logs show
`PostgresError: column ... does not exist`). Happened on 2026-10-18: `0020_reviews.sql` and
`0021_upvotes_ranking.sql` shipped with #54/#57 but were never applied, and `/studio` broke for
every creator.

1. Read the alert: it names the missing files (the release's `MIGRATIONS` list minus `schema_migrations`).
2. Apply them: `pnpm db:migrate` with the production `DATABASE_URL` (or run each file and its
   `insert into schema_migrations` in one query through the Supabase SQL API). Every migration is
   idempotent (`if not exists`).
3. Always migrate before `wrangler deploy` when a PR adds a file under `packages/db/migrations`.

### R2_ERROR

Critical. The file storage probe (write, read, delete `ops/probe`) failed, or API requests hit storage errors.

- Check the Cloudflare status page (R2) and the bucket binding `FILES` in `wrangler.deploy.toml`.
- Downloads and uploads fail while this fires. Releases and refunds keep working.

### RPC_DOWN / rpc_down

Critical. Solana RPC `getHealth` failed, or a balance read failed.

- Check the provider. Switch with `SOLANA_RPC_URL` (or `HELIUS_RPC_URL`) and redeploy.
- Releases retry on the next cron tick after the RPC recovers.

### WEB_DOWN / web_down

Critical. `https://trenchmart.fun` returned 5xx or did not answer.

- Check the web Worker's logs (`wrangler tail trenchmart-web`).
- Roll back with `wrangler rollback` on the web Worker.

### api_down

Critical (watchdog only). `https://api.trenchmart.fun/api/v1/health` failed from outside.

- Run `wrangler tail trenchmart-api`, then `wrangler deployments list` and `wrangler rollback` to the last good version.
- While the API is down, its own cron alerts stop too. That is why the watchdog exists.

### LOW_BALANCE

Critical. The escrow resolver or the crank (the fee payer for release, close and refund) holds less than 0.05 SOL.

- Top up the named address from the owner wallet: 0.5 SOL is a few thousand transactions.
- Releases fail once the fee payer is empty.

### RESOLVER_MISCONFIGURED

Critical. `ESCROW_RESOLVER` does not match `ESCROW_RESOLVER_SECRET`, or neither is set.

- Fix the secret. Rotation steps are in `docs/security/escrow-review.md` (M-02).

### UPGRADE_AUTHORITY_CHANGED

Critical. The escrow program's upgrade authority differs from `EXPECTED_UPGRADE_AUTHORITY`.

- If you did not change it on purpose, treat this as a key compromise:
  1. Pause checkout.
  2. Check the program's transaction history on an explorer.
  3. Warn users. Buyers can still use `refund_after_timeout` unless the program code was replaced.
- If you changed it on purpose, update the `EXPECTED_UPGRADE_AUTHORITY` var.

### RELEASE_STUCK

Critical. A paid order is more than 15 min past its escrow window and has not been released.

- Check Workers Logs for `CRON_FAILED release`, and check `LOW_BALANCE`.
- Run it by hand: `POST /internal/cron/release` with the internal token.

### CRON_FAILED

Critical. A cron step (expire, release, payouts, escrow-housekeeping, ops) threw an error.

- The message names the step. The next step still runs, and the step retries on the next tick.
- Repeated failures mean something is persistently wrong: start with `RPC_DOWN`, `DB_ERROR` and `LOW_BALANCE`.

### WEBHOOK_FAILED

Critical. The Helius payment webhook (`/hooks/helius`) returned 5xx, so payments may not be credited.

- Check the Helius dashboard delivery log and Workers Logs.
- Payments are not lost. Buyers can press "I paid" (the `/submitted` endpoints), which re-reads the transaction on chain.

### SCAN_ERRORS / SCAN_STUCK

Warn. The upload review pipeline threw an error, or a version has been `scanning` for more than 30 min.

- Check the ClamAV and sandbox runner URLs and the model API key.
- To retry, the creator re-submits, or an admin calls `/internal/sandbox/:id/result`.

### HTTP_5XX_SPIKE

Critical. 10 or more API 5xx errors in 15 min.

- Search Workers Logs for the stack traces. Use `ops_events.detail` for the paths.
- If a recent deploy caused it, roll back with `wrangler rollback`.

### DB_POOL_FULL

Critical. In the last 15 min, an API request failed with `EMAXCONNSESSION max clients reached in session mode` from the Supabase pooler.

- Hyperdrive (`trenchmart-db`) reaches Supabase through the session pooler, which allows 15 clients in total. Its `origin_connection_limit` must stay well below that. `scripts/deploy-api.sh` sets it to 10 on every deploy, and the hourly `hyperdrive-limit` workflow reports it (see HYPERDRIVE_LIMIT).
- Check it with `wrangler hyperdrive get <id>`. Fix it with `wrangler hyperdrive update <id> --origin-connection-limit 10`.
- If the limit is fine, look for another client holding pooler connections: `select application_name, count(*) from pg_stat_activity group by 1`.

### HYPERDRIVE_LIMIT

The Worker has no Cloudflare API token, so the Hyperdrive config is read from outside: the hourly `hyperdrive-limit` workflow and `scripts/deploy-api.sh` (when `INTERNAL_TOKEN` is set) POST what they read to `/internal/ops/hyperdrive`. The ops check looks at the latest report:

- Critical: `origin_connection_limit` is above 10. The Supabase session pooler allows 15, and at 20 requests failed with DB_POOL_FULL. Fix it with `wrangler hyperdrive update 067fbd6cc9a949e7a62155bf3fd2fe91 --origin-connection-limit 10`, or redeploy the API.
- Warn: the limit could not be read or is unset. The message carries the reason, for example missing workflow secrets or a Cloudflare API error.
- Warn: no report for 3 h, so the workflow is not running or cannot reach the API (check `TM_INTERNAL_TOKEN`).

The workflow does not fail on drift, because a failed scheduled run emails the owner, and alerts go to the assistant chat through `/internal/ops/alerts`.

### DISPUTE_SPIKE

Critical. 5 or more disputes in 1 hour. This may be a malicious listing or a broken release.

- Look at `/admin`. Delist the listing if the disputes point to one listing.
- Pause checkout if the cause is unclear.

### DISPUTES_WAITING

Warn. A dispute has been open for more than 24 h. After 7 days the on-chain timeout refunds the buyer automatically, so resolve it before then.

### PAYOUTS_WAITING

Warn. Vault payout lines have been waiting more than 48 h for the vault signature. Sign the batch in Squads.

### CHECKOUT_PAUSED

Warn. The kill switch is on, which is a reminder in case someone left it on.

### Recovery

Resolved and UP notices need no action.

## Verified on devnet (2026-10-18, live deployment)

All times are 2026-10-18 UTC+4 (Dubai).

- **Detection, end to end.** Rows for each error kind were inserted into `ops_events`, then `POST /internal/ops/run` was called.
  - At 07:01:52 the live API raised `CRON_FAILED`, `WEBHOOK_FAILED`, `SCAN_ERRORS`, `R2_ERROR` and `HTTP_5XX_SPIKE`, and wrote them to `ops_alerts`.
  - After the rows were deleted, the next run at 07:02:04 produced `RESOLVED …` for all five.
- **Healthy baseline.** `GET /internal/ops` → `{"ok":true,"alerts":[]}`. This is the real live state: RPC, web and R2 probes pass, the resolver and crank hold more than 0.05 SOL, the upgrade authority equals the vault `47RLqPda…`, and no order is stuck.
- **Every other code** (DB, RPC, web, low balance, resolver, upgrade authority, stuck release, scan stuck, disputes, payouts, kill switch) fires and resolves in `apps/api/src/ops.test.ts` against real Postgres with stubbed chain and HTTP. That file also tests the dedup, the 6 h re-send, resolve notices, and retry after failed delivery.
- **Watchdog.** Live at `https://trenchmart-watchdog.trenchmart.workers.dev/` with a `*/5` cron. It reports web and API ok. Its DOWN-once and UP-once logic is tested in `watchdog.test.ts`.
- **Delivery: blocked on the ntfy token** (see above). Every live test notice returned `channels: []` because of the ntfy 429 quota. Once `ALERT_NTFY_TOKEN` is set, run `POST /internal/ops/test?code=DELIVERY` and expect `{"channels":["ntfy"]}`.
