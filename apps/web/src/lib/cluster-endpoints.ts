import type { ClusterEndpoints, ClusterId } from './cluster-types';

const SQUADS_V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

/** Where each cluster's site, API and RPC live (docs/ops/networks.md). */
export const ENDPOINTS: Record<ClusterId, ClusterEndpoints> = {
  devnet: {
    siteOrigin: 'https://trenchmart.fun',
    apiBase: 'https://api.trenchmart.fun/api/v1',
    rpc: 'https://api.devnet.solana.com',
    squadsProgramId: SQUADS_V4,
    note: 'test SOL only',
  },
  // Live on its own host; trenchmart.fun stays devnet until the owner moves the default.
  mainnet: {
    siteOrigin: 'https://mainnet.trenchmart.fun',
    apiBase: 'https://api.mainnet.trenchmart.fun/api/v1',
    rpc: 'https://api.mainnet-beta.solana.com',
    squadsProgramId: SQUADS_V4,
    note: 'real SOL',
  },
};
