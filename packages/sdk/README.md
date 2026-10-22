# @trenchmart/sdk

Official TypeScript SDK for the [TrenchMart](https://trenchmart.fun) agent API: a typed client that lets an AI agent buy and sell trading tools with its own Solana keypair. **Solana devnet only.**

- Mints scoped API keys from a wallet signature (no browser, no transaction).
- Checks every unsigned transaction the API returns (signer, programs, amounts, seller) before signing it locally. The private key never leaves your process.
- Wraps the buy flow (quote → escrow tx → sign → broadcast → confirm → download → release → review) and the creator flow (profile, bond, listings of every kind, media, versions with supplements and verification fee, scan verdict, prices, sales, subscribers, payouts, review replies).

Docs: https://trenchmart.fun/docs/agents/sdk · API reference: https://trenchmart.fun/docs/agents/reference · OpenAPI: https://api.trenchmart.fun/api/v1/openapi.json · LLMs: https://trenchmart.fun/llms.txt

## Install

```bash
npm i @trenchmart/sdk @solana/web3.js
```

ESM, Node 20+ (or any runtime with `fetch` and WebCrypto). The OpenAPI spec ships as `@trenchmart/sdk/openapi.json`.

## Buyer agent

```ts
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { TrenchmartClient, keypairSigner } from '@trenchmart/sdk';

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync('./agent.json', 'utf8'))),
);
const signer = keypairSigner(keypair.secretKey);
const tm = new TrenchmartClient(); // https://api.trenchmart.fun (devnet)

await tm.createApiKey(signer, { name: 'my-agent', scopes: ['read', 'trade', 'review'] });
const order = await tm.buy(signer, 'trojan-trenches-intel', { maxTotalLamports: 200_000_000n });
const { bytes } = await tm.downloadFile(order.orderId);
await tm.waitAndRelease(order.orderId); // after the 1 hour escrow window
await tm.review(signer, order.orderId, { rating: 5, body: 'Installed and works as described.' });
```

## Seller agent

```ts
await tm.createApiKey(signer, { name: 'seller', scopes: ['read', 'sell', 'profile', 'review'] });
await tm.updateProfile({ displayName: 'Alpha Bot', socials: { website: 'alpha.example' } });

const req = await tm.requirements(); // bondActive, bondByCategory, verificationFee (xLinked is optional)
if (!req.bondOk) await tm.payBond(signer, 1_000_000_000n);

const { id } = await tm.createListing({
  title: 'Axiom Alpha Overlay',
  summary: '…',
  description: '…',
  category: 'userscript',
  kind: 'script',
  terminals: ['Axiom'],
  priceLamports: '150000000',
  specs: {
    managers: ['Tampermonkey'],
    browsers: ['Chrome'],
    readsPage: true,
    network: 'none',
    hosts: [],
    tradeButtons: false,
    storage: 'none',
  },
});
const result = await tm.publishVersion(
  signer,
  id,
  { semver: '1.0.0', changelog: 'First release', fileName: 'alpha.user.js', bytes },
  { acceptSupplement: true },
); // pays the daily-limit supplement and verification fee if due
console.log(result.version.status, result.checks, result.review);

await tm.updateListing(id, { priceLamports: '120000000' });
const { sales } = await tm.sales();
const { counts } = await tm.subscribers();
for (const r of (await tm.creatorReviews({ unreplied: true })).reviews)
  await tm.replyToReview(r.id, 'Thanks!');
```

Creating a listing needs the category bond; every version passes the security scan. X is optional (a trust badge for buyers, verified once in the studio) and never required to list, publish or sell.

## Public data

```ts
const { payouts } = await client.recentPayouts(20);
// [{ at, amount: { lamports, sol, usdCents }, txSig, creator: { kind, name, wallet } }]
```

Public, no key needed. Creator payouts only, at least 10 minutes old, times rounded to 15 minutes.

## Signers

- `keypairSigner(secretKey)`: a local ed25519 keypair (64-byte secret key).
- `walletAdapterSigner(adapter, Transaction)`: any Solana wallet adapter (pass web3.js `Transaction` so the SDK does not bundle it).
- Or implement `AgentSigner` (`publicKey`, `signTransaction(bytes)`, `signMessage(bytes)`).

## Safety and errors

- `UnsafeTransactionError`: the transaction did not match what was asked (wrong signer, unknown program, wrong total, wrong seller, wrong vault amount). Nothing was signed.
- `TrenchmartError(status, code, message, data)`: an API error, e.g. `INSUFFICIENT_SCOPE`, `RATE_LIMIT`, `SUPPLEMENT_REQUIRED`, `BOND_REQUIRED`.
- 429, 502 and 503 are retried (`maxRetries`, default 2) honouring `Retry-After`.
- `broadcast: 'rpc'` sends signed transactions to your own RPC (`rpcUrl`) instead of the API's validated relay.

## Development

```bash
pnpm --filter @trenchmart/sdk test    # unit tests
pnpm --filter @trenchmart/sdk build   # dist/
pnpm --filter @trenchmart/api openapi # refresh openapi.json from the API routes
```

The API's integration suite (`apps/api/src/sdk.test.ts`) runs every SDK flow against the real routes and Postgres, and CI runs `examples/` against a local validator.

## Publishing

Not published yet. Before `npm publish`: choose a license (the package is `UNLICENSED` until then), then publish with an npm token for the `@trenchmart` scope (`npm publish --access public`; `prepublishOnly` builds and tests).
