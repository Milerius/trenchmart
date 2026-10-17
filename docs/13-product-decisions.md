# 13 · Product decisions

These override the earlier human-review and download notes in docs/04–06.

- AI verification fully replaces human review. There is no verifier role, no review queue, and no human fallback.
- On upload, static checks and the sandbox start together. `POST /studio/versions/:id/complete?stream=1` and `POST /studio/versions/:id/review?stream=1` stream `static`, `sandbox`, `ai`, and `done` events with `durationMs` and the sandbox log. A configured `SANDBOX_RUNNER_URL` receives one webhook immediately. There is no 10-second poll and no 3-minute page visit. Each sandbox run is capped at 10–20 seconds (`SANDBOX_BUDGET_MS`, default 15000) with network egress blocked.
- Outcomes are `live` (approved), `needs_creator` (changes requested, `resume_step` so a later review of the same bytes skips earlier passing steps), or `rejected` with `reason`. `POST /studio/versions/:id/appeal` is 404. A new file drops the cached static scan so the new bytes are checked, then the sandbox is dispatched again immediately.
- A signed download URL is issued only when the order status is `released`. `paid` and `disputed` return `403 ESCROW_LOCKED`.
- Dashboard amounts are lamports plus a USD equivalent. `GET /prices/sol` caches a CoinGecko SOL/USD quote for 60 seconds. `SOL_USD_OVERRIDE` pins a price without calling the network. If the source is down, the last cached price is kept. If there has never been a price, USD is null.
- `GET /stats` returns sample landing figures until at least one live listing exists, then switches to database totals. `LANDING_STATS=mock` forces the sample and `LANDING_STATS=real` forces the database, including zeros.
