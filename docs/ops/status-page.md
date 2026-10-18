# Public status page

Status: probes and storage (this file grows with the public endpoint and the `/status` page).
Everything runs on the existing free tiers: no new service, no new cron, no new secret.

## Components

| id        | Shown as                  | Probe (every 5 min, API cron)                                                                                                                   | Slow above |
| --------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `web`     | Website                   | external watchdog push: `GET https://trenchmart.fun` (5xx or no answer = down)                                                                  | 2500 ms    |
| `api`     | API                       | external watchdog push: `GET https://api.trenchmart.fun/api/v1/health`                                                                          | 1500 ms    |
| `rpc`     | Solana RPC                | external watchdog push: `getHealth` on the RPC (429 counts as up)                                                                               | 2000 ms    |
| `escrow`  | Escrow program & resolver | read of the escrow program account from the API Worker                                                                                          | 2000 ms    |
| `db`      | Database                  | `select 1` through Hyperdrive, run before `auth` on the same connection pool                                                                    | 750 ms     |
| `uploads` | Uploads & scanning        | file storage write, read back, delete (`status/probe`)                                                                                          | 2500 ms    |
| `auth`    | Sign-in                   | timed insert of an already-expired nonce (`auth_nonces`, wallet `status-probe`), the same write as `POST /auth/nonce`; deleted after the timing | 1000 ms    |

A failed probe is **down**; a probe slower than its threshold is **degraded**. `db` and `auth` run
one after the other, and the nonce cleanup is outside the timing: run side by side with the cleanup
timed, sign-in read ~1.2 s (degraded) on every cron tick while the real `POST /auth/nonce` answered
in ~0.4 s. The ops alerts of
the same tick (`opsCheck`, docs/ops/monitoring.md) can then make a component worse, never better.
Only the component and the state cross over (`ALERT_COMPONENT` in `apps/api/src/status.ts`):

| Alert codes                                                                                                                | Component | At worst |
| -------------------------------------------------------------------------------------------------------------------------- | --------- | -------- |
| `DB_ERROR`                                                                                                                 | db        | down     |
| `SCHEMA_BEHIND`, `DB_POOL_FULL`                                                                                            | db        | degraded |
| `WEB_DOWN`                                                                                                                 | web       | degraded |
| `RPC_DOWN`                                                                                                                 | rpc       | degraded |
| `HTTP_5XX_SPIKE`                                                                                                           | api       | degraded |
| `R2_ERROR`, `SCAN_ERRORS`, `SCAN_STUCK`                                                                                    | uploads   | degraded |
| `RELEASE_STUCK`, `LOW_BALANCE`, `RESOLVER_MISCONFIGURED`, `UPGRADE_AUTHORITY_CHANGED`, `WEBHOOK_FAILED`, `CHECKOUT_PAUSED` | escrow    | degraded |

Disputes, payouts and every other internal code never touch the public page. Alert messages (which
can name wallets, balances, files and URLs) are never copied into the status tables.

Web, API and RPC are measured **outside** the API Worker. Every 5 minutes the watchdog Worker
(`apps/api/src/watchdog.ts`) runs its checks and pushes `{ name, ok, ms }` for each (never the
detail text) to `POST /api/v1/internal/status/external`, authenticated with its own secret
`STATUS_PUSH_TOKEN` (set on both Workers; it can do nothing else, and a blank, short or default
value keeps the route closed). The API applies any open ops alerts for those components (codes
only) and stores them as probes. If the API is unreachable the push fails and those minutes have
no data: they are not invented afterwards.

The API cannot pull these checks itself: when the API asks the watchdog (service binding), the
watchdog's fetch back to the API is a loop that Cloudflare refuses, so the API row read `down` on
every tick (seen live on 2026-10-18). Without `STATUS_PUSH_TOKEN` (local runs, CI) the API cron
probes the three URLs directly instead.

Set it up (once per environment, never printed):

```bash
token="$(openssl rand -hex 32)"
printf %s "$token" | wrangler secret put STATUS_PUSH_TOKEN -c apps/api/wrangler.deploy.toml
printf %s "$token" | wrangler secret put STATUS_PUSH_TOKEN -c apps/api/watchdog.wrangler.toml
```

## Storage (migration `0031_status.sql`)

- `status_probes`: one row per component per tick (`component`, `state`, `latency_ms`,
  `checked_at`), about 2,000 rows a day, kept **14 days**.
- `status_daily`: per UTC day and component: `samples`, `operational`, `degraded`, `down`,
  `p50_ms`, `p95_ms`. Yesterday and today are recomputed every tick; kept **100 days** (the page
  shows 90).
- `status_incidents`: opened on the first tick a component is not operational, `worst` escalates
  degraded to down, `resolved_at` is set on the first operational tick. At most one open incident
  per component (partial unique index).

All three tables have row level security on with no policies (only the API, as table owner, reads
them). A tick during a full database outage cannot be stored: those minutes show as fewer samples,
not as invented data.

## Operating it

- The cron step is `status` in `apps/api/src/worker.ts`, after `ops`. A failure is logged as
  `CRON_FAILED status: …` like any other step.
- Run one tick by hand (internal token, same as the cron):

  ```bash
  curl -X POST -H "authorization: Bearer $INTERNAL_TOKEN" \
    https://api.trenchmart.fun/api/v1/internal/status/run
  ```

- Thresholds live in `STATUS_COMPONENTS` (`apps/api/src/status.ts`).
