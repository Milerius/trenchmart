import { asBigint } from './money';
import { parseThresholds, type Tier, type TierThresholds } from './tier';

export const CATEGORY_CODES = [
  'userscript',
  'wallet_list',
  'filter',
  'setup',
  'strategy',
  'alerts',
] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export type AppConfig = {
  fee_bps: number;
  tier_rebate_bps: Record<Tier, number>;
  tier_thresholds_raw: { scout: string; trencher: string; og: string };
  /** Thresholds in base units (whole tokens × 10^trench_decimals), compared with balances. */
  tier_thresholds: TierThresholds;
  trench_decimals: number;
  tier_window_hours: number;
  fee_split_bps: Record<'buyback' | 'ai_verification' | 'ops' | 'safety', number>;
  escrow_hours: number;
  order_ttl_minutes: number;
  verification_fee_lamports: bigint;
  verification_fee_free_from_tier: Tier;
  bond_lamports_by_category: Record<CategoryCode, bigint>;
  og_bond_discount_bps: number;
  bond_unlock_days: number;
  terminals: string[];
  max_file_bytes: { default: number; setup: number };
  blocklist_hosts: string[];
  require_allow_hosts: string[];
  sandbox_targets: string[];
};

/**
 * Proposed defaults. Handlers read the `config` table; this object is the
 * seed and the typed fallback when a key is missing. Tier thresholds are whole
 * $TRENCH (1B supply, 6 decimals): Scout 100k, Trencher 1M, OG 10M. A value that is
 * not an integer string disables that tier.
 */
export const DEFAULT_CONFIG_JSON = {
  fee_bps: 500,
  tier_rebate_bps: { none: 0, scout: 2500, trencher: 6000, og: 10000 },
  tier_thresholds: { scout: '100000', trencher: '1000000', og: '10000000' },
  trench_decimals: 6,
  tier_window_hours: 72,
  fee_split_bps: { buyback: 4000, ai_verification: 2500, ops: 2000, safety: 1500 },
  escrow_hours: 48,
  order_ttl_minutes: 20,
  verification_fee_lamports: 250000000,
  verification_fee_free_from_tier: 'trencher',
  bond_lamports_by_category: {
    userscript: 5000000000,
    alerts: 5000000000,
    setup: 5000000000,
    wallet_list: 2000000000,
    filter: 1000000000,
    strategy: 1000000000,
  },
  og_bond_discount_bps: 5000,
  bond_unlock_days: 30,
  terminals: ['Axiom', 'GMGN', 'Photon', 'Terminal', 'Trojan', 'Any'],
  max_file_bytes: { default: 5242880, setup: 26214400 },
  blocklist_hosts: [],
  require_allow_hosts: ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'],
  sandbox_targets: ['https://axiom.trade/pulse', 'https://gmgn.ai/?chain=sol'],
} as const;

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function big(v: unknown, fallback: bigint): bigint {
  try {
    if (v === undefined || v === null) return fallback;
    return asBigint(v as string | number | bigint);
  } catch {
    return fallback;
  }
}

/** Whole-token thresholds → base units, so they compare with on-chain balances. */
export function toBaseUnits(t: TierThresholds, decimals: number): TierThresholds {
  const scale = 10n ** BigInt(Math.max(0, Math.min(18, decimals)));
  const scaled = (v: bigint | undefined) => (v === undefined ? undefined : v * scale);
  return { scout: scaled(t.scout), trencher: scaled(t.trencher), og: scaled(t.og) };
}

export function parseAppConfig(
  rows: Record<string, unknown>,
  escrowHoursOverride?: string,
): AppConfig {
  const d = DEFAULT_CONFIG_JSON;
  const rebate = {
    ...d.tier_rebate_bps,
    ...((rows.tier_rebate_bps as object) ?? {}),
  } as Record<Tier, number>;
  const thresholdsRaw = {
    ...d.tier_thresholds,
    ...((rows.tier_thresholds as object) ?? {}),
  };
  const split = {
    ...d.fee_split_bps,
    ...((rows.fee_split_bps as object) ?? {}),
  } as AppConfig['fee_split_bps'];
  const bondsRaw = {
    ...d.bond_lamports_by_category,
    ...((rows.bond_lamports_by_category as object) ?? {}),
  } as Record<string, unknown>;
  const bonds = {} as Record<CategoryCode, bigint>;
  for (const code of CATEGORY_CODES) {
    bonds[code] = big(bondsRaw[code], BigInt(d.bond_lamports_by_category[code]));
  }
  const maxRaw = {
    ...d.max_file_bytes,
    ...((rows.max_file_bytes as object) ?? {}),
  } as { default?: unknown; setup?: unknown };

  let escrow = num(rows.escrow_hours, d.escrow_hours);
  if (escrowHoursOverride && escrowHoursOverride.trim()) {
    const n = Number(escrowHoursOverride);
    if (Number.isFinite(n) && n >= 0) escrow = n;
  }

  const decimals = Math.trunc(num(rows.trench_decimals, d.trench_decimals));

  const free = String(rows.verification_fee_free_from_tier ?? d.verification_fee_free_from_tier);
  const freeTier: Tier =
    free === 'scout' || free === 'trencher' || free === 'og' || free === 'none' ? free : 'trencher';

  return {
    fee_bps: num(rows.fee_bps, d.fee_bps),
    tier_rebate_bps: {
      none: num(rebate.none, 0),
      scout: num(rebate.scout, 2500),
      trencher: num(rebate.trencher, 6000),
      og: num(rebate.og, 10000),
    },
    tier_thresholds_raw: {
      scout: String(thresholdsRaw.scout),
      trencher: String(thresholdsRaw.trencher),
      og: String(thresholdsRaw.og),
    },
    tier_thresholds: toBaseUnits(
      parseThresholds({
        scout: thresholdsRaw.scout,
        trencher: thresholdsRaw.trencher,
        og: thresholdsRaw.og,
      }),
      decimals,
    ),
    trench_decimals: decimals,
    tier_window_hours: num(rows.tier_window_hours, d.tier_window_hours),
    fee_split_bps: {
      buyback: num(split.buyback, 4000),
      ai_verification: num(split.ai_verification, 2500),
      ops: num(split.ops, 2000),
      safety: num(split.safety, 1500),
    },
    escrow_hours: escrow,
    order_ttl_minutes: num(rows.order_ttl_minutes, d.order_ttl_minutes),
    verification_fee_lamports: big(
      rows.verification_fee_lamports,
      BigInt(d.verification_fee_lamports),
    ),
    verification_fee_free_from_tier: freeTier,
    bond_lamports_by_category: bonds,
    og_bond_discount_bps: num(rows.og_bond_discount_bps, d.og_bond_discount_bps),
    bond_unlock_days: num(rows.bond_unlock_days, d.bond_unlock_days),
    terminals: Array.isArray(rows.terminals) ? (rows.terminals as string[]) : [...d.terminals],
    max_file_bytes: {
      default: num(maxRaw.default, d.max_file_bytes.default),
      setup: num(maxRaw.setup, d.max_file_bytes.setup),
    },
    blocklist_hosts: Array.isArray(rows.blocklist_hosts)
      ? (rows.blocklist_hosts as string[])
      : [...d.blocklist_hosts],
    require_allow_hosts: Array.isArray(rows.require_allow_hosts)
      ? (rows.require_allow_hosts as string[])
      : [...d.require_allow_hosts],
    sandbox_targets: Array.isArray(rows.sandbox_targets)
      ? (rows.sandbox_targets as string[])
      : [...d.sandbox_targets],
  };
}
