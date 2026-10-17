import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { SANDBOX_BUDGET_MS } from '@trenchmart/scanner';
import { dispatchSandbox } from './dispatch';

const source = 'console.log("ok")';
let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

describe('sandbox dispatch', () => {
  it('posts one job to the runner immediately and does not poll', async () => {
    const seen: string[] = [];
    server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          mode: 'vm-isolate',
          durationMs: 12,
          requests: [],
          walletCalls: [],
          errors: [],
          verdict: 'pass',
          notes: 'runner',
          egress: 'blocked',
          log: ['egress blocked'],
          limits: { timeoutMs: 15000, memoryMb: 128 },
        }),
      );
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const pushed: unknown[] = [];
    const started = Date.now();
    const result = await dispatchSandbox({
      runnerUrl: `http://127.0.0.1:${address.port}`,
      token: 'internal',
      versionId: 'v1',
      fileName: 'pack.user.js',
      source,
      timeoutMs: SANDBOX_BUDGET_MS,
      nowMs: started,
      queue: {
        async send(body) {
          pushed.push(body);
        },
      },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen).toEqual(['POST /jobs']);
    expect(pushed).toHaveLength(1);
    expect(result.verdict).toBe('pass');
    expect(result.egress).toBe('blocked');
    expect(SANDBOX_BUDGET_MS).toBeGreaterThanOrEqual(10_000);
    expect(SANDBOX_BUDGET_MS).toBeLessThanOrEqual(20_000);
  });
});
