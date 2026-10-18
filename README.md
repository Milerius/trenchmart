<div align="center">

<img src="brand/logo-mark.svg" alt="TrenchMart logo" width="96" height="96" />

# TrenchMart

### The verified edge, for sale.

The Solana marketplace for trading scripts, terminal filters and wallet lists.<br />
Every file passes automated security review in seconds. Every order is held by an on-chain escrow program (Solana devnet). Creators keep 100% of the price.

[![CI](https://github.com/Milerius/trenchmart/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Milerius/trenchmart/actions/workflows/ci.yml)
![Network: Solana devnet](https://img.shields.io/badge/network-Solana%20devnet-C6F432?labelColor=0A0B0A)
![Buyer fee: 5%, up to 100% off](https://img.shields.io/badge/buyer%20fee-5%25%2C%20up%20to%20100%25%20off-C6F432?labelColor=0A0B0A)
![Creator commission: 0%](https://img.shields.io/badge/creator%20commission-0%25-C6F432?labelColor=0A0B0A)

**[trenchmart.fun](https://trenchmart.fun)** · [Docs](https://trenchmart.fun/docs) · [Security review](docs/security/escrow-review.md) · [Mainnet readiness](docs/mainnet-readiness.md)

[How buying works](#how-buying-works) · [Fees and tiers](#fees-and-tiers) · [Trust and security](#trust-and-security) · [For creators](#for-creators) · [For agents](#for-agents) · [Status](#status) · [Quickstart](#quickstart) · [Docs](#documentation)

<br />

<img src="docs/screenshots/01-home.webp" alt="TrenchMart home page on devnet: the verified edge, for sale, with live listing, creator, order and volume counts" width="100%" />

</div>

> [!NOTE]
> TrenchMart runs on **Solana devnet** with test SOL only. Nothing here has real value yet. TrenchMart and $TRENCH are working names. See [Status](#status) for what is live and what is left before mainnet.

## Why TrenchMart

Trading tooling is sold in DMs and Discord threads today: no proof the script is safe, no recourse if it isn't, and a middleman taking a cut. TrenchMart replaces all three.

<table>
<tr>
<td width="33%" valign="top">

**Escrowed on Solana**

Your SOL is held in escrow for 1 hour before the creator is paid. Open a dispute at any point in that window and release is paused.

</td>
<td width="33%" valign="top">

**Hybrid AI + static review in under a minute**

Every version is statically scanned (scripts also run in an isolated sandbox), then judged by a rules engine plus an LLM (production: `gpt-5.6-luna`, reasoning effort medium) that reads the code against the listing. The stricter verdict wins, so the model can only tighten a verdict. Creators watch each step happen. There is no review queue.

</td>
<td width="33%" valign="top">

**Transparent fees**

Buyers pay a 5% fee, cut by up to 100% with $TRENCH. Creators pay 0% commission. Every line of the price is shown before you sign.

</td>
</tr>
</table>

## Highlights

- **Exact price before you sign.** The checkout receipt itemises list price, the 5% fee, your tier discount and the 0% commission, in SOL with USD beside it.
- **Proof, not stars.** Each listing shows the checks it passed, the declared permissions, the signed review verdict, a downloadable Ed25519-signed scan report and the pinned SHA-256 of the file you'll get.
- **Downloads once paid.** The file unlocks as soon as payment is confirmed in escrow, watermarked to your wallet, and locks again if you open a dispute.
- **Live review for creators.** Uploading feels like sending a prompt: static checks and the sandbox run at once, then the verdict lands.
- **Versions and update subscriptions.** Creators ship new versions while the current one stays live. Every purchase includes 30 days of updates; after that, buyers renew monthly at a price the seller sets (or the seller makes updates free forever). Lapsed buyers keep the last version they were entitled to.
- **Fair daily limits.** Free uploads and checks each day, then a small SOL supplement instead of a hard wall (see [For creators](#for-creators)).
- **Real numbers.** Studio, profiles and purchases show real totals with USD next to every SOL amount. Stats with no data behind them (a rating with no reviews, say) are left out, never faked.
- **Built for everyone.** WCAG AA contrast, keyboard and screen-reader support, a mobile-first checkout, and axe checks in CI.

## How buying works

1. **Pick a verified tool.** Filter by terminal (Axiom, GMGN, Photon, Terminal, Trojan) or category.
2. **See your exact price.** Connect your wallet and your $TRENCH tier is applied to the receipt before anything is signed.
3. **Pay into escrow.** One transaction. Your SOL is held for 1 hour, and you can dispute at any time in that window.
4. **Download.** The file unlocks once payment is confirmed in escrow, watermarked to your wallet. Check any file against its pinned hash on [/verify](https://trenchmart.fun/verify) (1 free check per wallet per UTC day, then 0.01 SOL each).
5. **Get updates.** New versions are yours for 30 days, then renew monthly at the seller's update price if you want to keep receiving them.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/02-listing.webp" alt="Listing page with the price receipt, escrow and update terms, logged out" /></td>
<td width="50%"><img src="docs/screenshots/03-purchases.webp" alt="Purchases page with an order in escrow, its timeline, download and an available update" /></td>
</tr>
<tr>
<td align="center"><sub><b>Listing.</b> Gallery, review checks, file hash and the exact receipt. Logged out, you see list prices.</sub></td>
<td align="center"><sub><b>Purchases.</b> Escrow timeline, dispute button, download, and new versions while your updates are active.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/07-verify.webp" alt="Verify page: check a downloaded file and read the on-chain proof" /></td>
<td width="50%" align="center"><img src="docs/screenshots/08-mobile-listing.webp" alt="Listing page on a phone" width="42%" /></td>
</tr>
<tr>
<td align="center"><sub><b>/verify.</b> Check any file against the reviewed hashes, and read the escrow program, upgrade authority and multisig live from devnet.</sub></td>
<td align="center"><sub><b>Mobile.</b> The same listing and receipt on a phone.</sub></td>
</tr>
</table>

## Fees and tiers

Buyers pay a 5% fee on top of the listing price. Holding $TRENCH cuts it. Creators pay nothing at any tier.

| Tier         | Fee discount | Buyer fee | You pay on a 1.20 SOL listing | Creator commission |
| ------------ | -----------: | --------: | ----------------------------: | -----------------: |
| No tier      |            — |        5% |                      1.26 SOL |                 0% |
| **Scout**    |      25% off |     3.75% |                     1.245 SOL |                 0% |
| **Trencher** |      60% off |        2% |                     1.224 SOL |                 0% |
| **OG**       |     100% off |        0% |                      1.20 SOL |                 0% |

Tiers also cut creator costs: from **Trencher** up, the per-version verification fee is waived.

Your tier is based on your lowest $TRENCH balance over the last 72 hours, so it can't be gamed by borrowing tokens for one purchase. Balance thresholds are set by the owner and live in config.

**Where the fee goes.** The net fee, after your discount, is split four ways: 40% $TRENCH buyback, 25% verification (automated review: static checks, sandbox runs and the review verdict), 20% operations, 15% safety fund.

## Trust and security

**Escrow on every order.** Payment goes to escrow, not to the creator. The creator is paid only after 1 hour with no dispute. A dispute pauses release until it is settled: upheld means a refund, rejected means the order returns to payout.

**On-chain escrow program.** Every order is held by [`trench_escrow`](programs/trench_escrow) on devnet (`Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw`): the buyer signs one transaction that creates the order's escrow PDA and funds it; the program releases to the creator and fee buckets after `escrow_until`, or the resolver refunds during a dispute. The program embeds a security.txt and its IDL is published on chain. It is not audited, and no reproducible (solana-verify) build is published yet. [/verify](https://trenchmart.fun/verify#proof) reads the program hash, upgrade authority, multisig and recent escrows live from devnet.

**Squads multisig vault.** Bonds and verification fees go to a [Squads](https://squads.so) v4 vault (2-of-3, readable on chain). The API holds no key that can move vault funds.

**Sandboxed automated review.** Every version passes these stages before it can be sold:

1. **Static scan** for `eval`, remote code, key and seed access, transaction signing, obfuscation, clipboard use and undeclared hosts.
2. **Isolated sandbox run** (userscripts and JavaScript alerts) with network egress blocked and every request and wallet call logged.
3. **Rules-engine verdict** on the checks and the creator's note, saved as a signed attestation. With `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL` set (optionally `LLM_REASONING_EFFORT`), an OpenAI-compatible model also compares the code with the listing; it can only tighten the verdict, and the signed report records the model. The full report is Ed25519-signed and downloadable per listing.

Approved files are pinned by SHA-256. Buyers only ever receive that exact file, watermarked to their wallet.

**Creator bonds.** Creators post a bond for their category (1 SOL for scripts, filters and indicators, 2 SOL for wallet lists, 5 SOL for bot setups and alert bots). It backs refunds when a dispute is upheld.

**Verified X badge (optional).** Creators can verify X through X sign-in (OAuth 2.0 PKCE) for a verified badge on their profile and listings. It is never required to list, publish or sell: the bond and the security scan are the gates. Creators without it show their pseudonym or wallet, and typed handles are labelled **unverified**.

## For creators

<table>
<tr>
<td width="50%"><img src="docs/screenshots/04-studio.webp" alt="Creator studio: revenue, sales, update subscribers, payouts and the listings table with an Upload new version action" /></td>
<td width="50%"><img src="docs/screenshots/06-wizard.webp" alt="New listing wizard, step 2: pick the terminals a script runs on" /></td>
</tr>
<tr>
<td align="center"><sub><b>Studio.</b> 30-day revenue and sales, update subscribers, payouts (sent, in multisig, in escrow) and one next step per listing.</sub></td>
<td align="center"><sub><b>New listing.</b> Seven steps that adapt to what you sell. Terminal names are text only; TrenchMart isn't affiliated with them.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/05-profile.webp" alt="Public creator profile with real sales, live listings, bond and member-since stats" /></td>
<td width="50%" valign="middle">

**Public profile.** Name, avatar, banner, bio, socials and X (verified or labelled unverified). It shows only real stats (sales, live listings, bond, versions shipped, and a rating once reviews exist) and, if you opt in, a buyers-only contact channel.

</td>
</tr>
</table>

- **0% commission.** You receive 100% of your listing price, and 100% of each update renewal.
- **A guided listing wizard.** Step 1 picks the type: terminal script, trading bot config, wallet tracker list, filter pack, indicator, Telegram bot or something else. Step 2 asks the questions that matter for that type, for example terminals (Axiom, GMGN, Photon, Terminal, Trojan) and what a script touches, or a wallet list's format, size and refresh cadence. Next come details with a type template, media, pricing (the median shown only from 3 or more real listings), the file, and a review with the exact fee. Drafts autosave on your device.
- **Live in seconds.** No waiting on a review queue. If something needs explaining, add a note or upload a fixed file and the review resumes.
- **Versioning.** Upload new version keeps the current one live until the new file passes review. Buyers with active updates get it automatically.
- **Update subscriptions.** 30 days free with every purchase, then a monthly price you set (10% of the price by default, or free forever).
- **Daily limits and supplements.** Each day you get 1 free update per listing and 5 free uploads in total. Beyond that, an upload costs a 0.05 SOL supplement instead of being refused.
- **Verification fee.** 0.25 SOL per version, paid at upload into the Squads vault. It's waived from the Trencher tier up.
- **Payouts in SOL** from the Squads vault after each order's 1 hour escrow releases.

## For agents

AI agents buy and sell through a non-custodial, versioned API at `https://api.trenchmart.fun/api/v1` (devnet). The API builds unsigned transactions; the agent checks and signs them with its own keypair, then relays them through a validated broadcast endpoint (only byte-identical messages the API issued to that wallet, signed by that wallet, calling allowlisted programs) or its own RPC. TrenchMart never holds an agent's key.

- **Keys.** Mint a scoped key (`read`, `trade`, `sell`, `profile`, `review`) by signing a challenge with the wallet (no transaction), or create one in Studio → API keys. Keys are hashed at rest, capped at 10 per wallet, rate limited per key (60/min by default) and revocable.
- **Buyers.** Browse and read signed security reports, buy into the on-chain escrow, download the watermarked file, release after the window, leave a signed review, upvote, and edit their profile.
- **Creators.** Profile and socials, bond, listings of every type with their specs, uploads through the same security scan (verdict and reasons by polling), prices and update prices, sales, subscribers, payouts, review replies and featured spots.
- **Docs.** [trenchmart.fun/docs/agents](https://trenchmart.fun/docs/agents), the [endpoint reference](https://trenchmart.fun/docs/agents/reference), the [OpenAPI 3.1 spec](https://api.trenchmart.fun/api/v1/openapi.json), and raw [`/llms.txt`](https://trenchmart.fun/llms.txt) and [`/llms-full.txt`](https://trenchmart.fun/llms-full.txt).
- **SDK.** [`@trenchmart/sdk`](packages/sdk) (TypeScript): typed client, local signers, and transaction checks before signing. It is ready for npm but not published yet (see its README).
- **Examples.** [`examples/`](examples) has a buyer agent and a seller agent. CI runs both end to end on a local validator for every PR.

## Status

TrenchMart is a **devnet proof of concept**. The site, API, escrow program and Squads vault are live on Solana devnet, with test SOL only.

| Area                              | Status                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escrow program `trench_escrow` v2 | Live on devnet: freeze on dispute, rotatable resolver, 7-day timeout refund. Internal review only ([security review](docs/security/escrow-review.md)); a third-party audit was declined by the owner. |
| Verified build                    | CI compares a `solana-verify` build against the deployed program ([verified-build](docs/ops/verified-build.md)).                                                                                      |
| X sign-in                         | Built (PKCE, verified ids); waiting on the production X app. Until then, devnet handles are labelled unverified.                                                                                      |
| API hardening                     | Fail-closed secrets, edge rate limiting, security headers, Hyperdrive TLS to Postgres.                                                                                                                |
| Agent API and SDK                 | Live on devnet: scoped keys, validated broadcast, buyer and creator flows, docs and llms.txt. The SDK is not on npm yet (license and npm token pending).                                              |
| Monitoring and backups            | 5-minute health checks; nightly encrypted backups ([monitoring](docs/ops/monitoring.md), [backups](docs/ops/backups.md)).                                                                             |
| Mainnet                           | Not yet. The open items are tracked in [mainnet readiness](docs/mainnet-readiness.md), including the $TRENCH launch and lifting the devnet guard.                                                     |

## Tech stack

Next.js 16 · React 19 · Tailwind CSS 4 · Hono · PostgreSQL · Solana (devnet) · Squads · Anchor (Rust) · Playwright + axe · TypeScript 7 · pnpm + Turborepo

## Quickstart

You need Node 26, pnpm 12 and PostgreSQL 16.

```bash
pnpm install

# Postgres: use your own, or start one in Docker
docker run -d --name trenchmart-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
export BLOB_DIR="$PWD/.data/blobs"   # absolute, so the seed and the API share files
export SOL_USD_OVERRIDE=180           # optional: fixed SOL/USD rate for offline work

pnpm db:seed                          # migrate and load the sample catalogue
pnpm --filter @trenchmart/api dev     # API on http://localhost:8787
pnpm --filter @trenchmart/web dev     # web on http://localhost:3000 (second terminal)
```

Every other setting has a working local default. See [`.env.example`](.env.example) for the full list.

| Command                     | What it does                                                        |
| --------------------------- | ------------------------------------------------------------------- |
| `pnpm typecheck`            | Type-checks every package                                           |
| `pnpm lint`                 | ESLint and Prettier                                                 |
| `pnpm test`                 | Unit tests, including fee and tier maths at 100% coverage           |
| `pnpm exec playwright test` | End-to-end and axe accessibility checks (starts the web app itself) |
| `pnpm brand`                | Re-renders the brand PNGs and app icons from the SVGs in `brand/`   |

The screenshots in this README are captured from the live devnet site at [trenchmart.fun](https://trenchmart.fun) as the devnet test accounts.

## Documentation

| Topic                  | Doc                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product and scope      | [`docs/01-product.md`](docs/01-product.md) · [`docs/13-product-decisions.md`](docs/13-product-decisions.md)                                                               |
| Architecture           | [`docs/02-architecture.md`](docs/02-architecture.md) · [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md)                                                                           |
| Data model and API     | [`docs/03-data-model.md`](docs/03-data-model.md) · [`docs/04-api.md`](docs/04-api.md)                                                                                     |
| Security               | [`docs/05-security-pipeline.md`](docs/05-security-pipeline.md) · [escrow security review](docs/security/escrow-review.md)                                                 |
| Mainnet readiness      | [`docs/mainnet-readiness.md`](docs/mainnet-readiness.md): what is done, what is left, and the owner decisions                                                             |
| Operations             | [`docs/ops/`](docs/ops/): monitoring, backups, verified build                                                                                                             |
| Agent API              | [trenchmart.fun/docs/agents](https://trenchmart.fun/docs/agents) · [`packages/sdk`](packages/sdk) · [`examples/`](examples) · [llms.txt](https://trenchmart.fun/llms.txt) |
| User docs (live)       | [trenchmart.fun/docs](https://trenchmart.fun/docs): buyers, sellers, escrow, fees, $TRENCH, security, treasury, FAQ                                                       |
| Payments and escrow    | [`docs/06-payments-escrow.md`](docs/06-payments-escrow.md) · [`docs/ESCROW_TESTNET_EVIDENCE.md`](docs/ESCROW_TESTNET_EVIDENCE.md)                                         |
| $TRENCH tiers          | [`docs/07-token-tiers.md`](docs/07-token-tiers.md)                                                                                                                        |
| Design system and UX   | [`docs/design-system.md`](docs/design-system.md) · [`docs/ux-guidelines.md`](docs/ux-guidelines.md) · [`design/`](design/)                                                |
| Brand assets           | [`brand/`](brand/): logo mark, wordmark (dark and light), X avatar and header, favicon. `pnpm brand` re-renders the PNGs                                                  |
| Screens and build plan | [`docs/09-screens.md`](docs/09-screens.md) · [`docs/10-build-plan.md`](docs/10-build-plan.md)                                                                             |
| Database deploy        | [`docs/DEPLOY_DATABASE.md`](docs/DEPLOY_DATABASE.md): Supabase, Hyperdrive, per-request connections, RLS                                                                  |
| Costs and budget       | [`docs/11-costs.md`](docs/11-costs.md) · [`docs/12-budget.md`](docs/12-budget.md) · [`DEPLOYMENT_COSTS.md`](DEPLOYMENT_COSTS.md)                                          |
| Brief for build agents | [`AGENT_PROMPT.md`](AGENT_PROMPT.md)                                                                                                                                      |

<div align="center">
<sub>Devnet proof of concept. Not financial advice. Tools don't guarantee profits.</sub>
</div>
