# Networks: Devnet and Mainnet

TrenchMart runs one deployment per Solana cluster, each on its own hostname. The header pill
(Devnet | Mainnet, left of the wallet button; first row of the mobile menu below 640 px)
switches between them by opening the other hostname's home page: listings, orders and
sessions are separate per cluster, so a path on one does not exist on the other.

The pill and its menu are server-rendered HTML (`components/network-switch.tsx`, a
`<details>` element), so they add no client JS; the header only closes an open menu on an
outside click or Escape. From `xl` both segments show; between `sm` and `xl` only the active
one.

| Cluster | Site                                                                                              | API (proxied same-origin at `/api/v1`)                                                                          | Status        |
| ------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| Devnet  | `https://devnet.trenchmart.fun` and, until mainnet launches, `https://trenchmart.fun`             | `https://api.trenchmart.fun`                                                                                    | live          |
| Mainnet | `https://trenchmart.fun` (after launch); Worker `trenchmart-web-mainnet` configured, not deployed | `https://api.mainnet.trenchmart.fun` (custom domain, live but fails closed with `MAINNET_REFUSED` until launch) | "Coming soon" |

Until launch, `trenchmart.fun` and `devnet.trenchmart.fun` are the same Worker
(`trenchmart-web`, two Cloudflare custom domains). No redirect between them: every existing
link keeps working, and sessions are per hostname (host-only cookie).

## One cluster config

Everything that differs per cluster is in `apps/web/src/lib/`, joined by `clusters.ts`:

- `cluster-devnet.ts`, `cluster-mainnet.ts`: chain id, escrow program id, multisig, vault,
  $MART mint, explorer/Solscan `?cluster=` value.
