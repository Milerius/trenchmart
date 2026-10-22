import { assertSafeRpc, assertTestCluster, defaultRpc, type TestCluster } from '@trenchmart/shared';

export type Env = {
  appUrl: string;
  apiUrl: string;
  siwsDomain: string;
  siwsUri: string;
  /**
   * Extra hostnames that serve this same deployment (SIWS_EXTRA_DOMAINS, comma separated, e.g.
   * devnet.trenchmart.fun). A wallet only shows a sign-in whose domain matches the page, so a
   * sign-in started on one of these names that host instead of SIWS_DOMAIN.
   */
  siwsExtraDomains: string[];
  sessionSecret: string;
  internalToken: string;
  /** Lets the external watchdog push its checks for the status page (status.ts). '' = off. */
  statusPushToken: string;
  cluster: TestCluster;
  rpcUrl: string;
  webhookSecret: string;
  vaultAddress: string;
  trenchMint: string;
  buckets: {
    buyback: string;
    ai_verification: string;
    ops: string;
    safety: string;
  };
  aiAgentId: string;
  aiVerifierUrl: string;
  aiAttestSecret: string;
  /** OpenAI-compatible model for the review step. All three must be set or the rules engine runs alone. */
  llm: { baseUrl: string; apiKey: string; model: string; reasoningEffort: string };
  /** Ed25519 secret (base58 or JSON array) that signs public scan reports. */
  reportSigningKey: string;
  /** Squads multisig config account that controls the treasury vault. */
  multisigAddress: string;
  blobDir: string;
  escrowHoursOverride: string;
  rateLimitPerMin: number;
  sandboxMode: 'inline' | 'external';
  sandboxRunnerUrl: string;
  sandboxBudgetMs: number;
  landingStats: 'auto' | 'mock' | 'real';
  solUsdOverride: string;
  /** trench_escrow program. Empty keeps the legacy vault-transfer checkout (dev only). */
  /** Optional ClamAV REST shim; see packages/scanner/src/av.ts. */
  clamavUrl: string;
  clamavToken: string;
  escrowProgramId: string;
  /** Resolver pubkey stored in every escrow; must match the secret when both are set. */
  escrowResolver: string;
  /** Resolver secret key (JSON array or base58). Signs release, refund, reject_dispute. */
  escrowResolverSecret: string;
  /** Deployed trench_escrow version: 2 adds the config PDA, buyer-keyed seeds, resolver freeze. */
  escrowProgramVersion: 1 | 2;
  /** Low-value fee payer for escrow txs (M-02). Falls back to the resolver when unset. */
  escrowCrankSecret: string;
  /**
   * Automated payouts (docs/ops/payouts.md): a hot key that is only a member of one Squads
   * spending limit. Empty secret or spending limit, or PAYOUTS_AUTO=0, keeps manual batches.
   */
  payout: {
    enabled: boolean;
    signerSecret: string;
    spendingLimit: string;
    maxLineLamports: bigint;
    dailyCapLamports: bigint;
  };
  /** Kill switch: when true, POST /orders returns 503 (mainnet readiness #18). */
  checkoutPaused: boolean;
  /** Shared secret the web proxy sends with the real client IP (M-03). */
  proxySecret: string;
  /** X OAuth 2.0 app (M-04). Empty: only the devnet-only unverified handle link works. */
  xClientId: string;
  xClientSecret: string;
  /** X API origin for the OAuth token exchange and /2/users/me. Tests point it at a mock. */
  xApiUrl: string;
  /** Server-side wasm WebP re-encode at upload (CPU heavy; off unless IMAGE_OPTIMIZE=1). */
  imageOptimize: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  alertWebhookUrl: string;
  /** Expected escrow program upgrade authority; a change raises UPGRADE_AUTHORITY_CHANGED. */
  expectedUpgradeAuthority: string;
  r2: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null;
};

function sandboxBudget(value: string | undefined): number {
  const parsed = Number(value || 15_000);
  if (!Number.isFinite(parsed)) return 15_000;
  return Math.min(20_000, Math.max(10_000, Math.round(parsed)));
}

