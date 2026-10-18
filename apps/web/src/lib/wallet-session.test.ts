import { describe, expect, it, vi } from 'vitest';
import {
  commitAfterSignIn,
  isUserRejection,
  readSessionHint,
  sessionAfterVerify,
  SESSION_HINT_KEY,
  shouldRefreshSession,
  singleFlight,
  writeSessionHint,
} from './wallet-session';

describe('commitAfterSignIn', () => {
  it('writes the signer only after sign-in resolves', async () => {
    const order: string[] = [];
    await commitAfterSignIn({
      finish: async () => {
        order.push('finish');
      },
      commit: () => {
        order.push('commit');
      },
    });
    expect(order).toEqual(['finish', 'commit']);
  });

  it('leaves the previous wallet in place when sign-in fails', async () => {
    const commit = vi.fn();
    await expect(
      commitAfterSignIn({
        finish: async () => {
          throw new Error('bad signature');
        },
        commit,
      }),
    ).rejects.toThrow('bad signature');
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('sessionAfterVerify', () => {
  it('does not roll back a session /me can read', async () => {
    const rollback = vi.fn(async () => undefined);
    await sessionAfterVerify({
      load: async () => undefined,
      rollback,
    });
    expect(rollback).not.toHaveBeenCalled();
  });

  it('clears the new cookie when /me fails and still throws that error', async () => {
    const rollback = vi.fn(async () => {
      throw new Error('logout failed');
    });
    await expect(
      sessionAfterVerify({
        load: async () => {
          throw new Error('me failed');
        },
        rollback,
      }),
    ).rejects.toThrow('me failed');
    expect(rollback).toHaveBeenCalledOnce();
  });
});

describe('session hint', () => {
  function memory(): Storage {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k) => map.get(k) ?? null,
      key: (i) => [...map.keys()][i] ?? null,
      removeItem: (k) => void map.delete(k),
      setItem: (k, v) => void map.set(k, v),
    };
  }
  const user = { id: 'u', wallet: 'W', handle: null, roles: ['buyer'], tier: 'none' };

  it('round-trips and drops an expired or malformed hint', () => {
    const storage = memory();
    writeSessionHint(storage, { user, expiresAt: '2026-01-02T00:00:00.000Z' });
    expect(readSessionHint(storage, Date.parse('2026-01-01T00:00:00Z'))?.user.wallet).toBe('W');
    expect(readSessionHint(storage, Date.parse('2026-01-03T00:00:00Z'))).toBeNull();
    storage.setItem(SESSION_HINT_KEY, '{nope');
    expect(readSessionHint(storage)).toBeNull();
    writeSessionHint(storage, null);
    expect(storage.getItem(SESSION_HINT_KEY)).toBeNull();
  });

  it('refreshes only after refreshAfter', () => {
    expect(
      shouldRefreshSession({ refreshAfter: '2026-01-02T00:00:00Z' }, Date.parse('2026-01-01')),
    ).toBe(false);
    expect(
      shouldRefreshSession({ refreshAfter: '2026-01-02T00:00:00Z' }, Date.parse('2026-01-03')),
    ).toBe(true);
    expect(shouldRefreshSession(null)).toBe(false);
  });

  it('recognises wallet rejections', () => {
    expect(isUserRejection(Object.assign(new Error('x'), { code: 4001 }))).toBe(true);
    expect(isUserRejection(new Error('User rejected the request.'))).toBe(true);
    expect(isUserRejection(new Error('network down'))).toBe(false);
  });

  it('runs one sign-in at a time', async () => {
    const flight = singleFlight<number>();
    let calls = 0;
    let release: (v: number) => void = () => {};
    const run = () => {
      calls += 1;
      return new Promise<number>((r) => (release = r));
    };
    const a = flight(run);
    const b = flight(run);
    release(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(calls).toBe(1);
    await flight(async () => 1);
    expect(calls).toBe(1);
  });
});
