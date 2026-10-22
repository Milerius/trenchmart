/**
 * Both clusters at once, for the network menu (lazy chunk) and next.config.ts. Pages use
 * lib/cluster.ts, which carries only this build's cluster.
 */
import { DEVNET } from './cluster-devnet';
import { MAINNET } from './cluster-mainnet';
import { ENDPOINTS } from './cluster-endpoints';
import type { ClusterConfig, ClusterEndpoints, ClusterId } from './cluster-types';

export type { ClusterConfig, ClusterId };
export type FullCluster = ClusterConfig & ClusterEndpoints;

export const CLUSTERS: Record<ClusterId, FullCluster> = {
  devnet: { ...DEVNET, ...ENDPOINTS.devnet },
  mainnet: { ...MAINNET, ...ENDPOINTS.mainnet },
};

export function parseCluster(value: string | undefined): ClusterId {
  return value?.trim().toLowerCase() === 'mainnet' ? 'mainnet' : 'devnet';
}

export function parseFlag(value: string | undefined): boolean {
  return value?.trim() === '1';
}

/** Mainnet is selectable only once launched; a mainnet build before launch is refused. */
export function resolveCluster(env: {
  NEXT_PUBLIC_CLUSTER?: string;
  NEXT_PUBLIC_MAINNET_LAUNCHED?: string;
}): { cluster: FullCluster; mainnetLaunched: boolean } {
  const mainnetLaunched = parseFlag(env.NEXT_PUBLIC_MAINNET_LAUNCHED);
  const id = parseCluster(env.NEXT_PUBLIC_CLUSTER);
  if (id === 'mainnet' && !mainnetLaunched) {
    throw new Error('NEXT_PUBLIC_CLUSTER=mainnet needs NEXT_PUBLIC_MAINNET_LAUNCHED=1');
  }
  return { cluster: CLUSTERS[id], mainnetLaunched };
}

/** Where a cluster lives. Before launch the apex serves devnet, so devnet is just this site. */
export function clusterOrigin(id: ClusterId): string {
  return CLUSTERS[id].siteOrigin;
}

/** Same page on the other cluster's hostname (path and query kept). */
export function switchUrl(id: ClusterId, path: string, search = ''): string {
  return `${clusterOrigin(id)}${path.startsWith('/') ? path : `/${path}`}${search}`;
}