function blank(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.includes('${')) return '';
  return trimmed;
}

const SECRET_NAMES = [
  'SESSION_SECRET',
  'INTERNAL_TOKEN',
  'HELIUS_WEBHOOK_SECRET',
  'AI_ATTEST_SECRET',
] as const;
const KNOWN_DEFAULTS = new Set([
  'change-me',
  'change-me-32-bytes-min',
  'changeme',
  'secret',
  'dev',
]);

/**
 * A deployed Worker must name its APP_URL: a missing one would otherwise count as local and
 * skip the secret checks (CodeRabbit, PR #36). Called by worker.ts before readEnv.
 */
export function assertDeployedEnv(source: Record<string, string | undefined>): void {
  if (!blank(source.APP_URL)) throw new InsecureConfigError(['APP_URL']);
}

/** True when APP_URL points at a local machine (dev, tests, CI). */
export function isLocalAppUrl(appUrl: string | undefined): boolean {
  const value = blank(appUrl);
  if (!value) return true;
  try {
    const host = new URL(value).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

/**
 * H-01: names of security secrets that are missing, a known default, or shorter than 32 bytes.
 * Never returns values.
 */
export function weakSecrets(source: Record<string, string | undefined>): string[] {
  return SECRET_NAMES.filter((name) => {
    const value = source[name]?.trim() ?? '';
    return (
      !value ||
      KNOWN_DEFAULTS.has(value.toLowerCase()) ||
      /change-?me/i.test(value) ||
      value.length < 32
    );
  });
}

export class InsecureConfigError extends Error {
  constructor(readonly names: string[]) {
    super(`refusing to start: weak or missing secrets: ${names.join(', ')}`);
    this.name = 'InsecureConfigError';
  }
}

/** Fail closed on any non-local deployment whose secrets are unset or defaults. */
export function assertProductionSecrets(source: Record<string, string | undefined>): void {
  if (isLocalAppUrl(source.APP_URL)) return;
  const weak = weakSecrets(source);
  if (weak.length) throw new InsecureConfigError(weak);
}

function lamportsEnv(value: string | undefined, fallback: bigint): bigint {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (!/^\d{1,19}$/.test(raw)) throw new Error('payout caps must be whole lamports');
  return BigInt(raw);
}

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  assertProductionSecrets(source);
  const cluster = assertTestCluster(source.SOLANA_CLUSTER || 'devnet');
  const helius = blank(source.HELIUS_RPC_URL);
  const explicit = blank(source.SOLANA_RPC_URL);
  const rpcUrl = explicit || defaultRpc(cluster, helius || undefined);
  assertSafeRpc(rpcUrl);
  const accountId = blank(source.CF_ACCOUNT_ID);
  const accessKeyId = blank(source.R2_ACCESS_KEY_ID);
  const secretAccessKey = blank(source.R2_SECRET_ACCESS_KEY);
  return {
    appUrl: blank(source.APP_URL) || 'http://localhost:3000',
    apiUrl: blank(source.API_URL) || 'http://localhost:8787',
    siwsDomain: blank(source.SIWS_DOMAIN) || 'localhost:3000',
    siwsUri: blank(source.APP_URL) || 'http://localhost:3000',
    siwsExtraDomains: (blank(source.SIWS_EXTRA_DOMAINS) ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => /^[a-z0-9.-]+(:\d+)?$/.test(d)),
    sessionSecret: source.SESSION_SECRET || 'change-me-32-bytes-min',
    internalToken: source.INTERNAL_TOKEN || 'change-me',
    // Ignored unless it is a real secret (32+ chars), so a blank or default never opens the route.
    statusPushToken:
      (source.STATUS_PUSH_TOKEN?.trim().length ?? 0) >= 32 &&
      !/change-?me/i.test(source.STATUS_PUSH_TOKEN ?? '')
        ? source.STATUS_PUSH_TOKEN!.trim()
        : '',
    cluster,
    rpcUrl,
    webhookSecret: source.HELIUS_WEBHOOK_SECRET || 'change-me',
    vaultAddress: blank(source.VAULT_ADDRESS),
    trenchMint: blank(source.TRENCH_MINT),
    buckets: {
      buyback: blank(source.BUCKET_WALLET_BUYBACK),
      ai_verification: blank(source.BUCKET_WALLET_AI_VERIFICATION),
      ops: blank(source.BUCKET_WALLET_OPS),
      safety: blank(source.BUCKET_WALLET_SAFETY),
    },
    aiAgentId: blank(source.AI_AGENT_ID) || 'trenchmart-review-v1',
    aiVerifierUrl: blank(source.AI_VERIFIER_URL),
    aiAttestSecret: source.AI_ATTEST_SECRET || 'change-me',
    llm: {
      baseUrl: blank(source.LLM_BASE_URL) || 'https://api.x.ai/v1',
      apiKey: blank(source.LLM_API_KEY),
      model: blank(source.LLM_MODEL),
      reasoningEffort: blank(source.LLM_REASONING_EFFORT),
    },
    reportSigningKey: blank(source.REPORT_SIGNING_KEY),
    multisigAddress: blank(source.MULTISIG_ADDRESS),
    blobDir: blank(source.BLOB_DIR) || '.data/blobs',
    escrowHoursOverride: source.ESCROW_HOURS_OVERRIDE ?? '',
    rateLimitPerMin: Number(source.RATE_LIMIT_PER_MIN || 120),
    sandboxMode: source.SANDBOX_MODE === 'external' ? 'external' : 'inline',
    sandboxRunnerUrl: blank(source.SANDBOX_RUNNER_URL),
    sandboxBudgetMs: sandboxBudget(source.SANDBOX_BUDGET_MS),
    landingStats:
      source.LANDING_STATS === 'mock' || source.LANDING_STATS === 'real'
        ? source.LANDING_STATS
        : 'auto',
    solUsdOverride: blank(source.SOL_USD_OVERRIDE),
    clamavUrl: blank(source.CLAMAV_URL),
    clamavToken: blank(source.CLAMAV_TOKEN),
    escrowProgramId: blank(source.ESCROW_PROGRAM_ID),
    escrowResolver: blank(source.ESCROW_RESOLVER),
    escrowResolverSecret: blank(source.ESCROW_RESOLVER_SECRET),
    escrowProgramVersion: source.ESCROW_PROGRAM_VERSION === '2' ? 2 : 1,
    escrowCrankSecret: blank(source.ESCROW_CRANK_SECRET),
    payout: {
      enabled: !/^(0|false|no|off)$/i.test(source.PAYOUTS_AUTO ?? ''),
      signerSecret: blank(source.PAYOUT_SIGNER_SECRET),
      spendingLimit: blank(source.PAYOUT_SPENDING_LIMIT),
      maxLineLamports: lamportsEnv(source.PAYOUT_MAX_LINE_LAMPORTS, 500_000_000n),
      dailyCapLamports: lamportsEnv(source.PAYOUT_DAILY_CAP_LAMPORTS, 3_000_000_000n),
    },
    checkoutPaused: /^(1|true|yes)$/i.test(source.CHECKOUT_PAUSED ?? ''),
    proxySecret: blank(source.PROXY_SECRET),
    xClientId: blank(source.X_CLIENT_ID),
    xClientSecret: blank(source.X_CLIENT_SECRET),
    xApiUrl: blank(source.X_API_URL) || 'https://api.x.com',
    imageOptimize: source.IMAGE_OPTIMIZE === '1',
    telegramBotToken: blank(source.TELEGRAM_BOT_TOKEN),
    telegramChatId: blank(source.TELEGRAM_CHAT_ID),
    alertWebhookUrl: blank(source.ALERT_WEBHOOK_URL),
    expectedUpgradeAuthority: blank(source.EXPECTED_UPGRADE_AUTHORITY),
    r2:
      accountId && accessKeyId && secretAccessKey
        ? {
            accountId,
            bucket: blank(source.R2_BUCKET) || 'trenchmart-files',
            accessKeyId,
            secretAccessKey,
          }
        : null,
  };
}
