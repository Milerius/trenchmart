import { describe, expect, it, vi } from 'vitest';
import { commitAfterSignIn, sessionAfterVerify } from './wallet-session';

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
