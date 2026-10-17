# 01 · Product

## One-liner
The verified marketplace for trench tooling on Solana: built by trenchers, scanned by machines, reviewed by humans, paid out on-chain.

## Users

| Role | What they do |
|------|--------------|
| **Buyer** | Browses, buys with SOL, downloads, reviews, opens disputes. Any connected wallet. |
| **Creator** | Signs in, links X, stakes a bond, uploads listings and versions, gets paid. |
| **Verifier** | Staked reviewer. Reads code + scan report, approves or rejects a version, signs the decision. Invite-only at first (OG tier can apply). |
| **Admin** | Platform team. Resolves disputes, manages verifiers, config, delistings, payouts. |

One wallet can hold several roles.

## Categories (fixed list for v1)

| Code | Name | Typical file | Notes |
|------|------|--------------|-------|
| `userscript` | Userscripts | `*.user.js` | Tampermonkey / Violentmonkey. Full scan pipeline incl. sandbox. |
| `wallet_list` | Wallet lists | `.json` / `.csv` | Smart-money / KOL tracker lists. Validated as Solana addresses, deduped, size-checked. Can be a subscription (live list). |
| `filter` | Terminal filters | `.json` | Presets for Axiom, GMGN, Photon, BullX, Padre etc. Schema-validated, no code. |
| `setup` | Full setups | `.zip` | Bundles of the above + docs. Each file inside scanned by its own type. |
| `strategy` | Wallet strategies | `.md` / `.pdf` | Documented playbooks. Scanned for links/malware only. |
| `alerts` | Alerts & bots | `.json` / `.user.js` | Telegram/Discord configs, webhooks. Outbound calls must be declared. |

Terminals for compatibility tags (config-driven list): Axiom, GMGN, Photon, BullX, Padre, Trojan, "Any".

## Features — POC scope

- Browse home: categories, trending (by 7d sales), filter by terminal, search (Postgres full-text).
- Listing page: preview images, overview, what's inside, changelog, reviews (verified buyers only), **security report** (scan checks, declared permissions, pinned hash, verifier attestation), creator card (bond, disputes lost, identity, tier).
- Buy box: price, 5% fee, holder rebate, total, buy with SOL, escrow note, license.
- Creator studio: new listing, upload version, see pipeline status, explain warnings, bond management, payouts history.
- Verifier queue: pending versions, diff vs previous version, scan report, approve/reject with notes.
- My purchases: downloads, open dispute.
- $TRENCH page: fee table, revenue split, tiers, savings calculator, how holding is checked.
- Holder perks: fee rebate, 48h early access to new listings, holder-only listings, free verification (Trencher+), half bond (OG), vote on featured (later), verifier application (OG).

## Out of scope for POC (phase 2+)
- On-chain Anchor escrow program (POC uses vault + ledger).
- On-chain verifier attestations (POC stores signed attestations in DB; publish to chain later).
- Governance voting UI, staking contract, buyback automation (POC: manual buyback from the ledger bucket).
- Subscriptions billing automation (model it in schema, ship manual renewals).
- Other chains.

## Licensing
- `single` = 1 wallet, `multi3` = 3 wallets, `subscription` = time-boxed access.
- Every download is watermarked to the buyer's wallet + order id (see `05-security-pipeline.md`).

## Non-goals / principles
- We never custody user wallets or ask for keys.
- No "guaranteed profit" language. Footer: "Not financial advice. Tools don't guarantee profits."
- Security claims shown to users must map to checks that actually ran.
