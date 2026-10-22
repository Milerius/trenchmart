import { DEVNET } from '../apps/web/src/lib/cluster-devnet';

/**
 * On-chain addresses the e2e suite expects the site to show. They come from the web cluster
 * config (one source of truth), and each can be overridden so the same specs run against
 * another deployment: E2E_MART_MINT, E2E_ESCROW_PROGRAM_ID, E2E_MULTISIG,
 * E2E_EXPLORER_CLUSTER.
 */
export function e2eAddresses(env: Record<string, string | undefined> = process.env) {
  const pick = (name: string, fallback: string) => env[name]?.trim() || fallback;
  return {
    martMint: pick('E2E_MART_MINT', DEVNET.martMint),
    program: pick('E2E_ESCROW_PROGRAM_ID', DEVNET.escrowProgramId),
    multisig: pick('E2E_MULTISIG', DEVNET.multisig),
    // Explorer `?cluster=` value; empty for mainnet (E2E_EXPLORER_CLUSTER=).
    explorerCluster: env.E2E_EXPLORER_CLUSTER ?? DEVNET.explorerCluster,
  };
}

export const E2E_ADDRESSES = e2eAddresses();
