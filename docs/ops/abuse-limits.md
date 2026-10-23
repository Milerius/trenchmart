# API abuse limits (reads and write route groups)

Edge counters on the API Worker (Cloudflare Workers Rate Limiting bindings): no database
write per request, counted per Cloudflare location. Code: `apps/api/src/abuse-limits.ts`,
numbers: `packages/shared/src/abuse-limits.ts` (also shown on /docs/agents and in llms-full.txt),
bindings: `apps/api/wrangler.toml` (a unit test keeps the three in sync).

| Binding          | Namespace   | Scope                                                                                                                                           | Key                         | Limit / 60 s |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------ |
| `READ_LIMITER`   | 1201 / 1311 | every GET/HEAD, edge-cache hits included (checked before the cache)                                                                             | IP                          | 600          |
| `AUTH_LIMITER`   | 1202 / 1312 | `/auth/*`, `/agent/auth/*` writes                                                                                                               | IP, and wallet if signed in | 20           |
| `TX_LIMITER`     | 1203 / 1313 | `/orders*`, `/tx/*`, `/agent/tx/*`, `/agent/orders/*`, `/supplements/*`, `/studio/bond*`, `/studio/featuring/bookings*`, version `fee`/`fee-tx` | IP and wallet               | 60           |
| `VERIFY_LIMITER` | 1204 / 1314 | `/verify`, `/verify/*` writes                                                                                                                   | IP and wallet               | 20           |
| `UPLOAD_LIMITER` | 1205 / 1315 | `PUT /files`, listing `images`/`content`/`versions`, `reupload`, `PUT /studio/profile`                                                          | IP and wallet               | 60           |

- IP is `CF-Connecting-IP`, or `x-tm-client-ip` when the web proxy sends the shared
  `PROXY_SECRET` (same rule as M-03). IPv6 is reduced to its /64; IPv4-mapped IPv6 to the IPv4.
- Group limits are additive: the general per-IP write limit (`RATE_LIMITER`, 1001, 120/min per
  method) and each API key's own `rateLimitPerMin` still apply. Namespace column is devnet / mainnet
  (`wrangler.mainnet.toml`); ranges in docs/ops/rate-limits.md.
- Refusals are `429 {"error":{"code":"RATE_LIMIT"}}` with `Retry-After: 60`.
- Without a binding (local dev, tests) the checks are skipped; the general limit falls back to
  Postgres as before.

## Legit flows fit

- Agent buy: quote, order, broadcast, submitted, download, release = 6 tx writes.
- Agent sell: content + images (with 480/960 copies) + version: about 26 upload writes for 8
  images; fee + fee-tx + broadcast + complete in tx.
- Sign-in: nonce + verify (browser) or challenge + key (agent) = 2 auth writes.
- Reads: the largest API key budget (300/min, reads included) fits under 600 per IP.

## Edge caching added with this change

`/openapi.json` is shared from the edge cache (5 min, SWR 1 day). The reward and payout feeds
were already cached.

## Tuning

Change the number in `packages/shared/src/abuse-limits.ts` and the matching `simple` block in
`apps/api/wrangler.toml`, `wrangler.mainnet.toml` (and the local `wrangler.deploy.toml`), then deploy. Periods must be
10 or 60 s (Cloudflare).
