import { describe, expect, it } from 'vitest';
import { hitLimit, ipKey, LIMITS, limitersFrom } from './limits';
import type { Deps } from './logic';

describe('ipKey', () => {
  it('keeps IPv4 as is and keys IPv6 by its /64', () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0db8:0001:0002:0:0:0:ffff')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
    // Two addresses in one /64 share a bucket; another /64 does not.
    expect(ipKey('2001:db8:1:2::a')).toBe(ipKey('2001:db8:1:2:ffff::b'));
    expect(ipKey('2001:db8:1:3::a')).not.toBe(ipKey('2001:db8:1:2::a'));
    expect(ipKey('local')).toBe('local');
  });
});

describe('limiters', () => {
  it('reads only real bindings off the Worker env', () => {
    const binding = { limit: async () => ({ success: true }) };
    const out = limitersFrom({ TX_SEND_LIMITER: binding, OTHER: binding, RATE_LIMITER: 'x' });
    expect(out.txSend).toBe(binding);
    expect(Object.keys(out)).toEqual(['txSend']);
  });

  it('uses the binding when present, keyed by limit name, and never touches Postgres', async () => {
    const keys: string[] = [];
    let allow = true;
    const deps = {
      limiters: {
        txSend: {
          limit: async ({ key }: { key: string }) => {
            keys.push(key);
            return { success: allow };
          },
        },
      },
      sql: () => {
        throw new Error('no database');
      },
      now: () => new Date(),
    } as unknown as Deps;
    expect(await hitLimit(deps, 'txSend', 'wallet:abc')).toBe(true);
    allow = false;
    expect(await hitLimit(deps, 'txSend', 'wallet:abc')).toBe(false);
    expect(keys).toEqual(['txSend:wallet:abc', 'txSend:wallet:abc']);
  });

  it('declares Workers-compatible periods for every limit', () => {
    for (const spec of Object.values(LIMITS)) expect([10, 60]).toContain(spec.periodSec);
  });
});
