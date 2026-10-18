import { CATEGORIES } from '@trenchmart/shared/categories';
import { DEFAULT_CONFIG_JSON, type CategoryCode } from '@trenchmart/shared/config';
import {
  MALICIOUS_DISPUTE_MS,
  PAYMENT_GRACE_MS,
  escrowWindowLabel,
} from '@trenchmart/shared/escrow';
import { formatSol } from '@trenchmart/shared/money';
import {
  ORDER_STATUSES,
  VERSION_STATUSES,
  canTransitionOrder,
  canTransitionVersion,
  type OrderStatus,
  type VersionStatus,
} from '@trenchmart/shared/state';
import { TIERS, type Tier } from '@trenchmart/shared/tier';

/** Devnet program id from programs/trench_escrow/src/lib.rs. */
export const ESCROW_PROGRAM_ID = 'Dbrq2sACPk98FGzLihajJd4r2Q4jdKNn62GSURndv2kw';
export const ESCROW_CLUSTER = 'devnet';
/** Devnet deployment addresses (2026-10-17). /api/v1/transparency reads them live from chain. */
export const DEVNET_ADDRESSES = {
  multisig: 'CaatcAQaDTEsrSoC3maTP1kgBWEY66hhgBNKa8Aeg55B',
  vault: '47RLqPda5YLW7rFHkoJ2K5yACWu4qc7j2yYU2so64bz7',
  trenchMint: '8Gu4hXYypyRrxY6763AdhQnyHma82L3ww9wq3vy2cbq6',
} as const;
/** trenchmart.fun has no mail server yet, so contact goes through GitHub, which is real and public. */
export const CONTACT_URL = 'https://github.com/Milerius/trenchmart/issues';
export const CONTACT_LABEL = 'GitHub issues (github.com/Milerius/trenchmart)';
/** Private reports (security, personal data) go through a private GitHub advisory. */
export const PRIVATE_CONTACT_URL = 'https://github.com/Milerius/trenchmart/security/advisories/new';
export const AI_AGENT_ID = 'trenchmart-review-v1';
export const AI_ENGINE = 'rules@1.0.0+llm';
export const RULES_ENGINE = 'rules@1.0.0';
/**
 * Intended production model settings (LLM_MODEL, LLM_REASONING_EFFORT), used in copy only.
 * The live values are at /api/v1/transparency and on /verify; a given report may show a
 * rules-only review (model skipped or unavailable) or a different model.
 */
export const AI_MODEL = 'gpt-5.6-luna';
export const AI_REASONING_EFFORT = 'medium';
export const SCANNER_ENGINE = 'scanner@1.1.0';
/** Matches the `limit 15` payout batch in apps/api/src/logic.ts. */
export const PAYOUT_BATCH_LIMIT = 15;
export const CREATOR_COMMISSION_BPS = 0;
export const DOWNLOAD_URL_SECONDS = 300;

export const ESCROW_INSTRUCTIONS = [
  'initialize',
  'fund',
  'release',
  'expire',
  'open_dispute',
  'refund',
  'reject_dispute',
  'refund_after_timeout',
  'close',
  'init_config',
  'set_config',
] as const;

export const DISPUTE_REASONS = ['malicious', 'not_as_described', 'broken', 'other'] as const;

export const DOCS_NAV = [
  { href: '/docs', label: 'Overview' },
  { href: '/docs/buyers', label: 'Buyers' },
  { href: '/docs/sellers', label: 'Sellers' },
  { href: '/docs/escrow', label: 'Escrow program' },
  { href: '/docs/fees', label: 'Fees' },
  { href: '/docs/token', label: '$TRENCH' },
  { href: '/docs/treasury', label: 'Treasury' },
  { href: '/docs/security', label: 'Security' },
  { href: '/docs/faq', label: 'FAQ' },
] as const;

const TIER_LABEL: Record<Tier, string> = {
  none: 'No tier',
  scout: 'Scout',
  trencher: 'Trencher',
  og: 'OG',
};

