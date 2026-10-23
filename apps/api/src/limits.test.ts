import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('wrangler [[ratelimits]] blocks', () => {
  const parse = (file: string) => {
    const text = readFileSync(join(__dirname, '..', file), 'utf8');
    return [
      ...text.matchAll(
        /\[\[ratelimits\]\]\s*name = "(\w+)"\s*namespace_id = "(\d+)"\s*simple = \{ limit = (\d+), period = (\d+) \}/g,
      ),
    ].map((m) => ({ name: m[1]!, ns: m[2]!, limit: Number(m[3]), period: Number(m[4]) }));
  };
  const devnet = parse('wrangler.toml');
  const mainnet = parse('wrangler.mainnet.toml');

  it('declare every limit with the budget in LIMITS, on both Workers', () => {
    for (const blocks of [devnet, mainnet]) {
      for (const spec of Object.values(LIMITS)) {
        const block = blocks.find((b) => b.name === spec.binding);
        expect(block, spec.binding).toBeDefined();
        expect(block!.limit, spec.binding).toBe(spec.limit);
        expect(block!.period, spec.binding).toBe(spec.periodSec);
      }
    }
  });

  it('never share a namespace id between or within Workers (1002 stays mainnet)', () => {
    const all = [...devnet, ...mainnet].map((b) => b.ns);
    expect(new Set(all).size).toBe(all.length);
    expect(mainnet.find((b) => b.name === 'RATE_LIMITER')?.ns).toBe('1002');
    expect(devnet.every((b) => b.ns === '1001' || /^1[12]\d\d$/.test(b.ns))).toBe(true);
    expect(mainnet.every((b) => b.ns === '1002' || /^13\d\d$/.test(b.ns))).toBe(true);
  });
});
