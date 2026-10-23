/**
 * Edge abuse limits per 60 s window (API Workers Rate Limiting bindings, see
 * apps/api/src/abuse-limits.ts and docs/ops/abuse-limits.md). Keyed per client IP (IPv6 by
 * /64) and, for writes, also per signed-in wallet. Must match apps/api/wrangler.toml.
 */
export const ABUSE_LIMITS = {
  read: { binding: 'READ_LIMITER', limit: 600 },
  auth: { binding: 'AUTH_LIMITER', limit: 20 },
  tx: { binding: 'TX_LIMITER', limit: 60 },
  verify: { binding: 'VERIFY_LIMITER', limit: 20 },
  upload: { binding: 'UPLOAD_LIMITER', limit: 60 },
} as const;
export const ABUSE_PERIOD_SEC = 60;
