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
