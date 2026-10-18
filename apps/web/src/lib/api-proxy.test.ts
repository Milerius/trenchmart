import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './api-proxy';

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe('/api/v1 proxy (M-03)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PROXY_SECRET;
  });

  it('forwards the edge client IP with the proxy secret and drops spoofed values', async () => {
    process.env.PROXY_SECRET = 's3cret';
    const seen: { url: string; headers: Headers; method: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), method: init.method ?? 'GET' });
      return new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json', 'set-cookie': 'tm_session=x; Path=/' },
      });
    });
    const res = await proxy(
      new Request('https://trenchmart.fun/api/v1/orders?x=1', {
        method: 'POST',
        body: '{}',
        headers: {
          'cf-connecting-ip': '203.0.113.7',
          'x-tm-client-ip': '1.2.3.4',
          'x-tm-proxy': 'guess',
          cookie: 'tm_session=abc',
        },
      }),
      ctx(['orders']),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toContain('tm_session=x');
    expect(seen[0]!.url).toMatch(/\/api\/v1\/orders\?x=1$/);
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.headers.get('x-tm-client-ip')).toBe('203.0.113.7');
    expect(seen[0]!.headers.get('x-tm-proxy')).toBe('s3cret');
    expect(seen[0]!.headers.get('cookie')).toBe('tm_session=abc');
  });

  it('never forwards client-supplied proxy headers without a configured secret', async () => {
    let headers = new Headers();
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response('ok');
    });
    await proxy(
      new Request('https://trenchmart.fun/api/v1/me', {
        headers: { 'x-tm-client-ip': '1.2.3.4', 'x-tm-proxy': 'guess' },
      }),
      ctx(['me']),
    );
    expect(headers.get('x-tm-client-ip')).toBeNull();
    expect(headers.get('x-tm-proxy')).toBeNull();
  });

  it('answers 502 quickly when the API is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const res = await proxy(
      new Request('https://trenchmart.fun/api/v1/listings'),
      ctx(['listings']),
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPSTREAM');
  });
});
