import { describe, expect, it } from 'vitest';
import { EDGE_CACHE_VERSION, keyFor, ruleFor, withEdgeCache } from './edge-cache';

function memoryCache() {
  const store = new Map<string, Response>();
  return {
    store,
    async match(request: Request) {
      return store.get(request.url)?.clone();
    },
    async put(request: Request, response: Response) {
      store.set(request.url, response);
    },
  };
}

const flush: Promise<unknown>[] = [];
const waitUntil = (p: Promise<unknown>) => flush.push(p);
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('edge cache', () => {
  it('never caches authed, cookie or write requests', () => {
    const url = 'https://api.trenchmart.fun/api/v1/listings/x';
    expect(ruleFor(new Request(url))).not.toBeNull();
    expect(ruleFor(new Request(url, { headers: { cookie: 'a=1; tm_session=abc' } }))).toBeNull();
    expect(ruleFor(new Request(url, { headers: { authorization: 'Bearer x' } }))).toBeNull();
    expect(ruleFor(new Request(url, { method: 'POST' }))).toBeNull();
    expect(ruleFor(new Request('https://api.trenchmart.fun/api/v1/me/orders'))).toBeNull();
    expect(ruleFor(new Request('https://api.trenchmart.fun/api/v1/me'))).toBeNull();
    expect(ruleFor(new Request('https://api.trenchmart.fun/api/v1/orders/1'))).toBeNull();
  });

  it('serves a hit, then stale-while-revalidate, and marks private responses no-store', async () => {
    const cache = memoryCache();
    let calls = 0;
    let clock = 1_000_000;
    const handle = async () => json({ n: ++calls });
    const req = () => new Request('https://api.trenchmart.fun/api/v1/listings/x');
    const first = await withEdgeCache(req(), handle, waitUntil, cache, () => clock);
    await Promise.all(flush);
    expect(first.headers.get('x-edge-cache')).toBe('MISS');
    expect(first.headers.get('cache-control')).toContain('s-maxage=60');
    const hit = await withEdgeCache(req(), handle, waitUntil, cache, () => clock);
    expect(hit.headers.get('x-edge-cache')).toBe('HIT');
    expect(await hit.json()).toEqual({ n: 1 });
    clock += 61_000;
    const stale = await withEdgeCache(req(), handle, waitUntil, cache, () => clock);
    expect(stale.headers.get('x-edge-cache')).toBe('STALE');
    await Promise.all(flush);
    expect(calls).toBe(2);

    const authed = await withEdgeCache(
      new Request('https://api.trenchmart.fun/api/v1/me', { headers: { cookie: 'tm_session=1' } }),
      async () => json({ me: 1 }),
      waitUntil,
      cache,
    );
    expect(authed.headers.get('cache-control')).toBe('private, no-store');
  });

  it('does not store responses that set cookies or say private', async () => {
    const cache = memoryCache();
    const req = new Request(
      'https://api.trenchmart.fun/api/v1/media/0b5c3b5e-1111-4222-8333-944455556666',
    );
    const res = await withEdgeCache(
      req,
      async () => json({}, { 'cache-control': 'private, no-store' }),
      waitUntil,
      cache,
    );
    await Promise.all(flush);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(cache.store.size).toBe(0);
  });

  it('keys entries by version and origin, never by cookie', () => {
    const a = keyFor(new Request('https://api.trenchmart.fun/api/v1/stats'));
    expect(new URL(a.url).searchParams.get('__v')).toBe(EDGE_CACHE_VERSION);
    const withOrigin = keyFor(
      new Request('https://api.trenchmart.fun/api/v1/stats', {
        headers: { origin: 'https://trenchmart.fun', cookie: 'x=1' },
      }),
    );
    expect(withOrigin.url).not.toBe(a.url);
    expect(withOrigin.headers.get('cookie')).toBeNull();
  });

  it('caches the hot public reward, payout and OpenAPI reads for everyone', () => {
    const rule = (path: string, headers: Record<string, string> = {}) =>
      ruleFor(new Request(`https://api.trenchmart.fun/api/v1${path}`, { headers }));
    const signedIn = { cookie: 'tm_session=abc' };
    for (const path of [
      '/rewards/current',
      '/rewards/top',
      '/rewards/epochs/recent',
      '/rewards/wallet/So11111111111111111111111111111111111111112',
      '/payouts/recent',
      '/openapi.json',
    ]) {
      expect(rule(path), path).not.toBeNull();
      expect(rule(path, signedIn)?.shared, path).toBe(true);
    }
    expect(rule('/rewards/wallet/not-a-wallet')).toBeNull();
    expect(rule('/openapi.json')?.stale).toBe(86_400);
    // Viewer-dependent reads stay uncached when signed in.
    expect(rule('/listings', signedIn)).toBeNull();
    expect(rule('/featuring/calendar')).toBeNull();
  });
  it('keeps aggregates stale-while-revalidate for a day, prices only ten minutes', () => {
    const rule = (path: string) => ruleFor(new Request(`https://api.trenchmart.fun/api/v1${path}`));
    expect(rule('/stats')?.stale).toBe(86_400);
    expect(rule('/creators/top')?.stale).toBe(86_400);
    expect(rule('/prices/sol')?.stale).toBe(600);
    expect(rule('/config/public')?.stale).toBe(600);
    expect(rule('/creators/alice')?.stale).toBe(600);
  });
});
