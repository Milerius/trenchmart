# 13 · Product decisions

These override the earlier human-review and download notes in docs/04–06.

- AI verification fully replaces human review. There is no verifier role, no review queue, and no human fallback.
- On upload, static checks and an isolated vm sandbox run immediately. `POST /studio/versions/:id/complete?stream=1` streams `static`, `sandbox`, `ai`, and `done` events. Versions are not parked for a batch worker.
- A signed download URL is issued only when the order status is `released`. `paid` and `disputed` return `403 ESCROW_LOCKED`.
- Dashboard amounts are lamports plus a USD equivalent. `GET /prices/sol` caches a CoinGecko SOL/USD quote for 60 seconds. `SOL_USD_OVERRIDE` pins a price without calling the network. If the source is down, the last cached price is kept. If there has never been a price, USD is null.
- `GET /stats` returns sample landing figures until at least one live listing exists, then switches to database totals. `LANDING_STATS=mock` forces the sample and `LANDING_STATS=real` forces the database, including zeros.
