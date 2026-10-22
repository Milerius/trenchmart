# Networks: Devnet and Mainnet

TrenchMart runs one deployment per Solana cluster, each on its own hostname. The header pill
(Devnet | Mainnet, left of the wallet button; first row of the mobile menu below 640 px)
switches between them by opening the other hostname's home page: listings, orders and
sessions are separate per cluster, so a path on one does not exist on the other.

The pill and its menu are server-rendered HTML (`components/network-switch.tsx`, a
`<details>` element), so they add no client JS; the header only closes an open menu on an
outside click or Escape. From `xl` both segments show; between `sm` and `xl` only the active
one.

| Cluster | Site                                                                                              | API (proxied same-origin at `/api/v1`)                                                                                         | Status        |
| ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Devnet  | `https://devnet.trenchmart.fun` and, until mainnet launches, `https://trenchmart.fun`             | `https://api.trenchmart.fun`                                                                                                   | live          |
| Mainnet | `https://trenchmart.fun` (after launch); Worker `trenchmart-web-mainnet` configured, not deployed | `https://api.mainnet.trenchmart.fun` (after launch); now `https://trenchmart-api-mainnet.trenchmart.workers.dev`, fails closed | "Coming soon" |

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
`~/.config/trenchmart/helius.env` (chmod 600). The devnet watchdog keeps its independent public
probe (`RPC_URL` in `watchdog.wrangler.toml`); the mainnet watchdog takes a Helius `RPC_URL`
secret when it is first deployed. To rotate, `wrangler secret put` the new URL; no code deploy
is needed.

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
