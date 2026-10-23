import { describe, expect, it, vi } from 'vitest';
import {
  PRIMARY_RPC_TIMEOUT_MS,
  checkRpc,
  pushStatus,
  reportHealth,
  runChecks,
  watchdog,
  type WatchdogEnv,
} from './watchdog';

const env: WatchdogEnv = {
  WEB_URL: 'https://web.example',
  API_URL: 'https://api.example',
  RPC_URL: 'https://rpc.example',
  CLUSTER: 'devnet',
};

function world() {
  const state = {
    api: 200,
    rpc: 'ok',
    web: 200,
  };
  const f = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://web.example')) return new Response('', { status: state.web });
    if (url.startsWith('https://api.example'))
      return Response.json({ ok: state.api === 200 }, { status: state.api });
    if (url.startsWith('https://rpc.example'))
      return state.rpc === '429'
        ? new Response('rate limited', { status: 429 })
        : Response.json({ result: state.rpc });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { state, f };
}

describe('external watchdog', () => {
  it('checks web, API and RPC', async () => {
    const { state, f } = world();
    const good = await runChecks(env, f);
    expect(good.every((c) => c.ok)).toBe(true);
    // Each check carries its latency for the status page.
    expect(good.every((c) => Number.isInteger(c.ms) && c.ms >= 0)).toBe(true);
    state.rpc = '429';
    expect((await runChecks(env, f)).every((c) => c.ok)).toBe(true);
    state.api = 503;
    state.rpc = 'behind';
    const bad = await runChecks(env, f);
    expect(bad.filter((c) => !c.ok).map((c) => c.name)).toEqual(['api', 'rpc']);
  });

  it('logs DOWN targets without push delivery (assistant polls GET /)', async () => {
    const { state, f } = world();
    expect(await watchdog(env, f)).toEqual([]);
    state.api = 502;
    expect(await watchdog(env, f)).toEqual(['[TrenchMart devnet] watchdog DOWN api']);
    expect(await watchdog(env, f)).toEqual(['[TrenchMart devnet] watchdog DOWN api']);
    state.api = 200;
    expect(await watchdog(env, f)).toEqual([]);
  });

  it('pushes name, ok and latency (never the detail text) to the API status page', async () => {
    const { state, f } = world();
    const posts: { url: string; auth: string; body: string }[] = [];
    const spy = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/internal/status/external')) {
        posts.push({
          url,
          auth: (init?.headers as Record<string, string>).authorization ?? '',
          body: String(init?.body),
        });
        return Response.json({ recorded: 3 });
      }
      return f(input, init);
    }) as typeof fetch;
    // No token: no push.
    await watchdog(env, spy);
    expect(posts).toEqual([]);
    const withToken = { ...env, STATUS_PUSH_TOKEN: 'push-token-push-token-push-token-0001' };
    state.web = 503;
    await watchdog(withToken, spy);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://api.example/api/v1/internal/status/external');
    expect(posts[0]!.auth).toBe('Bearer push-token-push-token-push-token-0001');
    const body = JSON.parse(posts[0]!.body) as { checks: Record<string, unknown>[] };
    expect(body.checks.map((c) => Object.keys(c).sort())).toEqual([
      ['ms', 'name', 'ok'],
      ['ms', 'name', 'ok'],
      ['ms', 'name', 'ok', 'provider'],
    ]);
    expect(body.checks.find((c) => c.name === 'rpc')!.provider).toBe('public');
    expect(body.checks.find((c) => c.name === 'web')!.ok).toBe(false);
    expect(posts[0]!.body).not.toContain('HTTP');
    // The API being unreachable never breaks the watchdog.
    const down = (async () => {
      throw new Error('connect timeout');
    }) as typeof fetch;
    expect(await pushStatus(withToken, await runChecks(env, f), down)).toBe(false);
  });

  it('reports the health check (web + API, not RPC) to /internal/ops/report with the push token', async () => {
    const { state, f } = world();
    const posts: { url: string; auth: string; body: Record<string, unknown> }[] = [];
    const spy = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/internal/ops/report')) {
        posts.push({
          url,
          auth: (init?.headers as Record<string, string>).authorization ?? '',
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Response.json({ ok: true, source: 'watchdog' });
      }
      if (url.endsWith('/api/v1/internal/status/external')) return Response.json({ recorded: 3 });
      return f(input, init);
    }) as typeof fetch;
    expect(await reportHealth(env, await runChecks(env, f), spy)).toBe(false);
    expect(posts).toEqual([]);
    const withToken = { ...env, STATUS_PUSH_TOKEN: 'push-token-push-token-push-token-0001' };
    await watchdog(withToken, spy);
    expect(posts[0]).toEqual({
      url: 'https://api.example/api/v1/internal/ops/report',
      auth: 'Bearer push-token-push-token-push-token-0001',
      body: {
        check: 'health-check',
        source: 'watchdog',
        ok: true,
        detail: 'web, api ok (watchdog)',
      },
    });
    state.rpc = 'behind';
    await watchdog(withToken, spy);
    expect(posts[1]!.body.ok).toBe(true);
    state.web = 502;
    await watchdog(withToken, spy);
    expect(posts[2]!.body).toEqual({
      check: 'health-check',
      source: 'watchdog',
      ok: false,
      detail: 'web: https://web.example HTTP 502',
    });
    const down = (async () => {
      throw new Error('connect timeout');
    }) as typeof fetch;
    expect(await reportHealth(withToken, await runChecks(env, f), down)).toBe(false);
  });

  it('alerts only through the chat relay: no email or ntfy request, even if old settings are set', async () => {
    const { state, f } = world();
    const hosts = new Set<string>();
    const spy = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      hosts.add(url.host);
      if (url.pathname.startsWith('/api/v1/internal/')) return Response.json({ ok: true });
      return f(input, init);
    }) as typeof fetch;
    const legacy = {
      ...env,
      STATUS_PUSH_TOKEN: 'push-token-push-token-push-token-0001',
      ALERT_EMAIL: 'owner@example.com',
      ALERT_NTFY_TOPIC: 'old-topic',
    } as WatchdogEnv;
    state.web = 503;
    state.api = 502;
    expect(await watchdog(legacy, spy)).toHaveLength(2);
    expect([...hosts].sort()).toEqual(['api.example', 'rpc.example', 'web.example']);
  });
});

