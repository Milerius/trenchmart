# API rate limits and abuse protection

Every limit has a Workers Rate Limiting binding in production (an edge counter, no database
write) and falls back to the Postgres `rate_buckets` table without one (local, CI). The
budgets live in `apps/api/src/limits.ts` (`LIMITS`) and must match the `[[ratelimits]]`
blocks in `apps/api/wrangler.toml` (devnet), `wrangler.mainnet.toml` and the local
`wrangler.deploy.toml`.

## Namespace ids

Rate Limiting namespaces are account-wide: two Workers that share an id share counters.
Devnet uses `1001`, `1101`–`1199` (this file) and `1201`–`1299` (read and route-group
limits, [abuse-limits.md](abuse-limits.md)); mainnet uses `1002` and `1301`–`1399` for the
limits below (same last two digits). Never reuse an id across Workers.

| Binding                        | Devnet    | Mainnet   | Budget                      | Key                  | Used by                                           |
| ------------------------------ | --------- | --------- | --------------------------- | -------------------- | ------------------------------------------------- |
| `RATE_LIMITER`                 | 1001      | 1002      | 120 / 60 s                  | client IP + method   | every write (M-03)                                |
| `TX_SEND_LIMITER`              | 1101      | 1301      | 20 / 60 s                   | signed-in wallet     | `POST /tx/send` (I-07)                            |
| `API_KEY_IP_LIMITER`           | 1102      | 1302      | 600 / 60 s                  | client IP (IPv6 /64) | API-key requests, before the key lookup           |
| `API_KEY_WALLET_LIMITER`       | 1103      | 1303      | 600 / 60 s                  | key owner (user id)  | all of a wallet's keys together                   |
| `KEY_RATE_10` … `KEY_RATE_300` | 1104–1108 | 1304–1308 | 10, 30, 60, 120, 300 / 60 s | API key id           | per-key `rateLimitPerMin` tiers                   |
| `AUTH_NONCE_LIMITER`           | 1110      | 1210      | 20 / 60 s                   | client IP (/64)      | `POST /auth/nonce` (abuse limits, docs/04-api.md) |
| `READ_LIMITER`                 | 1201      | 1311      | 600 / 60 s                  | client IP (/64)      | every GET, cache hits included (abuse-limits.md)  |
| `AUTH_LIMITER`                 | 1202      | 1312      | 20 / 60 s                   | IP (/64) + wallet    | auth writes (abuse-limits.md)                     |
| `TX_LIMITER`                   | 1203      | 1313      | 60 / 60 s                   | IP (/64) + wallet    | tx writes (abuse-limits.md)                       |
| `VERIFY_LIMITER`               | 1204      | 1314      | 20 / 60 s                   | IP (/64) + wallet    | /verify writes (abuse-limits.md)                  |
| `UPLOAD_LIMITER`               | 1205      | 1315      | 60 / 60 s                   | IP (/64) + wallet    | upload writes (abuse-limits.md)                   |

IPv6 clients are keyed by their /64 (`ipKey` in limits.ts), because one host rotates freely
inside it. This applies to the global write limiter (`RATE_LIMITER` and the Postgres
`rate_buckets` fallback): the key is `ipKey(clientIp) + ":" + method`.

## `POST /tx/send` (I-07)

The browser relay forwards a signed transaction only when it is:

- signed by exactly one signer, the session wallet (fee payer), with a valid signature;
- made of instructions to the marketplace programs only (escrow, system, memo, compute
  budget); and
- byte-identical to a message the API issued to that wallet in the last few minutes
  (`issued_txs`, the same check as `POST /agent/tx/broadcast`), **or** made only of
  TrenchMart escrow program instructions (plus compute budget), for wallets that rewrite
  the message before signing. The program enforces its own signer and state rules.

Once the RPC accepts a transaction, the response is always its signature. Recording it in
`issued_txs.broadcast_sig` is bookkeeping (`recordBroadcast` in agent.ts, shared with
`POST /agent/tx/broadcast`): one retry, then a `broadcast_sig not recorded` log line, never a
500, so a client is never told an accepted payment failed and tempted to pay again.

Anything else answers 400 (`NOT_ISSUED`, `FOREIGN_PROGRAM`, `WRONG_SIGNER`,
`BAD_SIGNATURE`, `BAD_TX`) before the RPC is called. Each wallet may call it 20 times a
minute (429 `RATE_LIMIT`), counted before validation so refused attempts cost budget too.

Read limits and per-route-group write limits (devnet 12xx namespaces): see [abuse-limits.md](abuse-limits.md).

## API keys (`Authorization: Bearer tmk_…`)

Checked in this order, cheapest first:

1. **Per IP** (`API_KEY_IP_LIMITER`, 600/min, IPv6 per /64) before the key is hashed or looked
   up, so a flood of made-up `tmk_` keys never reaches Postgres.
2. Scope map (deny by default), then the key lookup. The lookup is one statement that also
   counts the request against the key's **daily quota** (`api_keys.daily_quota`, default
   10 000 per UTC day, `daily_count`/`daily_day`) and touches `last_used_at`.
3. **Per key** (`rateLimitPerMin`): a binding keyed by key id. A binding has one fixed limit,
   so a key uses the largest tier not above its own rate (a 50/min key gets 30/min, never
   more). Keys below 10/min, and every key without bindings, use the exact Postgres window.
   `X-RateLimit-Remaining` is sent only when the Postgres window knows it.
4. **Per wallet** (`API_KEY_WALLET_LIMITER`, 600/min) across all of the owner's keys.
5. Daily quota: past it, `429 DAILY_QUOTA` with `Retry-After` to 00:00 UTC. Headers:
   `X-Quota-Limit`, `X-Quota-Remaining`. Raise one key's quota with
   `update api_keys set daily_quota = … where id = …` (1 to 1 000 000).

## Cleanup

The 5-minute cron (`rate-buckets` step) deletes `rate_buckets` windows older than a day
(`pruneRateBuckets`, index `rate_buckets_window_idx`).
