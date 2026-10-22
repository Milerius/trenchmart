# 12 · Budget handover

USD figures from the owner. **estimate** = unchecked. **[QUOTE]** = needs a price before it can be committed. Domain price is a live Porkbun quote for `trenchmart.fun`, not an estimate.

Custody for launch stays a **Squads multisig vault**. A full Anchor escrow audit is phase 2 and is skippable by staying on that vault.

## 1 · Monthly cost by stage

| Item                                           |     POC / devnet |      Launch |     Traction | Notes                                                             |
| ---------------------------------------------- | ---------------: | ----------: | -----------: | ----------------------------------------------------------------- |
| Cloudflare Workers (web + API + queues + cron) |               $0 |         ~$5 |       ~$5–15 | Free tier 100k req/day, then $0.30 per million                    |
| Cloudflare R2                                  |               $0 |       ~$0–1 |        ~$1–5 | 10 GB free, $0.015/GB-month, no egress                            |
| Supabase Postgres                              |               $0 |         $25 |       $25–40 | Free pauses after 1 week idle. Pro: 8 GB DB, 100 GB files         |
| Helius RPC + webhooks                          |               $0 |          $0 |          $49 | Free 1M credits. Developer plan 10M credits                       |
| Sandbox VPS (Hetzner CPX22)                    | $0 (own machine) |         ~$7 |       ~$7–14 | €6.49/mo, 2 vCPU, 4 GB. One box at launch, two if the queue grows |
| Email notifications (Resend / Postmark)        |               $0 |          $0 |       ~$0–20 | estimate; free tiers cover early volume                           |
| Sentry                                         |               $0 |          $0 |        $0–26 | estimate                                                          |
| Domain                                         |              ~$1 |         ~$1 |          ~$1 | See exact `trenchmart.fun` price below                            |
| **Total**                                      |          **~$1** | **~$38–40** | **~$90–170** |                                                                   |

### Domain (exact)

|            |                   |
| ---------- | ----------------- |
| Name       | `trenchmart.fun`  |
| Registrar  | Porkbun           |
| First year | **$2.57**         |
| Renewal    | **$31.41 / year** |

## 2 · One-off costs

| Item                                     | When                |           Cost | Notes                                                                  |
| ---------------------------------------- | ------------------- | -------------: | ---------------------------------------------------------------------- |
| pump.fun token launch                    | Before launch       |   ~$1–5 in SOL | No platform fee. Network fees only                                     |
| Initial $MART dev buy                  | Optional            | Owner's choice | Disclose it. Not required to run the market                            |
| Squads multisig vault setup              | Before mainnet      |      ~$1–5 SOL | estimate. Default escrow custody                                       |
| Devnet creator bond / test funds         | POC                 |             $0 | Airdrop                                                                |
| Seed liquidity for treasury buckets      | Optional            | Owner's choice | Buyback / AI verification / ops / safety                               |
| Pre-audit security sprint                | Before phase 2 only |         $1,500 | Zealynx 3-day review, credited toward a full audit                     |
| Full Anchor escrow audit                 | Phase 2 only        |       $15k–60k | estimate **[QUOTE]**. Skippable while escrow stays on the Squads vault |
| Legal review (terms, token, marketplace) | Before mainnet      |    **[QUOTE]** | Strongly recommended                                                   |
| Branding                                 | Anytime             |         $0–500 |                                                                        |

## 3 · People

| Role                        | How it's paid                                                                |
| --------------------------- | ---------------------------------------------------------------------------- |
| Build                       | Owner's AI subscription **[YOUR COST]**                                      |
| AI verification agents      | 25% `ai_verification` bucket + 100% of verification fees, paid as AI credits |
| AI credits (external model) | **[QUOTE]**. The in-process agent costs $0 during the POC                    |
| Moderation / disputes       | Owner time                                                                   |
| Marketing                   | Optional                                                                     |

## 4 · Revenue model

Platform fee is **5%** of list price, paid by the buyer. Average holder rebate is an **estimate of 40%** of that fee, so net platform take is about **3% of volume**.

Creators keep the list price (0% commission).

| Bucket                  | Share of net fee |
| ----------------------- | ---------------: |
| Buyback                 |              40% |
| AI verification credits |              25% |
| Ops                     |              20% |
| Safety fund             |              15% |

Only the **ops** bucket is meant to pay hosting.

| Monthly volume |       Ops share (20% of ~3%) |
| -------------: | ---------------------------: |
|         $1,000 |                           $6 |
|         $5,000 |                          $30 |
|        $10,000 |    $60 (covers launch infra) |
|        $25,000 | $150 (covers traction infra) |

Break-even:

- Launch infra from **ops only**: about **$6,700 / month** volume.
- Launch infra from **all net fees**: about **$1,300 / month** volume.

pump.fun pays the token creator **0.30%** of bonding-curve trades, plus a tiered creator fee after graduation. The Holder Rewards option sends those fees to holders instead. That income is separate from marketplace fees.

## 5 · Recommended starting budget

| Line                                                          |                                                      Amount |
| ------------------------------------------------------------- | ----------------------------------------------------------: |
| 6 months of launch infra                                      |                                                        $240 |
| AI credits                                                    | **[QUOTE]** ($0 while the in-process agent is the verifier) |
| Pre-audit sprint (only if building on-chain escrow)           |                                                      $1,500 |
| Domain, network fees, misc                                    |                                                        $100 |
| Contingency ~20% on the cash lines above                      |         ~$70 with $0 AI credits, or more once a quote lands |
| **With the pre-audit, $0 AI credits, no full audit or legal** |                                                 **~$2,210** |
| **Leanest (no pre-audit, in-process AI agent)**               |                                                   **~$400** |

There is no verifier-bounty line. The old ~$2,800 starting figure included $500 of human-verifier bounties; that spend is gone. The 25% bucket and every verification fee fund the AI credit pool instead.

The lean path is: Squads vault, Anchor program kept in CI but not used for custody, no audit, in-process AI verifier, domain + a few months of launch infra.

## Sources

- [cloudflare.com/plans](https://www.cloudflare.com/plans)
- [supabase.com/pricing](https://supabase.com/pricing)
- [helius.dev/pricing](https://www.helius.dev/pricing)
- [pump.fun/docs/fees](https://pump.fun/docs/fees)
- [zealynx.io/services/solana-audit](https://www.zealynx.io/services/solana-audit)
- Hetzner CPX22 listing on [whtop.com](https://www.whtop.com)
