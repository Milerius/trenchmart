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
