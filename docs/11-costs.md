# 11 · Hosting cost estimate

Prices checked October 2026 on the providers' pricing pages; re-check before committing.

| Stage         | Pieces                                                                                                                                                            | Approx. monthly           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| POC / devnet  | Workers free (100k req/day), Supabase free (500 MB DB, 1 GB files, pauses after 1 week idle), R2 10 GB free, Helius free (1M credits), sandbox on a spare machine | **$0** + domain (~$10/yr) |
| Public launch | Workers paid (~$5), Supabase Pro ($25, 8 GB DB, never pauses), sandbox VPS (~$5–10), Helius free                                                                  | **~$35–45**               |
| Traction      | + Helius Developer ($49, 10M credits)                                                                                                                             | **~$85–100**              |

Unit costs that matter:

- Workers: $0.30 per million requests beyond included.
- R2: $0.015 per GB-month after 10 GB free, **no egress fees** (downloads are free to serve).
- Supabase Pro: extra DB disk $0.125/GB.

Not included: Anchor escrow audit (phase 2, the largest single cost), Solana tx fees for payouts (negligible), domain, email provider.

Sources: cloudflare.com/plans, supabase.com/pricing, helius.dev/pricing.
