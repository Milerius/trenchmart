import { describe, expect, it } from 'vitest';
import { xResultMessage } from './x-result';

describe('xResultMessage', () => {
  it('is empty without a result', () => {
    expect(xResultMessage(null, null)).toBeNull();
  });
  it('reports a link as success', () => {
    expect(xResultMessage('linked', null)).toMatchObject({
      ok: true,
      title: 'X account verified and linked.',
    });
  });
  it('explains each failure reason', () => {
    expect(xResultMessage('failed', 'token_rejected')?.detail).toMatch(
      /app credentials \(HTTP 401\)/,
    );
    expect(xResultMessage('failed', 'users_me_forbidden')?.detail).toMatch(/403/);
    expect(xResultMessage('failed', 'code_rejected')?.detail).toMatch(/Try Verify with X again/);
    expect(xResultMessage('invalid', 'state_missing')?.detail).toMatch(/cookie/);
    expect(xResultMessage('failed', 'signed_out')?.detail).toMatch(/Connect your wallet/);
  });
  it('falls back to a generic sentence for unknown reasons', () => {
    expect(xResultMessage('failed', 'nope')).toEqual({
      ok: false,
      title: 'X sign-in failed.',
      detail: 'Try Verify with X again.',
    });
    expect(xResultMessage('invalid', null)?.title).toBe('X sign-in could not be checked.');
  });
});
