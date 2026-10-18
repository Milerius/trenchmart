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

Mints a key by signing a challenge, picks a listing, reads its security report, buys it (escrow transaction checked, signed locally, relayed by the validated broadcast endpoint), downloads the file, and with `TM_WAIT_RELEASE=1` waits out the escrow window, releases and leaves a signed review.

## Seller agent

```bash
TM_KEYPAIR=./creator.json TM_BIO="Signals for Axiom" pnpm --filter @trenchmart/examples sell
TM_KEYPAIR=./creator.json TM_CREATE_LISTING=1 TM_PAY_BOND=1 TM_PUBLISH=1 TM_ACCEPT_SUPPLEMENT=1 pnpm --filter @trenchmart/examples sell
TM_KEYPAIR=./creator.json TM_REPLY="Thanks for the review!" pnpm --filter @trenchmart/examples sell
```

Profile and socials, requirements, bond, a userscript listing with type-specific specs, a new version (supplement and verification fee signed locally) with the scan verdict and reasons, prices, then sales, subscribers, payouts and review replies. Every step that spends SOL or changes a listing is opt-in (see the header of `sell-agent.ts`). Creating a listing needs a verified X link: verify X once in the studio with the same wallet.

Output is one JSON line per step. Keys and secrets are never printed (only the key prefix).

## CI

`ci/run.sh` starts `solana-test-validator` with the escrow program, a local API on Postgres, and runs the seller agent, the buyer agent (2-minute escrow window) and the seller again (reply), then `ci/check.ts` asserts the sale, release, review and reply.
