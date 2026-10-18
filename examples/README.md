# TrenchMart example agents (Solana devnet)

Two TypeScript agents built on [`@trenchmart/sdk`](../packages/sdk) and a local `@solana/web3.js` keypair. They run against the live devnet API by default. Docs: https://trenchmart.fun/docs/agents.

```bash
pnpm install && pnpm --filter @trenchmart/sdk build
solana-keygen new -o ./agent.json   # then fund it: https://faucet.solana.com (devnet)
```

## Buyer agent

```bash
TM_KEYPAIR=./agent.json pnpm --filter @trenchmart/examples buy
TM_KEYPAIR=./agent.json TM_LISTING=trojan-trenches-intel TM_MAX_LAMPORTS=200000000 pnpm --filter @trenchmart/examples buy
# after the 1 hour escrow window: release and review that order
TM_KEYPAIR=./agent.json TM_ORDER=<orderId> pnpm --filter @trenchmart/examples buy
```

Mints a key by signing a challenge, picks a listing, reads its security report, buys it (escrow transaction checked, signed locally, relayed by the validated broadcast endpoint), downloads the file, upvotes it, and with `TM_WAIT_RELEASE=1` waits out the escrow window, releases and leaves a signed review. `TM_DISPLAY_NAME` / `TM_BIO` edit the buyer profile; `TM_UPVOTE=0` skips the upvote.

## Seller agent

```bash
TM_KEYPAIR=./creator.json TM_BIO="Signals for Axiom" pnpm --filter @trenchmart/examples sell
TM_KEYPAIR=./creator.json TM_CREATE_LISTING=1 TM_PAY_BOND=1 TM_PUBLISH=1 TM_ACCEPT_SUPPLEMENT=1 pnpm --filter @trenchmart/examples sell
TM_KEYPAIR=./creator.json TM_REPLY="Thanks for the review!" pnpm --filter @trenchmart/examples sell
```

Profile and socials, requirements, bond, a userscript listing with type-specific specs, a new version (supplement and verification fee signed locally) with the scan verdict and reasons, prices, then sales, subscribers, payouts and review replies. Every step that spends SOL or changes a listing is opt-in (see the header of `sell-agent.ts`). Creating a listing needs a verified X link: verify X once in the studio with the same wallet.

Output is one JSON line per step. Keys and secrets are never printed (only the key prefix). Each run mints a key and revokes it on exit (keys are capped at 10 per wallet); set `TM_KEEP_KEY=1` to keep it, or pass `TM_API_KEY` to reuse one.

## CI

`ci/run.sh` starts `solana-test-validator` with the escrow program, a local API on Postgres, and runs the seller agent, the buyer agent (2-minute escrow window) and the seller again (reply), then `ci/check.ts` asserts the sale, release, review, reply, upvote and buyer profile.

## Live devnet run (2026-10-18)

Both agents ran against `https://api.trenchmart.fun` with local keypairs, no web UI. Times are UTC+4.

| Step                                                                                                                        | Agent  | Result                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key minted by signing a challenge, revoked on exit                                                                          | both   | `201`, only the prefix printed                                                                                                                                                                                                                                                                                                                       |
| Buy `trojan-trenches-intel` (0.1 SOL + 5% fee), escrow tx checked, signed locally, relayed by `/agent/tx/broadcast` (10:06) | buyer  | order `fef6a6d5-2b0c-4266-86f8-5c77c57d49c0`, escrow `3cHAB3xmjs3BezeazDq4jtkmVrfHb5axHbVLiYjqk5F4`, tx [`43C8CeJV…4ixE2NNv`](https://explorer.solana.com/tx/43C8CeJVYSX4CEX6MUzunjovafooiSDegBMRsebMeV5gFykovfNZQFbj6aeDAqrrXyhDq963n7sk1RMS4ixE2NNv?cluster=devnet), 47 s end to end                                                               |
| Download (watermarked, signed URL)                                                                                          | buyer  | 1.4.1, 75 505 bytes                                                                                                                                                                                                                                                                                                                                  |
| Release after the 1 h window                                                                                                | buyer  | [`5oTvwFRH…1NiMcEex`](https://explorer.solana.com/tx/5oTvwFRH5wpgAFo7GvzEmFQBCrAm8wvDKqGAe4U1jNCL6DH6xAAYQFESkvuPn7CNcEpdNfrWZ4owHvJQ1NiMcEex?cluster=devnet) and, for a second order, [`4n7W3FY4…58mjJVW1`](https://explorer.solana.com/tx/4n7W3FY49NgGMXXLbTVe5uEqy2wZburJ8v1vFbQAw9pJBcdx2dSgDEg6eYFw33iE1PS3LcyRxMY3K2Bq58mjJVW1?cluster=devnet) |
| Signed review, upvote, buyer profile                                                                                        | buyer  | reviews `6ea5d256…`, `cf15e0c4…`; upvote counted (shown at 0× until the wallet is 7 days old); profile "Buyer Agent"                                                                                                                                                                                                                                 |
| Profile, requirements, price, sales, subscribers, payouts, review replies                                                   | seller | bio set, price `100000000`, both sales `released`, both reviews replied                                                                                                                                                                                                                                                                              |
| Create a listing                                                                                                            | seller | **blocked**: `400 X_REQUIRED`. The live site only accepts X verified through OAuth (`POST /studio/x` answers `410 X_OAUTH_REQUIRED`). A human verifies X once in the studio with the agent's wallet; after that the agent creates listings on its own.                                                                                               |
