<div align="center">

<img src="brand/logo-mark.svg" alt="TrenchMart logo" width="96" height="96" />

# TrenchMart

### The verified edge, for sale.

The Solana marketplace for trading scripts, terminal filters and wallet lists.<br />
Every file is AI-verified in seconds. Every order is escrowed. Creators keep 100% of the price.

[![CI](https://github.com/Milerius/trenchmart/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Milerius/trenchmart/actions/workflows/ci.yml)
![Network: Solana devnet](https://img.shields.io/badge/network-Solana%20devnet-C6F432?labelColor=0A0B0A)
![Buyer fee: 5%, up to 100% off](https://img.shields.io/badge/buyer%20fee-5%25%2C%20up%20to%20100%25%20off-C6F432?labelColor=0A0B0A)
![Creator commission: 0%](https://img.shields.io/badge/creator%20commission-0%25-C6F432?labelColor=0A0B0A)

[How buying works](#how-buying-works) · [Fees and tiers](#fees-and-tiers) · [Trust and security](#trust-and-security) · [For creators](#for-creators) · [Quickstart](#quickstart) · [Docs](#documentation)

<br />

<img src="docs/screenshots/01-landing.webp" alt="TrenchMart landing page: the verified edge, for sale" width="100%" />

</div>

> [!NOTE]
> TrenchMart runs on **Solana devnet** with test SOL only. Nothing here has real value yet. TrenchMart and $TRENCH are working names.

## Why TrenchMart

Trading tooling is sold in DMs and Discord threads today: no proof the script is safe, no recourse if it isn't, and a middleman taking a cut. TrenchMart replaces all three.

<table>
<tr>
<td width="33%" valign="top">

**Escrowed on Solana**

Your SOL is held in escrow for 48 hours before the creator is paid. Open a dispute at any point in that window and release is paused.

</td>
<td width="33%" valign="top">

**AI verification in seconds**

Every version is statically scanned, run in an isolated sandbox and judged by AI before it goes live. Creators watch each step happen. There is no review queue.

</td>
<td width="33%" valign="top">

**Transparent fees**

Buyers pay a 5% fee, cut by up to 100% with $TRENCH. Creators pay 0% commission. Every line of the price is shown before you sign.

</td>
</tr>
</table>

## Highlights

- **Exact price before you sign.** The checkout receipt itemises list price, the 5% fee, your tier discount and the 0% commission, in SOL with USD beside it.
- **Proof, not stars.** Each listing shows the checks it passed, the declared permissions, the signed AI verdict and the pinned SHA-256 of the file you'll get.
- **Downloads after release.** The file unlocks when escrow releases, watermarked to your wallet. Never while your funds are still held.
- **Live AI review for creators.** Uploading feels like sending a prompt: static checks and the sandbox run at once, then the verdict lands.
- **Real numbers.** Studio and purchases show real totals with USD next to every SOL amount. The landing page shows sample figures until real data exists, then switches on its own.
- **Built for everyone.** WCAG AA contrast, keyboard and screen-reader support, a mobile-first checkout, and axe checks in CI.

## How buying works

1. **Pick a verified tool.** Filter by terminal (Axiom, GMGN, Photon, BullX, Padre) or category.
2. **See your exact price.** Connect your wallet and your $TRENCH tier is applied to the receipt before anything is signed.
3. **Pay into escrow.** One transaction. Your SOL is held for 48 hours, and you can dispute at any time in that window.
4. **Download on release.** When escrow releases, the download unlocks. Check any file against its pinned hash on the Verify page.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/02-listing.webp" alt="Listing page with AI verification checks and the logged-out preview price" /></td>
<td width="50%"><img src="docs/screenshots/03-checkout-fee-breakdown.webp" alt="Checkout with the exact fee breakdown for a Trencher-tier holder" /></td>
</tr>
<tr>
<td align="center"><sub><b>Listing.</b> Checks, permissions, signed verdict and file hash. Logged out, you see a preview price.</sub></td>
<td align="center"><sub><b>Checkout.</b> A Trencher holder pays 1.224 SOL on a 1.20 SOL listing: 60% off the fee.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/04-escrow-status.webp" alt="Purchases page showing escrow timers and locked downloads" /></td>
<td width="50%" align="center"><img src="docs/screenshots/07-mobile-checkout.webp" alt="Mobile checkout with the fee receipt" width="42%" /></td>
</tr>
<tr>
<td align="center"><sub><b>Escrow status.</b> Live countdowns, disputes and downloads that unlock on release.</sub></td>
<td align="center"><sub><b>Mobile.</b> The same receipt, with a sticky buy bar on small screens.</sub></td>
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

Your tier is based on your lowest $TRENCH balance over the last 72 hours, so it can't be gamed by borrowing tokens for one purchase. Balance thresholds are set by the owner and live in config.

**Where the fee goes.** The net fee, after your discount, is split four ways: 40% $TRENCH buyback, 25% AI verification (automated review: static checks, sandbox runs and AI verdicts), 20% operations, 15% safety fund.

## Trust and security

**Escrow on every order.** Payment goes to escrow, not to the creator. The creator is paid only after 48 hours with no dispute. A dispute pauses release until it is settled: upheld means a refund, rejected means the order returns to payout.

**Squads multisig vault.** Escrowed SOL sits in a [Squads](https://squads.so) multisig vault backed by an off-chain ledger. The API holds no key that can move vault funds, and payouts are proposed to multisig signers. The repo also has an on-chain Anchor escrow program, [`trench_escrow`](programs/trench_escrow), that handles fund, release, dispute and refund with the same fee maths. CI builds and tests it on every pull request, but it is not the launch custody path. Custody stays on Squads until the program is audited.

**Sandboxed AI review.** Every version passes three stages before it can be sold:

1. **Static scan** for `eval`, remote code, key and seed access, transaction signing, obfuscation, clipboard use and undeclared hosts.
2. **Isolated sandbox run** with network egress blocked and every request and wallet call logged.
3. **AI verdict** comparing what the file does with what the listing says, saved as a signed attestation.

Approved files are pinned by SHA-256. Buyers only ever receive that exact file, watermarked to their wallet.

**Creator bonds.** Creators post a 1–5 SOL bond for their category. It backs refunds when a dispute is upheld.

## For creators

<table>
<tr>
<td width="50%"><img src="docs/screenshots/06-live-ai-review.webp" alt="Live AI review streaming static checks, sandbox and AI verdict" /></td>
<td width="50%"><img src="docs/screenshots/05-creator-dashboard.webp" alt="Creator studio with payouts in SOL and USD" /></td>
</tr>
<tr>
<td align="center"><sub><b>Live AI review.</b> Upload, then watch each step land. Approved files go live at once.</sub></td>
<td align="center"><sub><b>Creator studio.</b> Real payouts, queued and sent, in SOL with USD.</sub></td>
</tr>
</table>

- **0% commission.** You receive 100% of your listing price.
- **Live in seconds.** No waiting on a review queue. If something needs explaining, add a note or upload a fixed file and the review resumes.
- **Payouts in SOL** from the Squads vault after each order's escrow releases.

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
| `pnpm screenshots`          | Regenerates the screenshots in this README from the running app     |

`pnpm screenshots` ([`scripts/screenshots.ts`](scripts/screenshots.ts)) needs the API and web app running against a seeded database. It adds demo escrow orders, payouts and a Trencher-tier balance, signs in with the app's test wallet hook, uploads a file through the live AI review, and saves WebP captures to `docs/screenshots/`. Run `pnpm db:seed` afterwards to reset.

## Documentation

| Topic                  | Doc                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Product and scope      | [`docs/01-product.md`](docs/01-product.md) · [`docs/13-product-decisions.md`](docs/13-product-decisions.md)                      |
| Architecture           | [`docs/02-architecture.md`](docs/02-architecture.md) · [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md)                                  |
| Data model and API     | [`docs/03-data-model.md`](docs/03-data-model.md) · [`docs/04-api.md`](docs/04-api.md)                                            |
| Security pipeline      | [`docs/05-security-pipeline.md`](docs/05-security-pipeline.md)                                                                   |
| Payments and escrow    | [`docs/06-payments-escrow.md`](docs/06-payments-escrow.md)                                                                       |
| $TRENCH tiers          | [`docs/07-token-tiers.md`](docs/07-token-tiers.md)                                                                               |
| Design system and UX   | [`docs/design-system.md`](docs/design-system.md) · [`docs/ux-guidelines.md`](docs/ux-guidelines.md) · [`design/`](design/)       |
| Brand assets           | [`brand/`](brand/): logo mark, wordmark (dark and light), X avatar and header, favicon. `pnpm brand` re-renders the PNGs         |
| Screens and build plan | [`docs/09-screens.md`](docs/09-screens.md) · [`docs/10-build-plan.md`](docs/10-build-plan.md)                                    |
| Database deploy        | [`docs/DEPLOY_DATABASE.md`](docs/DEPLOY_DATABASE.md): Supabase, Hyperdrive, per-request connections, RLS                         |
| Costs and budget       | [`docs/11-costs.md`](docs/11-costs.md) · [`docs/12-budget.md`](docs/12-budget.md) · [`DEPLOYMENT_COSTS.md`](DEPLOYMENT_COSTS.md) |
| Brief for build agents | [`AGENT_PROMPT.md`](AGENT_PROMPT.md)                                                                                             |

<div align="center">
<sub>Devnet proof of concept. Not financial advice. Tools don't guarantee profits.</sub>
</div>
