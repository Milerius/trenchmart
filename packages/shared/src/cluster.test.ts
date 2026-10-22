import { describe, expect, it } from 'vitest';
import { MainnetRpcRequiredError, parseCluster, resolveRpc } from './cluster';

describe('parseCluster', () => {
  it('refuses mainnet unless the deployment is launched', () => {
    expect(() => parseCluster('mainnet')).toThrow(/Refusing/);
    expect(() => parseCluster('mainnet-beta', { mainnetLaunched: false })).toThrow(/Refusing/);
    expect(parseCluster('mainnet', { mainnetLaunched: true })).toBe('mainnet');
    expect(parseCluster('mainnet-beta', { mainnetLaunched: true })).toBe('mainnet');
    expect(parseCluster('devnet', { mainnetLaunched: true })).toBe('devnet');
  });
});

describe('resolveRpc', () => {
  it('keeps the public devnet default', () => {
    expect(resolveRpc('devnet', {})).toBe('https://api.devnet.solana.com');
    expect(resolveRpc('devnet', { helius: 'https://devnet.helius-rpc.com/?api-key=k' })).toContain(
      'devnet.helius',
    );
    expect(() => resolveRpc('devnet', { explicit: 'https://mainnet.helius-rpc.com/' })).toThrow();
  });

  it('requires a private RPC on mainnet, with no public fallback', () => {
    expect(() => resolveRpc('mainnet', {})).toThrow(MainnetRpcRequiredError);
    expect(() => resolveRpc('mainnet', { explicit: ' ', helius: '' })).toThrow(
      MainnetRpcRequiredError,
    );
    expect(() =>
      resolveRpc('mainnet', { explicit: 'https://api.mainnet-beta.solana.com' }),
    ).toThrow(/public mainnet-beta/);
    expect(() => resolveRpc('mainnet', { helius: 'http://mainnet.helius-rpc.com/' })).toThrow(
      /https/,
    );
    expect(() => resolveRpc('mainnet', { helius: 'https://devnet.helius-rpc.com/' })).toThrow(
      /another cluster/,
    );
    expect(() => resolveRpc('mainnet', { helius: 'not a url' })).toThrow(/not a URL/);
  });

  it('prefers SOLANA_RPC_URL over HELIUS_RPC_URL on mainnet', () => {
    expect(
      resolveRpc('mainnet', {
        explicit: 'https://rpc.example.com/x',
        helius: 'https://mainnet.helius-rpc.com/?api-key=k',
      }),
    ).toBe('https://rpc.example.com/x');
    expect(resolveRpc('mainnet', { helius: 'https://mainnet.helius-rpc.com/?api-key=k' })).toBe(
      'https://mainnet.helius-rpc.com/?api-key=k',
    );
  });
});
