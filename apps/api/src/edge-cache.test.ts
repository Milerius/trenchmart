import { describe, expect, it } from 'vitest';
import { ruleFor, withEdgeCache } from './edge-cache';

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
});
