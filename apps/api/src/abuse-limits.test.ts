import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABUSE_LIMITS,
  allowRead,
  allowWrite,
  ipBucket,
  readGate,
  writeGroup,
  type Limiter,
} from './abuse-limits';
import { safeEqual } from './app';

/** In-memory stand-in for a Workers Rate Limiting binding. */
function counter(limit: number): Limiter & { keys: string[] } {
  const hits = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const n = (hits.get(key) ?? 0) + 1;
      hits.set(key, n);
      return { success: n <= limit };
    },
  };
}

describe('ipBucket', () => {
  it('keeps IPv4 as is', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket(' 203.0.113.7 ')).toBe('203.0.113.7');
  });
  it('keys IPv6 by /64, whatever the notation', () => {
    const a = ipBucket('2001:db8:abcd:12:1:2:3:4');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(ipBucket('2001:0DB8:ABCD:0012:ffff:ffff:ffff:ffff')).toBe(a);
    expect(ipBucket('2001:db8:abcd:12::1')).toBe(a);
    expect(ipBucket('[2001:db8:abcd:12::9]')).toBe(a);
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('::1')).toBe('0:0:0:0::/64');
    expect(ipBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipBucket('2001:db8:abcd:13::1')).not.toBe(a);
  });
  it('maps IPv4-mapped IPv6 to the IPv4 client', () => {
    expect(ipBucket('::ffff:198.51.100.2')).toBe('198.51.100.2');
  });
});

describe('writeGroup', () => {
  const cases: [string, string, string | null][] = [
    ['POST', '/api/v1/auth/nonce', 'auth'],
    ['POST', '/api/v1/auth/verify', 'auth'],
    ['POST', '/api/v1/agent/auth/challenge', 'auth'],
    ['POST', '/api/v1/agent/auth/key', 'auth'],
    ['POST', '/api/v1/verify', 'verify'],
    ['POST', '/api/v1/verify/supplement', 'verify'],
    ['PUT', '/api/v1/files', 'upload'],
    ['POST', '/api/v1/studio/listings/abc/images', 'upload'],
    ['PUT', '/api/v1/studio/listings/abc/images/x/w/480', 'upload'],
    ['PUT', '/api/v1/studio/listings/abc/content', 'upload'],
    ['POST', '/api/v1/studio/listings/abc/versions', 'upload'],
    ['POST', '/api/v1/studio/versions/v/reupload', 'upload'],
    ['PUT', '/api/v1/studio/profile', 'upload'],
    ['POST', '/api/v1/orders', 'tx'],
    ['POST', '/api/v1/orders/quote', 'tx'],
    ['POST', '/api/v1/orders/o/submitted', 'tx'],
    ['POST', '/api/v1/tx/send', 'tx'],
    ['POST', '/api/v1/agent/tx/broadcast', 'tx'],
    ['POST', '/api/v1/agent/orders/o/release', 'tx'],
    ['POST', '/api/v1/studio/bond', 'tx'],
    ['POST', '/api/v1/studio/versions/v/fee-tx', 'tx'],
    ['POST', '/api/v1/studio/featuring/bookings', 'tx'],
    ['POST', '/api/v1/supplements/s/submitted', 'tx'],
    ['POST', '/api/v1/studio/listings', null],
    ['POST', '/api/v1/listings/x/upvote', null],
    ['GET', '/api/v1/orders', null],
    ['GET', '/api/v1/verify/quota', null],
    ['OPTIONS', '/api/v1/auth/nonce', null],
  ];
  it.each(cases)('%s %s -> %s', (method, path, group) => {
    expect(writeGroup(method, path)).toBe(group);
  });
});

describe('allowWrite', () => {
  it('limits per IP /64 and per wallet independently', async () => {
    const tx = counter(2);
    const l = { tx };
    expect(await allowWrite(l, 'tx', '2001:db8:1:2::1', 'W1')).toBe(true);
    expect(await allowWrite(l, 'tx', '2001:db8:1:2::99', 'W2')).toBe(true);
    // Third request from the same /64 is refused even with a fresh wallet.
    expect(await allowWrite(l, 'tx', '2001:db8:1:2:ffff::1', 'W3')).toBe(false);
    // Same wallet from new IPs: refused once the wallet bucket is full.
    expect(await allowWrite(l, 'tx', '198.51.100.1', 'W1')).toBe(true);
    expect(await allowWrite(l, 'tx', '198.51.100.2', 'W1')).toBe(false);
    expect(tx.keys).toContain('tx:ip:2001:db8:1:2::/64');
    expect(tx.keys).toContain('tx:w:W1');
  });
  it('anonymous writes are keyed per IP only', async () => {
    const auth = counter(1);
    expect(await allowWrite({ auth }, 'auth', '203.0.113.1', null)).toBe(true);
    expect(await allowWrite({ auth }, 'auth', '203.0.113.1', null)).toBe(false);
    expect(auth.keys.every((k) => k.startsWith('auth:ip:'))).toBe(true);
  });
  it('groups do not share buckets', async () => {
    const auth = counter(1);
    const upload = counter(1);
    expect(await allowWrite({ auth, upload }, 'auth', '203.0.113.1', null)).toBe(true);
    expect(await allowWrite({ auth, upload }, 'upload', '203.0.113.1', 'W')).toBe(true);
  });
  it('is a no-op without a binding (local and tests)', async () => {
    expect(await allowWrite(undefined, 'tx', '1.2.3.4', 'W')).toBe(true);
    expect(await allowRead({}, '1.2.3.4')).toBe(true);
  });
});

