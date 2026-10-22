# Mainnet launch runbook

Prepared 2026-10-22 (UTC+4). Everything below "Already done" exists and costs nothing; every
numbered step needs the owner (keys, SOL, DNS) and is run in order on launch day. Nothing
here has touched mainnet.

## Already done (no SOL, no DNS)

| Item                                        | Where                                                                                                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mainnet API Worker `trenchmart-api-mainnet` | `apps/api/wrangler.mainnet.toml`; `https://trenchmart-api-mainnet.trenchmart.workers.dev` (fails closed: `/api/v1/health` = 500 `MAINNET_REFUSED` while `MAINNET_LAUNCHED = "0"`)                                                                  |
| Mainnet database                            | Supabase project `trenchmart-mainnet` (`zydwvewzlgjbvqufxoxi`, free tier, ap-south-1), migrations applied; Hyperdrive `trenchmart-db-mainnet` (`0b1d60e34cc644eebfbd43371aba52e9`, limit 10). Box env: `~/.config/trenchmart/supabase-mainnet.env` |
| Bucket and queues                           | R2 `trenchmart-files-mainnet`; queues `rewards-send-mainnet`, `rewards-send-mainnet-dlq`, `scan-static-mainnet`                                                                                                                                    |
| API secrets (fresh, not shared with devnet) | `~/.config/trenchmart/mainnet/api-secrets.env`: SESSION_SECRET, INTERNAL_TOKEN, STATUS_PUSH_TOKEN, HELIUS_WEBHOOK_SECRET, AI_ATTEST_SECRET, PROXY_SECRET. Set on the Worker                                                                        |
| Money switches                              | `PAYOUTS_AUTO = "0"`, `REWARDS_AUTO = "0"`, no cron                                                                                                                                                                                                |
| Web Worker config                           | `apps/web/wrangler.jsonc` env `mainnet` (`trenchmart-web-mainnet`, workers.dev only). Not deployed: the web build refuses `NEXT_PUBLIC_CLUSTER=mainnet` until launch                                                                               |
| Watchdog config                             | `apps/api/watchdog.mainnet.wrangler.toml` (`trenchmart-watchdog-mainnet`), not deployed                                                                                                                                                            |
| Verified build                              | [verified-build.md](verified-build.md#mainnet-candidate): hash `124e1180…4a68a9`, 183,928 bytes                                                                                                                                                    |

## What the owner provides

- A private mainnet RPC URL (Helius or other): the API refuses mainnet without
  `SOLANA_RPC_URL`/`HELIUS_RPC_URL` and refuses `api.mainnet-beta.solana.com`.
- Mainnet keypairs: deployer (pays the deploy), 3 Squads members, resolver, crank fee payer.
- SOL: about 1.87 SOL peak for the deploy at `--max-len 183928`, 2.06 SOL at the recommended
  `--max-len 220000` (1.118 SOL stays locked), plus Squads creation rent, the config PDA and
  fee payers.
- The $MART mint and treasury/bucket wallet addresses.

## Launch day

Use a box shell with `set -a; . ~/.config/trenchmart/cf.env; set +a`. `URL` below is the
private mainnet RPC.

1. **Squads multisig.** Create a Squads v4 2-of-3 multisig on mainnet (app.squads.so or
   `@sqds/multisig`) with the three member keys. Record the multisig and vault PDA (index 0).
2. **Deploy the verified binary.** Download the `trench_escrow-verified-<sha>` artifact of the
   commit you deploy, check `solana-verify get-executable-hash trench_escrow.so` equals the hash
   in verified-build.md, then:
   ```bash
   solana program deploy trench_escrow.so -u "$URL" --keypair deployer.json \
     --program-id program-keypair.json --max-len 220000
   ```
3. **Upgrade authority to the Squads vault.**
   `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <VAULT_PDA> --skip-new-upgrade-authority-signer-check -u "$URL" --keypair deployer.json`
   Check `solana program show <PROGRAM_ID>` names the vault.
4. **`init_config`.** Run the program's `init_config` (resolver, 7-day dispute timeout) signed by
   the upgrade authority, i.e. as a Squads vault transaction. Confirm the config PDA.
5. **Spending limits.** In Squads, add the payout and rewards spending limits (amount, period,
   destination-free, member = the hot payout/rewards signer) per [payouts.md](payouts.md) and
   [holder-rewards.md](holder-rewards.md). Record their PDAs.
6. **Verify.** `solana-verify verify-from-repo` + `remote submit-job` (verified-build.md).
7. **Fill the configs** (PR): `apps/web/src/lib/cluster-mainnet.ts` (program, multisig, vault,
   mint, rewards vault/limit/wallet); `wrangler.mainnet.toml` vars (VAULT_ADDRESS,
   MULTISIG_ADDRESS, MART_MINT, BUCKET_WALLET_*, ESCROW_PROGRAM_ID, ESCROW_RESOLVER),
   `MAINNET_LAUNCHED = "1"`, `crons = ["*/5 * * * *"]`. Secrets:
   ```bash
   cd apps/api
   wrangler secret put HELIUS_RPC_URL -c wrangler.mainnet.toml        # private RPC
   wrangler secret put ESCROW_RESOLVER_SECRET -c wrangler.mainnet.toml
   TM_DEPLOY_DB_ENV=~/.config/trenchmart/supabase-mainnet.env \
     API_HEALTH_URL=https://trenchmart-api-mainnet.trenchmart.workers.dev/api/v1/health \
     ../../scripts/deploy-api.sh wrangler.mainnet.toml
   ```
   Health must be `{"ok":true,"cluster":"mainnet"}`. Leave PAYOUTS_AUTO/REWARDS_AUTO at 0 until
   a manual payout and a rewards dry run succeed.
8. **API hostname.** Attach custom domain `api.mainnet.trenchmart.fun` to
   `trenchmart-api-mainnet` (the web config already points there).
9. **Web.** Build and deploy the mainnet site:
   ```bash
   cd apps/web
   NEXT_PUBLIC_CLUSTER=mainnet NEXT_PUBLIC_MAINNET_LAUNCHED=1 \
     TM_API_URL=https://api.mainnet.trenchmart.fun pnpm build:cf
   wrangler secret put PROXY_SECRET --env mainnet   # value from mainnet/api-secrets.env
   npx opennextjs-cloudflare deploy -- --env mainnet
   ```
   Smoke-test `https://trenchmart-web-mainnet.trenchmart.workers.dev`.
10. **DNS move.** Move the `trenchmart.fun` custom domain from `trenchmart-web` to
    `trenchmart-web-mainnet`; keep `devnet.trenchmart.fun` on `trenchmart-web`. On the devnet
    API remove `trenchmart.fun` as its SIWS_DOMAIN (set `SIWS_DOMAIN=devnet.trenchmart.fun`,
    `APP_URL=https://devnet.trenchmart.fun`).
11. **Devnet rebuild** with `NEXT_PUBLIC_MAINNET_LAUNCHED=1` (still `NEXT_PUBLIC_CLUSTER=devnet`)
    so its pill links to mainnet; deploy `trenchmart-web` as usual.
12. **Monitoring.** `wrangler secret put RPC_URL` and `STATUS_PUSH_TOKEN` on
    `watchdog.mainnet.wrangler.toml`, then `wrangler deploy -c watchdog.mainnet.wrangler.toml`.
    Point a second assistant poller at mainnet:
    `TRENCHMART_CONFIG=~/.config/trenchmart/mainnet TM_API_URL=https://api.mainnet.trenchmart.fun TM_WATCHDOG_URL=https://trenchmart-watchdog-mainnet.trenchmart.workers.dev/ /workspace/tm-alerts/check.sh`
    (reads INTERNAL_TOKEN from `mainnet/api-secrets.env`). Add the mainnet API to
    `.github/workflows/health-check.yml`.
13. **e2e against mainnet**: `E2E_MART_MINT`, `E2E_ESCROW_PROGRAM_ID`, `E2E_MULTISIG` override
    the addresses the specs expect (`e2e/cluster-addresses.ts`).
