/**
 * One place for everything that differs between Solana clusters. Each cluster is its own
 * deployment on its own hostname (devnet.trenchmart.fun, later trenchmart.fun for mainnet);
 * the build picks one with NEXT_PUBLIC_CLUSTER (default devnet). Nothing here is secret.
 *
 * Until mainnet launches (NEXT_PUBLIC_MAINNET_LAUNCHED=1 at build time), the apex
 * trenchmart.fun keeps serving the devnet site, so every existing link keeps working, and the
 * header shows Mainnet greyed out as "Coming soon". See docs/ops/networks.md.
 */
import { DEVNET } from './cluster-devnet';
import { MAINNET } from './cluster-mainnet';
import type { ClusterConfig } from './cluster-types';

export type { ClusterConfig, ClusterId } from './cluster-types';

// NEXT_PUBLIC_* are inlined at build time, so the other cluster's data is dropped from the
// bundle. next.config.ts runs resolveCluster() and refuses a mainnet build before launch.
/** The cluster this deployment runs on. */
export const CLUSTER: ClusterConfig =
  process.env.NEXT_PUBLIC_CLUSTER === 'mainnet' ? MAINNET : DEVNET;
export const MAINNET_LAUNCHED: boolean = process.env.NEXT_PUBLIC_MAINNET_LAUNCHED === '1';

/** `?cluster=devnet` off mainnet, nothing on mainnet (Solana Explorer and Solscan). */
export const explorerSuffix = (c: ClusterConfig = CLUSTER) =>
  c.explorerCluster ? `?cluster=${c.explorerCluster}` : '';

export const explorerAddressUrl = (address: string) =>
  `https://explorer.solana.com/address/${address}${explorerSuffix()}`;
export const explorerTxUrl = (signature: string) =>
  `https://explorer.solana.com/tx/${signature}${explorerSuffix()}`;
export const solscanTxUrl = (signature: string) =>
  `https://solscan.io/tx/${signature}${explorerSuffix()}`;

/**
 * True when the wallet account lists Solana chains and this site's chain is not among them.
 * Wallet Standard does not expose the wallet's *selected* network, so a wallet that lists
 * every chain is trusted; the server still refuses wrong-cluster transactions.
 */
export const chainMismatch = (chains?: readonly string[] | null, chain: string = CLUSTER.chain) =>
  !!chains?.some((c) => c.startsWith('solana:')) && !chains.includes(chain);
