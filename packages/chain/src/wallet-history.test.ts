import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletHistory, type ChainTx } from './rpc';

const W = 'Buyer111111111111111111111111111111111111111';
const C = 'Creator1111111111111111111111111111111111111';

afterEach(() => vi.unstubAllGlobals());

function tx(signature: string, source: string, destination: string): ChainTx {
  return {
    signature,
    err: null,
    blockTime: 0,
    confirmationStatus: 'confirmed',
    transfers: [{ source, destination, lamports: 1n }],
    memos: [],
  };
}

describe('walletHistory', () => {
  it('reports the oldest activity and SOL senders inside the window only', async () => {
    const day = 86_400;
    const now = 1_800_000_000;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: [
            { signature: 's3', blockTime: now - day, err: null },
            { signature: 's2', blockTime: now - 2 * day, err: null },
            { signature: 's1', blockTime: now - 90 * day, err: null },
          ],
        }),
      ),
    );
    const seen: string[] = [];
    const history = await walletHistory(
      'https://api.devnet.solana.com',
      W,
      (now - 30 * day) * 1000,
      {
        fetchTx: async (sig) => {
          seen.push(sig);
          if (sig === 's2') return tx(sig, C, W);
          return tx(sig, W, C);
        },
      },
    );
    expect(seen).toEqual(['s3', 's2']);
    expect(history.oldestAt?.toISOString()).toBe(new Date((now - 90 * day) * 1000).toISOString());
    expect(history.funders).toEqual([
      { wallet: C, at: new Date((now - 2 * day) * 1000).toISOString() },
    ]);
  });

  it('caps the transactions read to the oldest and newest in the window', async () => {
    const now = 1_800_000_000;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: Array.from({ length: 20 }, (_, i) => ({
            signature: `s${i}`,
            blockTime: now - i,
            err: null,
          })),
        }),
      ),
    );
    const seen: string[] = [];
    const history = await walletHistory('https://api.devnet.solana.com', W, 0, {
      maxTx: 4,
      fetchTx: async (sig) => {
        seen.push(sig);
        return null;
      },
    });
    expect(seen).toEqual(['s0', 's1', 's18', 's19']);
    expect(history.funders).toEqual([]);
  });
});
