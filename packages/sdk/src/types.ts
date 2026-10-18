import type { Scope } from './constants.js';

/** Lamport amounts travel as decimal strings (they exceed 2^53). */
export type Lamports = string;

export type ApiKeyInfo = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  rateLimitPerMin: number;
  createdVia: 'studio' | 'wallet';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};
export type CreatedApiKey = ApiKeyInfo & { key: string; wallet?: string };

export type PublicConfig = {
  feeBps: number;
  tierRebateBps: Record<'none' | 'scout' | 'trencher' | 'og', number>;
  tierThresholds: Record<string, string>;
  tierWindowHours: number;
  feeSplitBps: Record<string, number>;
  escrowHours: number;
  verificationFeeLamports: Lamports;
  bondLamportsByCategory: Record<string, Lamports>;
  terminals: string[];
  updateFreeDays: number;
  updatePeriodDays: number;
  updatePriceDefaultBps: number;
  updateLimitPerListingDay: number;
  uploadLimitPerCreatorDay: number;
  uploadSupplementLamports: Lamports;
  verifyFreePerDay: number;
  verifySupplementLamports: Lamports;
};

export type ListingSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  terminals: string[];
  price: Lamports;
  license: 'single' | 'multi3' | 'subscription';
  kind: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  sales7d: number;
  [extra: string]: unknown;
};

export type ListingDetail = ListingSummary & {
  description: string;
  creator: { handle: string | null; wallet: string; xHandle: string | null; xVerified: boolean };
  security: Record<string, unknown> | null;
};

export type ListingsQuery = {
  q?: string;
  category?: 'userscript' | 'wallet_list' | 'filter' | 'setup' | 'strategy' | 'alerts';
  terminal?: string;
  sort?: 'trending' | 'new' | 'price_asc' | 'price_desc' | 'rating' | 'top';
  cursor?: string;
  limit?: number;
};

export type Quote = {
  price: Lamports;
  fee: Lamports;
  rebate: Lamports;
  total: Lamports;
  tier: string;
  feeBps: number;
  rebateBps: number;
};

export type CheckoutOrder = {
  orderId: string;
  total: Lamports;
  memo: string;
  escrow: string;
  escrowProgram: string;
  escrowUntil: string;
  txBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

export type Order = {
  id: string;
  status: 'pending' | 'paid' | 'released' | 'disputed' | 'refunded' | 'expired' | string;
  listing_id: string;
  total: Lamports;
  escrow_until: string | null;
  escrow_address: string | null;
  tx_sig: string | null;
  [extra: string]: unknown;
};

export type Download = { url: string; expiresAt: string; versionId: string; semver: string };

export type UnsignedPayment = {
  txBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

export type ListingKind = 'script' | 'bot' | 'wallet' | 'filter' | 'indicator' | 'telegram' | 'other';

export type CreateListingInput = {
  title: string;
  summary: string;
  description: string;
  category: NonNullable<ListingsQuery['category']>;
  terminals?: string[];
  priceLamports: Lamports;
  license?: 'single' | 'multi3' | 'subscription';
  subPeriodDays?: number;
  holderOnlyHours?: number;
  holderOnly?: boolean;
  updatePriceLamports?: Lamports;
  kind?: ListingKind;
  specs?: Record<string, unknown>;
};

export type ListingPatch = {
  title?: string;
  summary?: string;
  description?: string;
  priceLamports?: Lamports;
  holderOnlyHours?: number;
  holderOnly?: boolean;
  updatePriceLamports?: Lamports;
};

export type StartedVersion = {
  versionId: string;
  uploadUrl: string;
  verificationFee: Lamports;
  feeTx: UnsignedPayment | null;
  supplement: {
    id: string;
    lamports: Lamports;
    reasons: string[];
    tx: UnsignedPayment | null;
  } | null;
};

export type ScanCheck = {
  rule_id: string;
  result: 'pass' | 'warn' | 'fail' | string;
  title: string;
  detail: string | null;
  kind: string;
  [extra: string]: unknown;
};

export type VersionResult = {
  version: {
    id: string;
    semver: string;
    status: 'pending_upload' | 'scanning' | 'live' | 'needs_creator' | 'rejected' | 'superseded' | string;
    sha256: string | null;
    [extra: string]: unknown;
  };
  checks: ScanCheck[];
  review: { decision: string; notes: string; created_at: string; [extra: string]: unknown } | null;
};

export type ProfileInput = {
  handle?: string;
  displayName?: string;
  bio?: string;
  socials?: { telegram?: string; discord?: string; website?: string; github?: string };
  contact?: {
    enabled: boolean;
    channels: { kind: 'telegram' | 'discord' | 'email'; value: string; audience: 'everyone' | 'buyers' }[];
  };
};

export type ReviewForm = {
  order: { id: string; status: string; releasedAt: string | null; escrowUntil: string | null };
  versions: { id: string; semver: string; downloadedAt: string }[];
  rules: { minChars: number; maxChars: number; editDays: number };
  canReview: boolean;
  [extra: string]: unknown;
};

export type Json = Record<string, unknown>;