const SPLIT_LABEL = {
  buyback: 'Buyback',
  ai_verification: 'Verification',
  ops: 'Ops',
  safety: 'Safety',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function bpsPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

export function solLabel(lamports: bigint): string {
  const text = formatSol(lamports, 9)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
  return `${text} SOL`;
}

/** Nominal buyer fee after the tier rebate. Same formula as the fee table. */
export function effectiveFeeBps(tier: Tier): number {
  const rebate = DEFAULT_CONFIG_JSON.tier_rebate_bps[tier];
  return (DEFAULT_CONFIG_JSON.fee_bps * (10_000 - rebate)) / 10_000;
}

export function ogBond(lamports: bigint): bigint {
  return (lamports * BigInt(10_000 - DEFAULT_CONFIG_JSON.og_bond_discount_bps)) / 10_000n;
}

export const marketplaceFeeLabel = bpsPercent(DEFAULT_CONFIG_JSON.fee_bps);

export const feeSplit = (Object.keys(SPLIT_LABEL) as (keyof typeof SPLIT_LABEL)[]).map((key) => ({
  key,
  label: SPLIT_LABEL[key],
  bps: DEFAULT_CONFIG_JSON.fee_split_bps[key],
  percent: bpsPercent(DEFAULT_CONFIG_JSON.fee_split_bps[key]),
}));

export const tierRows = TIERS.map((tier) => ({
  tier,
  label: TIER_LABEL[tier],
  rebateBps: DEFAULT_CONFIG_JSON.tier_rebate_bps[tier],
  rebateLabel:
    DEFAULT_CONFIG_JSON.tier_rebate_bps[tier] === 0
      ? '0%'
      : `${bpsPercent(DEFAULT_CONFIG_JSON.tier_rebate_bps[tier])} off the fee`,
  buyerFee: bpsPercent(effectiveFeeBps(tier)),
  threshold: tier === 'none' ? null : DEFAULT_CONFIG_JSON.tier_thresholds[tier],
}));

export const bonds = CATEGORIES.map((category) => {
  const lamports = BigInt(DEFAULT_CONFIG_JSON.bond_lamports_by_category[category.code]);
  return {
    code: category.code as CategoryCode,
    label: category.label,
    lamports,
    sol: solLabel(lamports),
    ogSol: solLabel(ogBond(lamports)),
  };
});

export const orderEdges = ORDER_STATUSES.flatMap((from) =>
  ORDER_STATUSES.filter((to) => canTransitionOrder(from, to)).map((to) => ({ from, to })),
);

export const versionEdges = VERSION_STATUSES.flatMap((from) =>
  VERSION_STATUSES.filter((to) => canTransitionVersion(from, to)).map((to) => ({ from, to })),
);

export const protocol = {
  contactUrl: CONTACT_URL,
  cluster: ESCROW_CLUSTER,
  programId: ESCROW_PROGRAM_ID,
  pdaSeeds: 'escrow + buyer + order id',
  marketplaceFeeBps: DEFAULT_CONFIG_JSON.fee_bps,
  marketplaceFeeLabel,
  creatorCommission: bpsPercent(CREATOR_COMMISSION_BPS),
  escrowHours: DEFAULT_CONFIG_JSON.escrow_hours,
  escrowWindow: escrowWindowLabel(DEFAULT_CONFIG_JSON.escrow_hours),
  orderTtlMinutes: DEFAULT_CONFIG_JSON.order_ttl_minutes,
  paymentGraceMinutes: PAYMENT_GRACE_MS / 60_000,
  maliciousDisputeDays: MALICIOUS_DISPUTE_MS / DAY_MS,
  verificationFee: solLabel(BigInt(DEFAULT_CONFIG_JSON.verification_fee_lamports)),
  verificationFeeLamports: DEFAULT_CONFIG_JSON.verification_fee_lamports,
  verificationFeeFreeFrom: DEFAULT_CONFIG_JSON.verification_fee_free_from_tier,
  ogBondDiscount: bpsPercent(DEFAULT_CONFIG_JSON.og_bond_discount_bps),
  bondUnlockDays: DEFAULT_CONFIG_JSON.bond_unlock_days,
  tierWindowHours: DEFAULT_CONFIG_JSON.tier_window_hours,
  maxFileDefault: `${DEFAULT_CONFIG_JSON.max_file_bytes.default / (1024 * 1024)} MiB`,
  maxFileSetup: `${DEFAULT_CONFIG_JSON.max_file_bytes.setup / (1024 * 1024)} MiB`,
  allowHosts: [...DEFAULT_CONFIG_JSON.require_allow_hosts],
  thresholds: { ...DEFAULT_CONFIG_JSON.tier_thresholds },
  payoutBatchLimit: PAYOUT_BATCH_LIMIT,
  downloadUrlSeconds: DOWNLOAD_URL_SECONDS,
  aiAgentId: AI_AGENT_ID,
  aiEngine: AI_ENGINE,
  rulesEngine: RULES_ENGINE,
  aiModel: AI_MODEL,
  aiReasoningEffort: AI_REASONING_EFFORT,
  scannerEngine: SCANNER_ENGINE,
  updateFreeDays: DEFAULT_CONFIG_JSON.update_free_days,
  updatePeriodDays: DEFAULT_CONFIG_JSON.update_period_days,
  updatePriceDefault: bpsPercent(DEFAULT_CONFIG_JSON.update_price_default_bps),
  updatesPerListingPerDay: DEFAULT_CONFIG_JSON.update_limit_per_listing_day,
  uploadsPerCreatorPerDay: DEFAULT_CONFIG_JSON.upload_limit_per_creator_day,
  uploadSupplement: solLabel(BigInt(DEFAULT_CONFIG_JSON.upload_supplement_lamports)),
  verifyFreePerDay: DEFAULT_CONFIG_JSON.verify_free_per_day,
  verifySupplement: solLabel(BigInt(DEFAULT_CONFIG_JSON.verify_supplement_lamports)),
};

export type OrderEdge = { from: OrderStatus; to: OrderStatus };
export type VersionEdge = { from: VersionStatus; to: VersionStatus };

/** Solana Explorer links, always pinned to devnet. */
export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${ESCROW_CLUSTER}`;
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${ESCROW_CLUSTER}`;
}

export function shortKey(value: string, head = 6, tail = 4): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}
