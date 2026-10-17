import { describe, expect, it } from 'vitest';
import type { Simulation } from '@trenchmart/chain';
import { HttpError, preflightTx, type Deps } from './logic';

const tx = 'AQID';
const depsWith = (simulate?: Deps['simulate']) => ({ simulate }) as unknown as Deps;
const sim = (err: unknown, logs: string[] = []): Simulation => ({ err, logs, unitsConsumed: 0 });

async function codeOf(p: Promise<void>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return (e as HttpError).code;
  }
}

describe('preflightTx', () => {
  it('passes a clean simulation and skips when no simulator or the RPC is down', async () => {
    expect(
      await codeOf(
        preflightTx(
          depsWith(async () => sim(null)),
          tx,
        ),
      ),
    ).toBeNull();
    expect(await codeOf(preflightTx(depsWith(undefined), tx))).toBeNull();
    const down = async (): Promise<Simulation> => {
      throw new Error('rpc down');
    };
    expect(await codeOf(preflightTx(depsWith(down), tx))).toBeNull();
  });

  it('maps failing simulations so the wallet is never asked to sign them', async () => {
    const poor = sim({ InstructionError: [3, { Custom: 1 }] }, [
      'Transfer: insufficient lamports 10, need 20',
    ]);
    expect(
      await codeOf(
        preflightTx(
          depsWith(async () => poor),
          tx,
        ),
      ),
    ).toBe('INSUFFICIENT_SOL');
    const unfunded = async () => sim('AccountNotFound');
    expect(await codeOf(preflightTx(depsWith(unfunded), tx))).toBe('INSUFFICIENT_SOL');
    const other = async () => sim({ InstructionError: [4, { Custom: 6001 }] });
    expect(await codeOf(preflightTx(depsWith(other), tx))).toBe('TX_WOULD_FAIL');
  });
});