- `cluster-endpoints.ts`: site origin, API base, RPC, Squads program, note.
- `cluster.ts`: `CLUSTER` (this build's cluster; the other one is dropped from the bundle),
  explorer/Solscan link helpers, `chainMismatch`.

`protocol-facts.ts`, `payouts-data.ts` (Solscan links), `wallet-detect.ts` (signing chain),
`agent-docs.ts` (API base) and `/.well-known/trenchmart.json` (RPC) read it. The two files are
split only to keep endpoints out of the home JS budget.

Build-time switches (baked into the bundle, public):

| Variable                       | Default  | Meaning                                                                      |
| ------------------------------ | -------- | ---------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CLUSTER`          | `devnet` | Cluster this build serves. `mainnet` is refused unless the next flag is set. |
| `NEXT_PUBLIC_MAINNET_LAUNCHED` | off      | `1` makes Mainnet selectable in the pill and allows a mainnet build.         |

The API names the page's host in the sign-in message when it is listed in
`SIWS_EXTRA_DOMAINS` (comma separated, e.g. `devnet.trenchmart.fun`); the web proxy sends the
host as `x-tm-site-host`. Anything not listed falls back to `SIWS_DOMAIN`. Wallets refuse a
sign-in whose domain differs from the page, so a new hostname must be added there.

## Wallet on the wrong cluster

If the connected Wallet Standard account lists Solana chains and none is this site's cluster,
`wallet-detect.ts` sets `<html data-cluster-mismatch>`, which shows the amber banner
(`components/cluster-mismatch.tsx`, server-rendered), and the signer refuses every
transaction, so no payment can be signed on the wrong network. Wallets that list every chain (Phantom does) cannot be told apart this way: Wallet
Standard does not expose the selected network, so the existing devnet hint on a rejected
transaction and the server's own checks still apply.

## Mainnet RPC

The API has no public mainnet fallback. With `SOLANA_CLUSTER=mainnet` it starts only when
`MAINNET_LAUNCHED=1` and `SOLANA_RPC_URL` or `HELIUS_RPC_URL` is set (https, not
`api.mainnet-beta.solana.com`, which cannot serve the holder-rewards `getProgramAccounts`).
Before launch `/api/v1/health` answers 500 `MAINNET_REFUSED`; launched without a private RPC
it answers 503 `MAINNET_RPC_REQUIRED` (`resolveRpc` in `packages/shared/src/cluster.ts`).

## RPC provider

Both API Workers use Helius as their Solana RPC. The URL (with its API key) is a Worker
secret, never committed: devnet `trenchmart-api` reads `SOLANA_RPC_URL` =
`https://devnet.helius-rpc.com/?api-key=…`, mainnet `trenchmart-api-mainnet` reads
`HELIUS_RPC_URL` = `https://mainnet.helius-rpc.com/?api-key=…`. The key itself lives on the box in
`~/.config/trenchmart/helius.env` (chmod 600). To rotate, `wrangler secret put` the new URL; no
code deploy is needed.

## Watchdog RPC check (Helius first, public fallback)

Both watchdog Workers (`src/watchdog.ts`, `checkRpc`) call `getHealth` on Helius first and fall
back to a public RPC automatically when Helius errors, answers unhealthy, or does not answer within
4 s (`PRIMARY_RPC_TIMEOUT_MS`). The RPC check is healthy if either answers; it is down (and logs
`ALERT`) only when both fail. The reported latency is the answering provider's, so a Helius timeout
followed by a fast fallback does not read as a slow RPC. The timeout covers the whole call
(headers and body), so a provider that sends headers and stalls the body still falls back. A
down RPC check carries no provider (none answered), so the status page never shows "via ..." next
to a down RPC.

| Watchdog                      | Primary (Worker secret)                                        | Public fallback (`RPC_URL` var)                  |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `trenchmart-watchdog`         | `HELIUS_RPC_URL` = `https://devnet.helius-rpc.com/?api-key=…`  | `https://solana-devnet.api.onfinality.io/public` |
| `trenchmart-watchdog-mainnet` | `HELIUS_RPC_URL` = `https://mainnet.helius-rpc.com/?api-key=…` | `https://solana-rpc.publicnode.com`              |

Set the secret without echoing it (the key never goes in a toml, a commit, a log or a chat):

```sh
source ~/.config/trenchmart/helius.env   # never cat/echo it
printf '%s' "https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" |
  wrangler secret put HELIUS_RPC_URL -c apps/api/watchdog.wrangler.toml
```

(mainnet: same with `mainnet.helius-rpc.com` and `-c apps/api/watchdog.mainnet.wrangler.toml`, at
launch; delete any older `RPC_URL` secret there first, since a secret shadows the public var).
Without `HELIUS_RPC_URL` the watchdog checks the public RPC alone.

The watchdog pushes which provider answered (`provider: "helius" | "public"`, rpc check only, never
a URL) with its checks; the API stores it in `status_probes.provider` (migration 0043) and
`GET /api/v1/status` serves it on the `rpc` component. The public `/status` page shows it under
Solana RPC as "via Helius" or "via Public fallback". The watchdog's own `GET /` detail says the
same (e.g. `ok (public fallback; Helius timeout)`), with no URL or key. Failure details only ever
hold `timeout`, `unreachable` or the HTTP status, never the error message, which could echo the
request URL.

## Mainnet resources

| Piece         | Devnet                                                      | Mainnet                                                                   |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| API Worker    | `trenchmart-api` (`wrangler.deploy.toml`)                   | `trenchmart-api-mainnet` (`apps/api/wrangler.mainnet.toml`)               |
| Web Worker    | `trenchmart-web`                                            | `trenchmart-web-mainnet` (`apps/web/wrangler.jsonc` env `mainnet`)        |
| Watchdog      | `trenchmart-watchdog`                                       | `trenchmart-watchdog-mainnet` (`watchdog.mainnet.wrangler.toml`)          |
| Database      | Supabase `loxyhdllgazypqceftpj`, Hyperdrive `trenchmart-db` | Supabase `zydwvewzlgjbvqufxoxi`, Hyperdrive `trenchmart-db-mainnet`       |
| Files         | R2 `trenchmart-files`                                       | R2 `trenchmart-files-mainnet`                                             |
| Queues        | `rewards-send`, `rewards-send-dlq`, `scan-static`           | `rewards-send-mainnet`, `rewards-send-mainnet-dlq`, `scan-static-mainnet` |
| Secrets (box) | `~/.config/trenchmart/api-secrets.env`                      | `~/.config/trenchmart/mainnet/api-secrets.env`                            |

## Launch checklist (mainnet)

Full step-by-step: [mainnet-launch.md](mainnet-launch.md).

1. Fill the `mainnet` entry in `cluster.ts` (program id, multisig, vault, mint, API base).
2. Deploy a mainnet API Worker and a second web Worker built with `NEXT_PUBLIC_CLUSTER=mainnet
NEXT_PUBLIC_MAINNET_LAUNCHED=1`.
3. Move the `trenchmart.fun` custom domain to the mainnet web Worker; keep
   `devnet.trenchmart.fun` on the devnet one. Rebuild devnet with
   `NEXT_PUBLIC_MAINNET_LAUNCHED=1` so its pill links to mainnet.
4. Set `SIWS_DOMAIN`/`APP_URL` per API Worker.

## Mainnet deployment (2026-10-23, UTC+4)

| Item | Value |
| --- | --- |
| Program id | `Dm2jtJDfSji2TASEGKxsY1CwxeUCXqGznefkJpSASZLp` (built with `--features mainnet`) |
| ProgramData | `9i37dpREk1wvYcmKYnQKwC1swxtSinLJnz8KP4TJ1tNB`, max-len 183,928 bytes |
| Source commit | `ccc26e1d0742544d45d4cbca9591a1fc3b3e729a` (#161), artifact `trench_escrow-mainnet-verified-ccc26e1…` (run 39944108479) |
| Executable hash | `dc41f8ae608c83664f8ccc7d90b38d4d80089a582885a63cbe9765993abc2839` (CI build = on-chain dump) |
| Squads v4 multisig (2-of-3) | `FFsRpwj5aTteCsS9kWpUAyQ7a9KzSSbDZgwgq2JdqbsN` |
| Vault 0 (upgrade authority) | `AoK6JdJQgtW9Wrt2z47gHnNMju2RrwNRhTZon13K3kf1` |
| Members | `2f5Tzu3zKL5dVe2U9tMM3DNCFjpQS7A37AMV7abTeKDP`, `6peYN5x6f7wttNcpgVQpbNsnKJ8gjLwydw4LUQDpPMXm`, `9jicNiQVxFJXHG4gjMDcUkYPsdF8tVFy7WEPhwrnDywU` |
| Deploy tx | `3vNbkWPhhZwAj8JoWKFpon6bUwFE6GMuCHX9zjox5u6kSKogepsJNLM1ptwL2nrvr96MJe57ktepsuzVF7z6qTBi` |
| Multisig create tx | `2Y6NgTdUi21Kr5motkv3bet479LocmMhUztscdxBPyv33SarZjnHm2geEUhwvuw18DsRxFxf2WTE11NbwWZ74ufC` |
| Authority transfer tx | `o8MAQNmJuL9x3LWGNqfZ7g6teebmKyh5NddqwSNut4nwpe3iKoeHb3hsGkYqZm6gqFctLHGZg9VDwWJ5wTythn5` |

Steps 1–3 done. `init_config` (step 4) is pending: it needs the mainnet resolver pubkey and a
Squads vault transaction. OtterSec verify must pass `-- --features mainnet`. Note: the default
(devnet) verified build at this commit no longer matches devnet on-chain `124e1180…` (the cfg
lines moved source positions); that is expected until devnet is upgraded.
