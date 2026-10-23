# API rate limits and abuse protection

Every limit has a Workers Rate Limiting binding in production (an edge counter, no database
write) and falls back to the Postgres `rate_buckets` table without one (local, CI). The
budgets live in `apps/api/src/limits.ts` (`LIMITS`) and must match the `[[ratelimits]]`
blocks in `apps/api/wrangler.toml` (devnet), `wrangler.mainnet.toml` and the local
`wrangler.deploy.toml`.

## Namespace ids

Rate Limiting namespaces are account-wide: two Workers that share an id share counters.
Devnet uses `1001` and `1101`–`1199`, mainnet `1002` and `1201`–`1299` (same last two digits per limit). Never reuse an id across Workers.

| Binding           | Devnet | Mainnet | Budget     | Key                | Used by                |
| ----------------- | ------ | ------- | ---------- | ------------------ | ---------------------- |
| `RATE_LIMITER`    | 1001   | 1002    | 120 / 60 s | client IP + method | every write (M-03)     |
| `TX_SEND_LIMITER` | 1101   | 1201    | 20 / 60 s  | signed-in wallet   | `POST /tx/send` (I-07) |

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

Read limits and per-route-group write limits (12xx namespaces): see [abuse-limits.md](abuse-limits.md).
