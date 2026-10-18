import { describe, expect, it } from 'vitest';
import { pushStatus, runChecks, watchdog, type WatchdogEnv } from './watchdog';

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
      ['ms', 'name', 'ok'],
    ]);
    expect(body.checks.find((c) => c.name === 'web')!.ok).toBe(false);
    expect(posts[0]!.body).not.toContain('HTTP');
    // The API being unreachable never breaks the watchdog.
    const down = (async () => {
      throw new Error('connect timeout');
    }) as typeof fetch;
    expect(await pushStatus(withToken, await runChecks(env, f), down)).toBe(false);
  });
});
