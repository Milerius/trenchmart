import { describe, expect, it, vi } from 'vitest';
import { ensureVerificationFee, payVerificationFee, submitPayment, type ApiCall } from './studio';

class FakeApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const noSleep = { sleep: async () => undefined, delayMs: 0 };

function recorder(handler: (path: string, init?: RequestInit) => unknown) {
  const calls: { path: string; body?: unknown }[] = [];
  const api = (async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(path, init);
  }) as ApiCall;
  return { api, calls };
}

describe('payVerificationFee', () => {
  it('signs the feeTx from version creation and posts the signature to /fee', async () => {
    // Regression: the new-listing flow ignored feeTx, so /complete failed with FEE_REQUIRED.
    const { api, calls } = recorder(() => ({ ok: true }));
    const signAndSend = vi.fn(async () => 'sig-1');
    const paid = await payVerificationFee({
      api,
      versionId: 'v1',
      feeTx: { txBase64: 'dHg=' },
      signAndSend,
    });
    expect(paid).toBe(true);
    expect(signAndSend).toHaveBeenCalledWith('dHg=');
    expect(calls).toEqual([{ path: '/studio/versions/v1/fee', body: { txSig: 'sig-1' } }]);
  });

  it('does nothing when the fee is waived', async () => {
    const { api, calls } = recorder(() => ({}));
    const signAndSend = vi.fn(async () => 'never');
    expect(await payVerificationFee({ api, versionId: 'v1', feeTx: null, signAndSend })).toBe(
      false,
    );
    expect(signAndSend).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('submitPayment', () => {
  it('retries while the chain has not seen the transaction yet', async () => {
    let n = 0;
    const { api, calls } = recorder(() => {
      n += 1;
      if (n < 3) throw new FakeApiError('TX_NOT_FOUND');
      return { ok: true };
    });
    await submitPayment(api, '/studio/versions/v1/fee', 'sig', noSleep);
    expect(calls).toHaveLength(3);
  });

  it('gives up after the attempt limit and surfaces other errors at once', async () => {
    const notFound = recorder(() => {
      throw new FakeApiError('TX_NOT_FOUND');
    });
    await expect(
      submitPayment(notFound.api, '/x', 'sig', { ...noSleep, attempts: 2 }),
    ).rejects.toThrow('TX_NOT_FOUND');
    expect(notFound.calls).toHaveLength(2);

    const wrong = recorder(() => {
      throw new FakeApiError('WRONG_AMOUNT');
    });
    await expect(submitPayment(wrong.api, '/x', 'sig', noSleep)).rejects.toThrow('WRONG_AMOUNT');
    expect(wrong.calls).toHaveLength(1);
  });
});

describe('ensureVerificationFee', () => {
  it('pays with a fresh transaction when the fee is still open', async () => {
    const { api, calls } = recorder((path) =>
      path.endsWith('/fee-tx') ? { paid: false, feeTx: { txBase64: 'ZnJlc2g=' } } : { ok: true },
    );
    const signAndSend = vi.fn(async () => 'sig-2');
    expect(await ensureVerificationFee({ api, versionId: 'v2', signAndSend })).toBe(true);
    expect(signAndSend).toHaveBeenCalledWith('ZnJlc2g=');
    expect(calls.map((call) => call.path)).toEqual([
      '/studio/versions/v2/fee-tx',
      '/studio/versions/v2/fee',
    ]);
  });

  it('skips the wallet when the fee is already paid', async () => {
    const { api } = recorder(() => ({ paid: true, feeTx: null }));
    const signAndSend = vi.fn(async () => 'never');
    expect(await ensureVerificationFee({ api, versionId: 'v3', signAndSend })).toBe(false);
    expect(signAndSend).not.toHaveBeenCalled();
  });
});
