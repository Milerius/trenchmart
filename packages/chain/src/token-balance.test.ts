import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenBalance } from './rpc';

const URL_ = 'https://rpc.example.com';
const OWNER = 'Buyer111111111111111111111111111111111111111';
const MINT = 'EZZFUgLKRCtuY9Cu4CyH8ncqfLC5rHfgdoHzzTGppump';

afterEach(() => vi.unstubAllGlobals());

function reply(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('tokenBalance', () => {
  it('reads a mint that does not exist yet as zero, without retrying', async () => {
    const f = reply({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'Invalid param: could not find mint' },
    });
    await expect(tokenBalance(URL_, OWNER, MINT)).resolves.toBe(0n);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('sums 6-decimal base units across token accounts', async () => {
    const acct = (amount: string) => ({
      account: { data: { parsed: { info: { tokenAmount: { amount, decimals: 6 } } } } },
    });
    reply({ jsonrpc: '2.0', id: 1, result: { value: [acct('1500000'), acct('2500000')] } });
    await expect(tokenBalance(URL_, OWNER, MINT)).resolves.toBe(4_000_000n);
  });

  it('still throws on other RPC errors', async () => {
    reply({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param: WrongSize' } });
    await expect(tokenBalance(URL_, OWNER, MINT)).rejects.toThrow(/WrongSize/);
  });
});

describe('rpc error detail', () => {
  it('falls back to the HTTP status when a 5xx body has a non-string error message, and retries', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 1, message: { nested: true } } }), {
          status: 503,
        }),
    );
    vi.stubGlobal('fetch', f);
    const { rpc } = await import('./rpc');
    await expect(rpc(URL_, 'getSlot', [], { attempts: 2, sleep: async () => {} })).rejects.toThrow(
      /HTTP 503/,
    );
    expect(f).toHaveBeenCalledTimes(2);
  });
});
