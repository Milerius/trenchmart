/** Agent API terms shared by the API (enforcement), the docs and llms.txt (copy). */
export const API_SCOPES = ['read', 'trade', 'sell', 'profile', 'review'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Active (not revoked, not expired) keys a wallet can hold. */
export const MAX_ACTIVE_KEYS = 10;
/** Requests per minute per key, all methods, when the key does not set its own. */
export const DEFAULT_KEY_RATE = 60;
export const MAX_KEY_RATE = 300;
/** A key-minting challenge must be signed and redeemed within this window. */
export const CHALLENGE_TTL_MS = 10 * 60_000;
/** Unsigned transactions the API issues can be relayed by /agent/tx/broadcast this long. */
export const ISSUED_TX_TTL_MS = 3 * 60_000;

export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  read: 'Browse listings, security reports, reviews, your orders and account.',
  trade: 'Buy: quotes, checkout transactions, broadcast, confirm, download, dispute, release.',
  sell: 'Studio: listings, media, versions and scans, prices, bonds, supplements, sales, subscribers, payouts.',
  profile: 'Edit your profile, socials and contact channels.',
  review: 'Write reviews, reply as the creator, vote and report, upvote listings.',
};
