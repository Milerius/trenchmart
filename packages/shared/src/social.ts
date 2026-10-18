import { clampInt } from './num';
import { cleanText } from './profile';
import { TIERS, tierAtLeast, type Tier } from './tier';

/**
 * Social layer (reviews, helpful votes, upvotes, ranking, featuring): the rules the API
 * enforces and the web shows. Every number here is a default; the `config` table wins
 * (admin-editable via PUT /admin/config/social_rules), parsed by parseSocialConfig.
 */

export type SocialConfig = {
  /** Vote weight (basis points of one vote) for a wallet with a released purchase. */
  weightBuyerBps: number;
  /** Vote weight for a wallet holding at least `holderMinTier` of $TRENCH (72 h window). */
  weightHolderBps: number;
  holderMinTier: Tier;
  /** A wallet counts only once its TrenchMart account or first on-chain activity is this old. */
  minWalletAgeDays: number;
  /** Purchases and votes from wallets the creator funded in this window never count. */
  funderWindowDays: number;
  reviewMinChars: number;
  reviewMaxChars: number;
  reviewEditDays: number;
  /** Reports from distinct counted wallets that hide a review until an admin decides. */
  reviewAutoHideReports: number;
};

export const SOCIAL_DEFAULTS: SocialConfig = {
  weightBuyerBps: 10_000,
  weightHolderBps: 5_000,
  holderMinTier: 'scout',
  minWalletAgeDays: 7,
  funderWindowDays: 30,
  reviewMinChars: 40,
  reviewMaxChars: 1000,
  reviewEditDays: 30,
  reviewAutoHideReports: 3,
};

// Lives in ./num so zod-free modules (ranking) can use it without pulling zod into the web bundle.
export { clampInt };

/** Reads the `social_rules` config row (an object); unknown or invalid fields keep defaults. */
export function parseSocialConfig(raw: unknown): SocialConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = SOCIAL_DEFAULTS;
  const tier = TIERS.includes(r.holderMinTier as Tier)
    ? (r.holderMinTier as Tier)
    : d.holderMinTier;
  const min = clampInt(r.reviewMinChars, d.reviewMinChars, 1, 500);
  return {
    weightBuyerBps: clampInt(r.weightBuyerBps, d.weightBuyerBps, 0, 10_000),
    weightHolderBps: clampInt(r.weightHolderBps, d.weightHolderBps, 0, 10_000),
    holderMinTier: tier === 'none' ? d.holderMinTier : tier,
    minWalletAgeDays: clampInt(r.minWalletAgeDays, d.minWalletAgeDays, 0, 365),
    funderWindowDays: clampInt(r.funderWindowDays, d.funderWindowDays, 0, 365),
    reviewMinChars: min,
    reviewMaxChars: Math.max(min, clampInt(r.reviewMaxChars, d.reviewMaxChars, 1, 5000)),
    reviewEditDays: clampInt(r.reviewEditDays, d.reviewEditDays, 0, 365),
    reviewAutoHideReports: clampInt(r.reviewAutoHideReports, d.reviewAutoHideReports, 1, 100),
  };
}

// ---------- vote weight ----------

export type VoterFacts = {
  banned: boolean;
  /** TrenchMart account created_at. */
  accountCreatedAt: Date;
  /** Oldest on-chain activity seen for the wallet (null: not scanned yet). */
  oldestSeenAt: Date | null;
  /** Has at least one released order on a listing it does not own. */
  isBuyer: boolean;
  /** $TRENCH tier (72 h minimum balance) at the last check. */
  holderTier: Tier;
  /** The creator in question funded this wallet inside the funder window. */
  fundedByCreator: boolean;
  /** The voter is the creator in question. */
  isCreator: boolean;
};

export type WeightReason =
  | 'buyer'
  | 'holder'
  | 'no_purchase_or_holding'
  | 'wallet_too_new'
  | 'funded_by_creator'
  | 'own_listing'
  | 'banned';

/** One vote's weight in basis points (10 000 = 1.0×) and why. */
export function voteWeight(
  facts: VoterFacts,
  config: SocialConfig,
  now: Date,
): { bps: number; reason: WeightReason } {
  if (facts.banned) return { bps: 0, reason: 'banned' };
  if (facts.isCreator) return { bps: 0, reason: 'own_listing' };
  if (facts.fundedByCreator) return { bps: 0, reason: 'funded_by_creator' };
  const ageMs = config.minWalletAgeDays * 86_400_000;
  const oldest = Math.min(
    facts.accountCreatedAt.getTime(),
    facts.oldestSeenAt ? facts.oldestSeenAt.getTime() : Number.POSITIVE_INFINITY,
  );
  if (now.getTime() - oldest < ageMs) return { bps: 0, reason: 'wallet_too_new' };
  if (facts.isBuyer && config.weightBuyerBps > 0)
    return { bps: config.weightBuyerBps, reason: 'buyer' };
  if (tierAtLeast(facts.holderTier, config.holderMinTier) && config.weightHolderBps > 0)
    return { bps: config.weightHolderBps, reason: 'holder' };
  return { bps: 0, reason: 'no_purchase_or_holding' };
}

