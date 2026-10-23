# Edge protection and cost alerts (Cloudflare)

Zone `trenchmart.fun` (Free plan) and account settings that sit in front of the API Worker.
They are set in the Cloudflare dashboard/API, not in this repo; this page is the record.
The Worker's own limits ([abuse-limits.md](abuse-limits.md), [rate-limits.md](rate-limits.md))
stay the fine-grained ones; the edge rules are coarse backstops.

## Custom domain only

The devnet API Worker `trenchmart-api` answers only on `https://api.trenchmart.fun`.
`workers_dev` and `preview_urls` are off (`apps/api/wrangler.toml`), and
`scripts/deploy-api.sh` forces both off for any config named `trenchmart-api`, so an older
local `wrangler.deploy.toml` cannot turn the `*.workers.dev` URL back on. That URL would skip the
zone rules below.

Every caller already uses the custom domain: the web Worker (`API_URL` baked into the build),
the watchdog (`API_URL` in `apps/api/watchdog.wrangler.toml`), the box alert relay
(`/workspace/tm-alerts/check.sh`), the sandbox VPS, `deploy-api.sh` and the GitHub workflows.

The mainnet API Worker `trenchmart-api-mainnet` keeps workers.dev (no custom domain before
launch, preview URLs off) and still answers `MAINNET_REFUSED`.

## Zone rules

| Phase                             | Rule                      | What it does                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WAF custom rules                  | `tm_internal_bearer_only` | Blocks `api.trenchmart.fun/api/v1/internal/*` unless the request has an `Authorization: Bearer …` header and is `GET` or `POST`. The Worker still checks the token (`INTERNAL_TOKEN` or the watchdog's `STATUS_PUSH_TOKEN`); the rule only stops anonymous probing at the edge. |
| Rate limiting (the one Free rule) | `tm_api_v1_flood`         | Per IP and colo: more than 200 requests in 10 s to `api.trenchmart.fun/api/v1/*` → blocked for 10 s. Above the Worker's 600 reads/min per IP, so normal agents never hit it.                                                                                                    |

Callers of `/internal/*` and their auth: box relay (Bearer `INTERNAL_TOKEN`), watchdog
(Bearer `STATUS_PUSH_TOKEN`), sandbox VPS, `hyperdrive-limit` workflow and `deploy-api.sh`
(Bearer `INTERNAL_TOKEN`). A new internal caller must send a Bearer header.

## Bot Fight Mode: off on purpose

Free-plan Bot Fight Mode challenges automated clients zone-wide and cannot be skipped per
hostname or path by a WAF rule. API-key agents and SDK clients on `api.trenchmart.fun` are
automated by design and would be challenged (they cannot solve a JS challenge), so it stays off.
Revisit only with a plan that offers Super Bot Fight Mode with skip rules, or by moving the API
to its own zone.

## Cost alerts (account notifications, email to the owner)

| Policy                         | Type                                            | Threshold                                             |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| TrenchMart budget $7           | `billing_budget_alert`                          | monthly spend ≥ $7 (the auto-created $10 alert stays) |
| TrenchMart Workers requests 8M | `billing_usage_alert`, `worker_requests`        | 8M requests (Paid includes 10M/month)                 |
| TrenchMart Workers CPU 25M ms  | `billing_usage_alert`, `worker_standard_cpu_ms` | 25M CPU ms (Paid includes 30M/month)                  |

Hyperdrive has no billable usage product in Cloudflare's usage alerts (the API rejects every
Hyperdrive product id), so its cost is covered by the budget alert; its connection limit is
watched by the `hyperdrive-limit` workflow ([monitoring.md](monitoring.md)).
