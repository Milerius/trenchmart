/**
 * Shape of one cluster's config. On-chain facts the pages need (cluster-devnet.ts,
 * cluster-mainnet.ts) are kept apart from endpoints (cluster-endpoints.ts) so the client bundle
 * carries only what it uses; lib/clusters.ts joins both.
 */
export type ClusterId = 'devnet' | 'mainnet';

export type ClusterConfig = {
  id: ClusterId;
  label: string;
  /** Wallet Standard chain id the wallet must sign for. */
  chain: 'solana:devnet' | 'solana:mainnet';
  /** `?cluster=` value for explorer links; empty on mainnet. */
  explorerCluster: string;
  escrowProgramId: string;
  multisig: string;
  vault: string;
  martMint: string;
};

/** Hostnames and endpoints (lib/cluster-endpoints.ts): server, docs and the network menu only. */
export type ClusterEndpoints = {
  /** Canonical site origin for this cluster. */
  siteOrigin: string;
  /** Public API base (the site itself proxies /api/v1 same-origin to it). */
  apiBase: string;
  /** Public RPC shown to agents and used for read-only proofs. */
  rpc: string;
  squadsProgramId: string;
  /** One-line hint about test vs real money. */
  note: string;
};
