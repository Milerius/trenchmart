import { describe, expect, it } from 'vitest';
import { runChecks, watchdog, type WatchdogEnv } from './watchdog';

const env: WatchdogEnv = {
  WEB_URL: 'https://web.example',
  API_URL: 'https://api.example',
  RPC_URL: 'https://rpc.example',
  ALERT_NTFY_TOPIC: 'topic',
  ALERT_EMAIL: 'owner@example.com',
  ALERT_NTFY_TOKEN: 'tk',
};

function world() {
  const state = {
    api: 200,
    rpc: 'ok',
    web: 200,
    log: [] as string[],
    posted: [] as Record<string, string>[],
  };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://web.example')) return new Response('', { status: state.web });
    if (url.startsWith('https://api.example'))
      return Response.json({ ok: state.api === 200 }, { status: state.api });
    if (url.startsWith('https://rpc.example')) return Response.json({ result: state.rpc });
    if (url.includes('/json?poll=1')) return new Response(state.log.join('\n'));
    if (url === 'https://ntfy.sh/topic') {
      const headers = init?.headers as Record<string, string>;
      state.posted.push(headers);
      state.log.push(JSON.stringify({ title: headers.Title }));
      return new Response('{}');
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { state, f };
}

describe('external watchdog', () => {
  it('checks web, API and RPC', async () => {
    const { state, f } = world();
    expect((await runChecks(env, f)).every((c) => c.ok)).toBe(true);
    state.api = 503;
    state.rpc = 'behind';
    const bad = await runChecks(env, f);
    expect(bad.filter((c) => !c.ok).map((c) => c.name)).toEqual(['api', 'rpc']);
  });

  it('sends DOWN once, nothing while still down, UP once on recovery, by email through ntfy', async () => {
    const { state, f } = world();
    expect(await watchdog(env, f)).toEqual([]);
    state.api = 502;
    expect(await watchdog(env, f)).toEqual(['[TrenchMart devnet] watchdog DOWN api']);
    expect(state.posted[0]!.Email).toBe('owner@example.com');
    expect(state.posted[0]!.Priority).toBe('urgent');
    expect(await watchdog(env, f)).toEqual([]);
    state.api = 200;
    expect(await watchdog(env, f)).toEqual(['[TrenchMart devnet] watchdog UP api']);
    expect(await watchdog(env, f)).toEqual([]);
  });
});
