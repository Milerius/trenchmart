export const TEST_CLUSTERS = ['devnet', 'testnet', 'localnet'] as const;
export type TestCluster = (typeof TEST_CLUSTERS)[number];

/** Development and verification never touch mainnet. */
export function assertTestCluster(cluster: string): TestCluster {
  const c = cluster.trim().toLowerCase();
  if (c === 'mainnet' || c === 'mainnet-beta') {
    throw new Error(
      `Refusing Solana cluster "${cluster}". Trenchmart development and verification run only on devnet, testnet, or a local validator.`,
    );
  }
  if (c === 'devnet' || c === 'testnet' || c === 'localnet') return c;
  throw new Error(`Unknown Solana cluster "${cluster}". Use devnet, testnet, or localnet.`);
}

export function assertSafeRpc(url: string): void {
  const u = url.toLowerCase();
  if (u.includes('mainnet')) {
    throw new Error(`Refusing mainnet RPC URL: ${url}`);
  }
}

export function defaultRpc(cluster: TestCluster, heliusRpc?: string): string {
  if (heliusRpc && heliusRpc.trim()) {
    assertSafeRpc(heliusRpc);
    return heliusRpc;
  }
  if (cluster === 'localnet') return 'http://127.0.0.1:8899';
  if (cluster === 'testnet') return 'https://api.testnet.solana.com';
  return 'https://api.devnet.solana.com';
}

export type Cluster = TestCluster | 'mainnet';

/** Public mainnet RPC hosts: rate limited and they refuse `getProgramAccounts` on token mints. */
const PUBLIC_MAINNET_RPC = ['api.mainnet-beta.solana.com', 'api.mainnet.solana.com'];

/**
 * Cluster from `SOLANA_CLUSTER`. Mainnet is accepted only when the deployment opts in with
 * `MAINNET_LAUNCHED=1`; everything else (dev, CI, devnet Workers) still refuses it.
 */
export function parseCluster(cluster: string, opts: { mainnetLaunched?: boolean } = {}): Cluster {
  const c = cluster.trim().toLowerCase();
  if ((c === 'mainnet' || c === 'mainnet-beta') && opts.mainnetLaunched) return 'mainnet';
  return assertTestCluster(cluster);
}

export class MainnetRpcRequiredError extends Error {
  constructor(reason: string) {
    super(`mainnet needs a private RPC (SOLANA_RPC_URL or HELIUS_RPC_URL): ${reason}`);
    this.name = 'MainnetRpcRequiredError';
  }
}

/**
 * RPC URL for a cluster. Test clusters keep their public defaults and refuse mainnet URLs.
 * Mainnet has no default: SOLANA_RPC_URL or HELIUS_RPC_URL must be set, and the public
 * mainnet-beta endpoint is refused (it cannot serve the holder-rewards getProgramAccounts).
 */
export function resolveRpc(
  cluster: Cluster,
  urls: { explicit?: string | null; helius?: string | null },
): string {
  const explicit = urls.explicit?.trim() || '';
  const helius = urls.helius?.trim() || '';
  if (cluster !== 'mainnet') {
    const url = explicit || defaultRpc(cluster, helius || undefined);
    assertSafeRpc(url);
    return url;
  }
  const url = explicit || helius;
  if (!url) throw new MainnetRpcRequiredError('none set');
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new MainnetRpcRequiredError('must be https');
    host = u.hostname.toLowerCase();
  } catch (err) {
    if (err instanceof MainnetRpcRequiredError) throw err;
    throw new MainnetRpcRequiredError('not a URL');
  }
  if (PUBLIC_MAINNET_RPC.includes(host)) {
    throw new MainnetRpcRequiredError('the public mainnet-beta endpoint is not allowed');
  }
  if (/devnet|testnet/.test(host)) throw new MainnetRpcRequiredError('URL names another cluster');
  return url;
}
