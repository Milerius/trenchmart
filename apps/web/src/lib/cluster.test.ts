import { describe, expect, it } from 'vitest';
import {
  CLUSTER,
  chainMismatch,
  explorerAddressUrl,
  explorerSuffix,
  MAINNET_LAUNCHED,
  solscanTxUrl,
} from './cluster';
import { CLUSTERS, resolveCluster, switchUrl } from './clusters';

describe('cluster config', () => {
  it('defaults to devnet with mainnet not launched', () => {
    expect(CLUSTER.id).toBe('devnet');
    expect(MAINNET_LAUNCHED).toBe(false);
    expect(resolveCluster({}).cluster.id).toBe('devnet');
  });

  it('refuses a mainnet build before launch', () => {
    expect(() => resolveCluster({ NEXT_PUBLIC_CLUSTER: 'mainnet' })).toThrow(/LAUNCHED/);
    expect(
      resolveCluster({ NEXT_PUBLIC_CLUSTER: 'mainnet', NEXT_PUBLIC_MAINNET_LAUNCHED: '1' }).cluster
        .id,
    ).toBe('mainnet');
  });

  it('builds explorer links with the cluster param only off mainnet', () => {
    expect(solscanTxUrl('sig')).toBe('https://solscan.io/tx/sig?cluster=devnet');
    expect(explorerSuffix(CLUSTERS.mainnet)).toBe('');
    expect(explorerAddressUrl('a')).toBe('https://explorer.solana.com/address/a?cluster=devnet');
  });

  it('switches hostname and keeps path and query', () => {
    expect(switchUrl('devnet', '/l/x', '?a=1')).toBe('https://trenchmart.fun/l/x?a=1');
  });

  it('flags a wallet whose account lacks this cluster, trusts unknown or multi-chain', () => {
    expect(chainMismatch(['solana:mainnet'])).toBe(true);
    expect(chainMismatch(['solana:devnet', 'solana:mainnet'])).toBe(false);
    expect(chainMismatch([])).toBe(false);
    expect(chainMismatch(undefined)).toBe(false);
    expect(chainMismatch(['solana:devnet'], 'solana:mainnet')).toBe(true);
  });
});