describe('RPC check: Helius first, public fallback', () => {
  const HELIUS = 'https://devnet.helius-rpc.example/?api-key=SECRET-KEY-0001';
  const henv: WatchdogEnv = { ...env, HELIUS_RPC_URL: HELIUS };

  function rpcWorld(helius: 'ok' | 'behind' | '500' | 'throw' | 'hang', pub: 'ok' | 'behind') {
    const calls: string[] = [];
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === HELIUS) {
        calls.push('helius');
        if (helius === 'throw') throw new Error(`fetch failed for ${HELIUS}`);
        if (helius === 'hang')
          return new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            ),
          );
        if (helius === '500') return new Response('boom', { status: 500 });
        return Response.json({ result: helius });
      }
      if (url.startsWith('https://rpc.example')) {
        calls.push('public');
        return Response.json({ result: pub });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    return { f, calls };
  }

  it('uses Helius when it answers and never touches the public RPC', async () => {
    const { f, calls } = rpcWorld('ok', 'ok');
    const c = await checkRpc(henv, f);
    expect(c).toMatchObject({ name: 'rpc', ok: true, provider: 'helius' });
    expect(calls).toEqual(['helius']);
  });

  it.each(['behind', '500', 'throw'] as const)(
    'falls back to the public RPC when Helius fails (%s)',
    async (mode) => {
      const { f, calls } = rpcWorld(mode, 'ok');
      const c = await checkRpc(henv, f);
      expect(c).toMatchObject({ ok: true, provider: 'public' });
      expect(c.detail).toMatch(/^ok \(public fallback; Helius /);
      expect(calls).toEqual(['helius', 'public']);
      // The Helius URL (API key) never reaches the detail served on GET /.
      expect(JSON.stringify(c)).not.toContain('SECRET-KEY');
    },
  );

  it('falls back when Helius times out, reporting the fallback latency only', async () => {
    vi.useFakeTimers();
    try {
      const { f, calls } = rpcWorld('hang', 'ok');
      const pending = checkRpc(henv, f);
      await vi.advanceTimersByTimeAsync(PRIMARY_RPC_TIMEOUT_MS + 1);
      const c = await pending;
      expect(c).toMatchObject({ ok: true, provider: 'public' });
      expect(c.detail).toContain('Helius timeout');
      expect(c.ms).toBeLessThan(PRIMARY_RPC_TIMEOUT_MS);
      expect(calls).toEqual(['helius', 'public']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is down only when both fail, without leaking the key', async () => {
    const { f } = rpcWorld('throw', 'behind');
    const c = await checkRpc(henv, f);
    expect(c.ok).toBe(false);
    expect(c.detail).toBe('Helius unreachable; public getHealth HTTP 200 behind');
    expect(JSON.stringify(c)).not.toContain('SECRET-KEY');
    const logged = await watchdog(henv, (async (i: string | URL | Request, init?: RequestInit) => {
      const u = String(i);
      if (u.startsWith('https://web.example')) return new Response('');
      if (u.startsWith('https://api.example')) return Response.json({ ok: true });
      return f(i, init);
    }) as typeof fetch);
    expect(logged).toEqual(['[TrenchMart devnet] watchdog DOWN rpc']);
    // A down RPC was answered by no provider: none is reported.
    expect(c.provider).toBeUndefined();
  });

  it('reports no provider when Helius fails and no public RPC is configured', async () => {
    const { f } = rpcWorld('500', 'ok');
    const c = await checkRpc({ ...henv, RPC_URL: '' }, f);
    expect(c.ok).toBe(false);
    expect(c.provider).toBeUndefined();
  });

  it('times out a Helius body that stalls after headers, then falls back', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const f = (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url === HELIUS ? 'helius' : 'public');
        if (url === HELIUS)
          // Headers arrive; the body never does (the stream is never closed).
          return new Response(new ReadableStream({ start() {} }), { status: 200 });
        return Response.json({ result: 'ok' });
      }) as typeof fetch;
      const pending = checkRpc(henv, f);
      await vi.advanceTimersByTimeAsync(PRIMARY_RPC_TIMEOUT_MS + 1);
      const c = await pending;
      expect(c).toMatchObject({ ok: true, provider: 'public' });
      expect(c.detail).toContain('Helius timeout');
      expect(calls).toEqual(['helius', 'public']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('without HELIUS_RPC_URL checks the public RPC only (provider public)', async () => {
    const { f, calls } = rpcWorld('ok', 'ok');
    expect(await checkRpc(env, f)).toMatchObject({ ok: true, provider: 'public' });
    expect(calls).toEqual(['public']);
  });

  it('pushes the provider for rpc only', async () => {
    const { f } = rpcWorld('500', 'ok');
    const posts: string[] = [];
    const spy = (async (i: string | URL | Request, init?: RequestInit) => {
      const u = String(i);
      if (u.startsWith('https://web.example')) return new Response('');
      if (u.endsWith('/api/v1/internal/status/external')) {
        posts.push(String(init?.body));
        return Response.json({ recorded: 3 });
      }
      if (u.startsWith('https://api.example')) return Response.json({ ok: true });
      return f(i, init);
    }) as typeof fetch;
    await pushStatus(
      { ...henv, STATUS_PUSH_TOKEN: 'push-token-push-token-push-token-0001' },
      await runChecks(henv, spy),
      spy,
    );
    const body = JSON.parse(posts[0]!) as { checks: { name: string; provider?: string }[] };
    expect(body.checks.map((c) => [c.name, c.provider ?? null])).toEqual([
      ['web', null],
      ['api', null],
      ['rpc', 'public'],
    ]);
    expect(posts[0]).not.toContain('SECRET-KEY');
  });
});
