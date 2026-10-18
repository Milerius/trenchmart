# Public status page

Status: probes, storage and the public endpoint `GET /api/v1/status` (the `/status` page follows).
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

## Public endpoint: `GET /api/v1/status`

Anonymous, `access-control-allow-origin: *`, edge-cached **60 s** (stale-while-revalidate 300 s,
shared by signed-in visitors; `EDGE_RULES` in `apps/api/src/edge-cache.ts`). One read of the three
status tables per minute per colo, whatever the traffic.

```jsonc
{
  "checkedAt": "2026-10-18T07:45:00.000Z", // newest probe, null before the first tick
  "generatedAt": "…",
  "cluster": "devnet",
  "overall": "operational", // operational | degraded | down | unknown (worst component)
  "intervalMinutes": 5,
  "windowDays": 90,
  "components": [
    {
      "id": "api",
      "name": "API",
      "state": "operational", // unknown when the newest probe is older than 20 min
      "checkedAt": "…",
      "latencyMs": 80,
      "p50Ms": 95,
      "p95Ms": 310, // last 24 h of probes
      "uptime90": 99.93, // % of probes not down over the days that have data; null if none
      "days": [
        { "date": "2026-07-21", "state": "none", "uptime": null, "samples": 0 },
        "… 90 days, oldest first",
      ],
    },
  ],
  "incidents": [
    {
      "id": 12,
      "component": "rpc",
      "componentName": "Solana RPC",
      "title": "Solana RPC unavailable",
      "impact": "major", // down = major, degraded = minor
      "status": "resolved",
      "startedAt": "…",
      "resolvedAt": "…",
      "durationMinutes": 15,
    },
  ],
}
```

- A day is `down` if any probe that day was down, `degraded` if any was degraded, `operational`
  otherwise, and `none` (grey) when there is no probe at all. Days before the first tick are
  `none`: the page never back-fills history it does not have.
- Incidents seen on a single tick are left out of the list (they still colour that day's bar);
  ongoing ones are always listed. Titles are fixed templates per component and state.
- Every field is built from an allowlist (`apps/api/src/status-public.ts`). It never reads
  `ops_alerts`, `ops_events` or env values, and `status-public.test.ts` fails if any other key, an
  alert code or message, a wallet, a URL or a secret appears in the body. The internal endpoints
  (`/internal/ops`, `/internal/ops/alerts`, `/internal/status/run`) still need `INTERNAL_TOKEN`.
