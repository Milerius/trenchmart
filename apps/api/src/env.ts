import { assertSafeRpc, assertTestCluster, defaultRpc, type TestCluster } from '@trenchmart/shared';

export type Env = {
  appUrl: string;
  apiUrl: string;
  siwsDomain: string;
  siwsUri: string;
  sessionSecret: string;
  internalToken: string;
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
  /** Alert delivery (ops.ts). ntfy topic is a secret: anyone who knows it can read alerts. */
  alertNtfyServer: string;
  alertNtfyTopic: string;
  alertEmail: string;
  /** ntfy access token (free ntfy.sh account): required for email forwarding. */
  alertNtfyToken: string;
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
    sessionSecret: source.SESSION_SECRET || 'change-me-32-bytes-min',
    internalToken: source.INTERNAL_TOKEN || 'change-me',
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
    checkoutPaused: /^(1|true|yes)$/i.test(source.CHECKOUT_PAUSED ?? ''),
    proxySecret: blank(source.PROXY_SECRET),
    xClientId: blank(source.X_CLIENT_ID),
    xClientSecret: blank(source.X_CLIENT_SECRET),
    xApiUrl: blank(source.X_API_URL) || 'https://api.x.com',
    imageOptimize: source.IMAGE_OPTIMIZE === '1',
    alertNtfyServer: blank(source.ALERT_NTFY_SERVER) || 'https://ntfy.sh',
    alertNtfyTopic: blank(source.ALERT_NTFY_TOPIC),
    alertEmail: blank(source.ALERT_EMAIL),
    alertNtfyToken: blank(source.ALERT_NTFY_TOKEN),
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
