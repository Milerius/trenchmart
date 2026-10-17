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
  llm: { baseUrl: string; apiKey: string; model: string };
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

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
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