export const WEIGHT_REASON_TEXT: Record<WeightReason, string> = {
  buyer: 'Your vote counts fully: this wallet has a released order.',
  holder: 'Your vote counts half: this wallet holds $TRENCH.',
  no_purchase_or_holding: 'Shown, not counted: buy something or hold $TRENCH for it to count.',
  wallet_too_new: 'Shown, not counted yet: new wallets count after 7 days.',
  funded_by_creator: 'Not counted: this wallet was funded by the creator.',
  own_listing: 'Creators cannot vote on their own listings or reviews.',
  banned: 'This wallet is banned.',
};

/** "1.0×", "0.5×", "0×". */
export function weightLabel(bps: number): string {
  if (bps <= 0) return '0×';
  return `${(bps / 10_000).toFixed(bps % 1000 === 0 ? 1 : 2)}×`;
}

// ---------- reviews ----------

const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|gg|me|fun|app|dev|co|so|sh|trade|ai)\b/i;
const HANDLE_RE = /(?:^|\s)@[a-z0-9_]{2,}/i;
const EMAIL_RE = /\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/i;
const ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const INVITE_RE = /\b(?:t\.me|discord\.gg|discord\.com\/invite)\b/i;

/** Plain text only: links, handles, e-mails and wallet addresses are not allowed. */
export function reviewTextProblem(text: string, config: SocialConfig): string | null {
  const clean = cleanReviewText(text);
  if (clean.length < config.reviewMinChars)
    return `Write at least ${config.reviewMinChars} characters.`;
  if (clean.length > config.reviewMaxChars)
    return `Keep it under ${config.reviewMaxChars} characters.`;
  return contactProblem(clean);
}

/** Creator replies: same no-links rule, 1 to 1000 characters. */
export function replyTextProblem(text: string): string | null {
  const clean = cleanReviewText(text);
  if (!clean) return 'Write a reply.';
  if (clean.length > 1000) return 'Keep it under 1000 characters.';
  return contactProblem(clean);
}

function contactProblem(clean: string): string | null {
  if (EMAIL_RE.test(clean)) return 'No e-mail addresses.';
  if (INVITE_RE.test(clean) || URL_RE.test(clean)) return 'No links.';
  if (ADDRESS_RE.test(clean)) return 'No wallet addresses.';
  if (HANDLE_RE.test(clean)) return 'No @handles or contact details.';
  return null;
}

/** Keeps paragraphs, drops control characters and runs of spaces. */
export function cleanReviewText(text: string): string {
  return text
    .split('\n')
    .map((line) => cleanText(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** What the buying wallet signs to post or edit a review (free; not a transaction). */
export function reviewMessage(input: {
  orderId: string;
  rating: number;
  semver: string;
  bodySha256: string;
}): string {
  return [
    'TrenchMart review',
    `Order: ${input.orderId}`,
    `Rating: ${input.rating}`,
    `Version: ${input.semver}`,
    `Text SHA-256: ${input.bodySha256}`,
    'Signing is free and sends no transaction.',
  ].join('\n');
}

export const REVIEW_REPORT_REASONS = [
  'spam',
  'off_topic',
  'abuse',
  'contact_info',
  'other',
] as const;

/** Rating summary from visible reviews: count, average and the 5→1 histogram. */
export function ratingSummary(ratings: number[]): {
  count: number;
  avg: number | null;
  histogram: Record<1 | 2 | 3 | 4 | 5, number>;
} {
  const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let sum = 0;
  for (const r of ratings) {
    if (r >= 1 && r <= 5) {
      histogram[r as 1 | 2 | 3 | 4 | 5] += 1;
      sum += r;
    }
  }
  const count = Object.values(histogram).reduce((a, b) => a + b, 0);
  return { count, avg: count ? Math.round((sum / count) * 100) / 100 : null, histogram };
}

export type IdentityKind = 'x' | 'pseudonym' | 'wallet';
export type PublicIdentity = {
  kind: IdentityKind;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  wallet: string;
};

/** A name and avatar only for X-verified users or a chosen pseudonym; otherwise the wallet. */
export function identityOf(user: {
  wallet: string;
  handle?: string | null;
  displayName?: string | null;
  xVerified: boolean;
  xHandle?: string | null;
  avatarUrl?: string | null;
}): PublicIdentity {
  const short = `${user.wallet.slice(0, 4)}…${user.wallet.slice(-4)}`;
  if (user.xVerified)
    return {
      kind: 'x',
      name: user.displayName || user.xHandle || user.handle || short,
      handle: user.handle ?? null,
      avatarUrl: user.avatarUrl ?? null,
      wallet: user.wallet,
    };
  if (user.displayName)
    return {
      kind: 'pseudonym',
      name: user.displayName,
      handle: user.handle ?? null,
      avatarUrl: user.avatarUrl ?? null,
      wallet: user.wallet,
    };
  return {
    kind: 'wallet',
    name: short,
    handle: user.handle ?? null,
    avatarUrl: null,
    wallet: user.wallet,
  };
}
