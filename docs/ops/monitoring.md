# Monitoring, alerts and runbooks

Status: live on devnet (2026-10-18). Everything here runs on free tiers. No paid service and no
third-party account is needed for the default setup.

## What runs

| Layer                 | Where                                                                                                            | Covers                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **API ops check**     | `apps/api/src/ops.ts`, every 5 min in the API cron (`*/5`), and `GET /internal/ops`                              | RPC, web uptime, R2, DB, hot-wallet balances, upgrade authority, business and safety signals (table below)                                      |
| **External watchdog** | separate Worker `trenchmart-watchdog` (`apps/api/src/watchdog.ts`, `watchdog.wrangler.toml`), its own 5 min cron | web, API `/api/v1/health` and Solana RPC, checked from outside the API Worker, so an API outage still pages                                     |
| **Error tracking**    | Workers Logs (`[observability] enabled` on both Workers) plus the `ops_events` table                             | every unhandled API error (`console.error` stack in Workers Logs, `5xx` row in `ops_events`); webhook, scan and R2 errors are tagged separately |
| **Status dashboard**  | `https://trenchmart.fun/admin/status` (admin wallets only, `GET /admin/ops`)                                     | current checks, firing alerts, delivery channels, error counts for 24 h, alert history                                                          |

### Alert delivery

Alerts go to every configured channel:

- **ntfy push (default, free, no signup), live now.** Both Workers post to a secret ntfy.sh topic (`ALERT_NTFY_TOPIC`, in `~/.config/trenchmart/alerts.env` on the ops box). Treat it as a secret: anyone who knows the topic can read the alerts. To get push on a phone, install the ntfy app and subscribe to the topic.
- **Email to rmscastle@gmail.com: needs one free signup by Roman.** ntfy.sh refuses anonymous email (error 40053). Steps:
  1. Create a free account at https://ntfy.sh/signup.
  2. Create an access token under Account → Access tokens.
  3. Run `wrangler secret put ALERT_NTFY_TOKEN` on the API Worker, and on the watchdog with `-c watchdog.wrangler.toml`.

  `ALERT_EMAIL` is already set. Until the token exists, alerts are sent as push only. If ntfy refuses the email, the alert falls back to push, so nothing is lost.

- **Telegram (optional).** Create a bot with @BotFather, send it one message, and read the chat id from `https://api.telegram.org/bot<token>/getUpdates`. Then run `wrangler secret put TELEGRAM_BOT_TOKEN` and `wrangler secret put TELEGRAM_CHAT_ID` on the API Worker. For the watchdog, add `-c watchdog.wrangler.toml`.
- **Generic webhook (optional).** Set `ALERT_WEBHOOK_URL`; it receives a JSON POST `{title, text, level}`.

How often an alert is sent:

- The API side keeps state in `ops_alerts`. An alert is sent **once when it opens**, **again every 6 h while it stays open**, and **once when it resolves**.
- The watchdog is stateless. It reads its own recent messages back from the ntfy topic, sends DOWN once per target, and sends UP once on recovery.
- If the DB itself is down, every alert is sent on every run without dedup, so you may get a notice every 5 min until the DB is back.

Test delivery at any time:

```bash
curl -X POST -H "authorization: Bearer $INTERNAL_TOKEN" "https://api.trenchmart.fun/api/v1/internal/ops/test?code=LOW_BALANCE"
# → {"channels":["ntfy"]}  (ntfy also relays the email)
curl -X POST -H "authorization: Bearer $INTERNAL_TOKEN" https://api.trenchmart.fun/api/v1/internal/ops/run   # real check + delivery
curl https://trenchmart-watchdog.<account>.workers.dev/   # watchdog's live check results
```

## Alerts and runbooks

Each heading below matches an alert code. _Critical_ means money or availability is at risk:
act now. _Warn_ means look at it today.

### DB_ERROR

Critical. A database query in the ops check failed.

1. Check the Supabase status page and the project dashboard (paused project, connection limit).
2. Search Workers Logs for `ALERT` and `PostgresError`.
3. Checkout and releases need the DB. If the outage lasts, turn on the kill switch: set `CHECKOUT_PAUSED=1` as a Worker var and deploy, or set `checkout_paused` in the config table if the DB answers intermittently.
4. Funds are safe while the DB is down: they sit in escrow PDAs, and buyers can always call `refund_after_timeout` on chain.

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

## Verified on devnet (2026-10-18)

See the PR description for the run log: each code was fired once against the live devnet deployment, through the real delivery path.
