import { describe, expect, it } from 'vitest';
import { runChecks, watchdog, type WatchdogEnv } from './watchdog';

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
    expect((await runChecks(env, f)).every((c) => c.ok)).toBe(true);
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
});
