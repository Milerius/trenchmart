import { describe, expect, it } from 'vitest';
import { assertDeployedEnv, InsecureConfigError, isLocalAppUrl, readEnv, weakSecrets } from './env';

const strong = 'a'.repeat(64);
const good = {
  APP_URL: 'https://trenchmart.fun',
  SESSION_SECRET: strong,
  INTERNAL_TOKEN: strong,
  HELIUS_WEBHOOK_SECRET: strong,
  AI_ATTEST_SECRET: strong,
};

describe('H-01 fail-closed secrets', () => {
  it('treats localhost as local and real domains as production', () => {
    expect(isLocalAppUrl(undefined)).toBe(true);
    expect(isLocalAppUrl('http://localhost:3000')).toBe(true);
    expect(isLocalAppUrl('http://[::1]:3000')).toBe(true);
    expect(() => assertDeployedEnv({})).toThrow(InsecureConfigError);
    expect(() => assertDeployedEnv({ APP_URL: 'https://trenchmart.fun' })).not.toThrow();
    expect(isLocalAppUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isLocalAppUrl('https://trenchmart.fun')).toBe(false);
  });

  it('accepts strong secrets in production', () => {
    expect(() => readEnv(good)).not.toThrow();
  });

  it.each(['SESSION_SECRET', 'INTERNAL_TOKEN', 'HELIUS_WEBHOOK_SECRET', 'AI_ATTEST_SECRET'])(
    'refuses a missing, default or short %s in production',
    (name) => {
      for (const bad of [undefined, '', 'change-me', 'change-me-32-bytes-min', 'short']) {
        const source = { ...good, [name]: bad };
        expect(weakSecrets(source)).toEqual([name]);
        expect(() => readEnv(source)).toThrow(InsecureConfigError);
      }
    },
  );

  it('never puts secret values in the error', () => {
    try {
      readEnv({ ...good, SESSION_SECRET: 'change-me' });
    } catch (error) {
      expect(String(error)).toContain('SESSION_SECRET');
      expect(String(error)).not.toContain(strong);
    }
  });

  it('keeps dev defaults working on localhost', () => {
    expect(() => readEnv({ APP_URL: 'http://localhost:3000' })).not.toThrow();
  });
});

describe('$MART mint config', () => {
  it('reads MART_MINT and accepts TRENCH_MINT as a one-release alias', () => {
    expect(readEnv({ MART_MINT: 'Mart111' }).martMint).toBe('Mart111');
    expect(readEnv({ TRENCH_MINT: 'Old111' }).martMint).toBe('Old111');
    expect(readEnv({ MART_MINT: 'Mart111', TRENCH_MINT: 'Old111' }).martMint).toBe('Mart111');
  });
});

describe('mainnet RPC', () => {
  const mainnet = { ...good, SOLANA_CLUSTER: 'mainnet', MAINNET_LAUNCHED: '1' };

  it('still refuses mainnet before launch', () => {
    expect(() => readEnv({ ...good, SOLANA_CLUSTER: 'mainnet' })).toThrow(/Refusing/);
    expect(() =>
      readEnv({
        ...good,
        SOLANA_CLUSTER: 'mainnet',
        HELIUS_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=k',
      }),
    ).toThrow(/Refusing/);
  });

  it('requires SOLANA_RPC_URL or HELIUS_RPC_URL, never the public endpoint', () => {
    expect(() => readEnv(mainnet)).toThrow(/private RPC/);
    expect(() =>
      readEnv({ ...mainnet, SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }),
    ).toThrow(/public mainnet-beta/);
    const env = readEnv({
      ...mainnet,
      HELIUS_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=k',
    });
    expect(env.cluster).toBe('mainnet');
    expect(env.rpcUrl).toBe('https://mainnet.helius-rpc.com/?api-key=k');
  });

  it('keeps devnet defaults', () => {
    expect(readEnv(good).rpcUrl).toBe('https://api.devnet.solana.com');
  });
});
