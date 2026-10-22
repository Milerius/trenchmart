# Deployment costs

Cheapest setup that still keeps custody and correctness. Escrow at launch is a **Squads multisig vault**. The API never holds a vault key. The Anchor program in this repo is built and tested in CI and can be deployed, but it is not the launch custody path, so the full Anchor audit stays skippable.

Figures are USD unless marked SOL. **estimate** is the owner's unchecked range. **[QUOTE]** still needs a vendor price. Domain and program-data rent are measured, not estimated.

## Go-live, cheapest safe path

### Monthly

| Item                    |  Amount | Why this number                                                                                                    |
| ----------------------- | ------: | ------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Workers paid |      $5 | Free tier cron is not reliable enough for escrow release. Workers Paid is $5/month.                                |
| Cloudflare R2           |      $0 | 10 GB free. Launch storage sits inside that.                                                                       |
| Supabase Postgres Pro   |     $25 | Free projects pause after a week idle. Pro is the smallest plan that stays up.                                     |
| Helius RPC              |      $0 | Free plan, 1M credits. Enough until traction. Developer plan is $49 later.                                         |
| Hetzner CPX22 sandbox   |      $7 | One 2 vCPU / 4 GB box. Owner budget uses ~$7 for the €6.49 listing. A spare machine can be $0 during the POC only. |
| Email, Sentry           |      $0 | Not wired. Leave them off.                                                                                         |
| **Monthly**             | **$37** |                                                                                                                    |

### One-time

| Item                                     |                       Amount | Why this number                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trenchmart.fun` year one                |                        $2.57 | Porkbun quote from the owner. Renewal is **$31.41 / year** after that.                                                                                                                                                                                                                                                                                                    |
| Mainnet program deploy rent              |               0.93606620 SOL | Fresh deploy of the 183,928-byte verified `trench_escrow.so` with `--max-len 183928`: ProgramData (183,973 bytes) 0.93523308 SOL plus the program account 0.00083312 SOL stay locked. The buffer (0.93519244 SOL) is refunded when the deploy finalizes, so the peak is about **1.872 SOL**. Fund the wallet with about **2 SOL**. See `docs/ops/escrow-program-size.md`. |
| Squads vault                             |        ~1–5 SOL **estimate** | Default custody. Rent for the multisig and vault.                                                                                                                                                                                                                                                                                                                         |
| pump.fun token                           |        ~1–5 SOL **estimate** | Network fees only. No platform fee. Optional for the market itself.                                                                                                                                                                                                                                                                                                       |
| AI credits                               |                           $0 | In-process verifier. External model is **[QUOTE]**.                                                                                                                                                                                                                                                                                                                       |
| Pre-audit / full audit                   |                           $0 | Skipped while custody stays on Squads. Zealynx pre-audit is $1,500 and a full audit is $15k–60k **[QUOTE]** only if the program becomes custody.                                                                                                                                                                                                                          |
| Legal                                    |                  **[QUOTE]** | Not priced.                                                                                                                                                                                                                                                                                                                                                               |
| **Cash one-time, no audit and no legal** | **$2.57** plus the SOL lines |                                                                                                                                                                                                                                                                                                                                                                           |

### First year vs later years

|                 |                            Cash | SOL (custody + program rent)                                                                                     |
| --------------- | ------------------------------: | ---------------------------------------------------------------------------------------------------------------- |
| Year one        |  $2.57 + 12 × $37 = **$446.57** | ~1–5 SOL Squads, plus 0.93606620 SOL if the program is deployed on mainnet, plus ~1–5 SOL if a token is launched |
| Each later year | $31.41 + 12 × $37 = **$475.41** | No new program rent unless the program is redeployed                                                             |

The lean POC on devnet is the domain plus airdropped SOL. Do not send mainnet SOL for development.

## What is not in the $37

- Traction Helius Developer ($49) and a second sandbox box.
- Verifier bounties. There is no human verifier payroll. The 25% `ai_verification` bucket and 100% of verification fees are AI credits.
- Resend and Sentry. Both are optional and unwired.

## Sources

- Cloudflare Workers Paid, $5/month: [cloudflare.com/plans](https://www.cloudflare.com/plans)
- Supabase Pro, $25/month, free tier pauses: [supabase.com/pricing](https://supabase.com/pricing)
- Helius free 1M credits, Developer $49: [helius.dev/pricing](https://www.helius.dev/pricing)
- pump.fun network fees only: [pump.fun/docs/fees](https://pump.fun/docs/fees)
- Zealynx pre-audit $1,500, credited to a full audit: [zealynx.io/services/solana-audit](https://www.zealynx.io/services/solana-audit)
- Hetzner CPX22: [whtop.com Hetzner listing](https://www.whtop.com) and the owner budget in `docs/12-budget.md`
- Domain: owner Porkbun quote for `trenchmart.fun`, $2.57 first year, $31.41/year renewal
- Program rent: `solana rent` (Solana CLI 4.3.2) for the 183,973-byte ProgramData and 36-byte program account of the 183,928-byte verified build. Measured devnet buffer for the same binary held 0.93519244 SOL.
