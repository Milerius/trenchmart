import { describe, expect, it } from 'vitest';
import {
  MainnetRpcRequiredError,
  assertSafeRpc,
  parseCluster,
  redactSecrets,
  resolveRpc,
} from './cluster';

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
    expect(() =>
      resolveRpc('mainnet', { explicit: 'https://API.mainnet-beta.solana.com./' }),
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

describe('mainnet RPC guard', () => {
  const key = 'secret-key-123';
  const helius = `https://mainnet.helius-rpc.com/?api-key=${key}`;

  it('devnet refuses a mainnet URL and never echoes the api-key', () => {
    const other = `https://mainnet.helius-rpc.com/?api-key=${key}-other`;
    expect(() => assertSafeRpc(other)).toThrow(
      /Refusing mainnet RPC URL: https:\/\/mainnet\.helius-rpc\.com$/,
    );
    try {
      assertSafeRpc(other);
    } catch (err) {
      expect((err as Error).message).not.toContain(key);
    }
    expect(() => resolveRpc('devnet', { helius: other })).toThrow(/Refusing/);
  });

  it('a mainnet deployment accepts its Helius mainnet URL in the RPC layer', () => {
    expect(resolveRpc('mainnet', { helius })).toBe(helius);
    expect(() => assertSafeRpc(helius)).not.toThrow();
  });

  it('redacts URLs and api keys in free text', () => {
    const out = redactSecrets(`fetch ${helius} failed; api-key=${key}`);
    expect(out).not.toContain(key);
    expect(out).toContain('https://mainnet.helius-rpc.com');
  });
});