describe('readGate', () => {
  const get = (headers: Record<string, string>, method = 'GET') =>
    new Request('https://api.example/api/v1/listings', { method, headers });

  it('allows reads up to the limit per IP, then 429 with Retry-After', async () => {
    const read = counter(3);
    for (let i = 0; i < 3; i++)
      expect(
        await readGate(get({ 'cf-connecting-ip': '203.0.113.5' }), { read }, 's', safeEqual),
      ).toBeNull();
    const res = await readGate(
      get({ 'cf-connecting-ip': '203.0.113.5' }),
      { read },
      's',
      safeEqual,
    );
    expect(res?.status).toBe(429);
    expect(res?.headers.get('retry-after')).toBe('60');
    expect(((await res!.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMIT');
    // Another visitor is unaffected.
    expect(
      await readGate(get({ 'cf-connecting-ip': '203.0.113.6' }), { read }, 's', safeEqual),
    ).toBeNull();
  });
  it('trusts x-tm-client-ip only with the proxy secret', async () => {
    const read = counter(100);
    await readGate(
      get({
        'cf-connecting-ip': '10.0.0.1',
        'x-tm-client-ip': '198.51.100.9',
        'x-tm-proxy': 'sek',
      }),
      { read },
      'sek',
      safeEqual,
    );
    await readGate(
      get({
        'cf-connecting-ip': '10.0.0.1',
        'x-tm-client-ip': '198.51.100.9',
        'x-tm-proxy': 'bad',
      }),
      { read },
      'sek',
      safeEqual,
    );
    expect(read.keys).toEqual(['read:198.51.100.9', 'read:10.0.0.1']);
  });
  it('ignores writes (they have their own limits)', async () => {
    const read = counter(0);
    expect(await readGate(get({}, 'POST'), { read }, undefined, safeEqual)).toBeNull();
  });
});

describe('wrangler configs', () => {
  const ids = (file: string) => {
    const toml = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    return [
      ...toml.matchAll(
        /\[\[ratelimits\]\]\s*name = "(\w+)"\s*namespace_id = "(\d+)"\s*simple = \{ limit = (\d+), period = (\d+) \}/g,
      ),
    ];
  };
  const devnet = ids('wrangler.toml');
  const mainnet = ids('wrangler.mainnet.toml');
  it.each([
    ['devnet', devnet, /^12\d\d$/],
    ['mainnet', mainnet, /^13\d\d$/],
  ] as const)(
    '%s declares every abuse binding with its limit, 60 s and its id range',
    (_n, blocks, range) => {
      for (const { binding, limit } of Object.values(ABUSE_LIMITS)) {
        const block = blocks.find((b) => b[1] === binding);
        expect(block, binding).toBeTruthy();
        expect(Number(block![3])).toBe(limit);
        expect(block![4]).toBe('60');
        expect(block![2]).toMatch(range);
      }
    },
  );
  it('never shares a namespace id within or across the two Workers', () => {
    const all = [...devnet, ...mainnet].map((b) => b[2]);
    expect(new Set(all).size).toBe(all.length);
  });
  it('legit agent flows fit: a buy and a sell each use far less than one window', () => {
    // Buy: quote, order, broadcast, submitted, download, release.
    expect(6).toBeLessThan(ABUSE_LIMITS.tx.limit);
    // Agent sign-in: challenge + key; browser sign-in: nonce + verify (+ refresh).
    expect(3).toBeLessThan(ABUSE_LIMITS.auth.limit);
    // Sell: content + 8 images with 2 narrower copies each + version.
    expect(1 + 8 * 3 + 1).toBeLessThan(ABUSE_LIMITS.upload.limit);
    // The max per-key budget (300/min, reads included) fits under the per-IP read limit.
    expect(300).toBeLessThan(ABUSE_LIMITS.read.limit);
  });
});
