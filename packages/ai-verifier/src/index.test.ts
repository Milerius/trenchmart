import { describe, expect, it } from 'vitest';
import { runAiVerifier, signAttestation, verifyAttestation, attestationMessage } from './index';

const pass = { ruleId: 'no-eval', result: 'pass' as const, title: 'No eval', detail: 'clean' };
const fail = { ruleId: 'no-sign-transaction', result: 'fail' as const, title: 'No signing', detail: 'calls signTransaction' };
const warn = { ruleId: 'network-declared', result: 'warn' as const, title: 'Network', detail: 'undeclared host' };

describe('runAiVerifier', () => {
  it('approves a clean file', () => {
    expect(runAiVerifier({ checks: [pass] }).decision).toBe('approve');
  });

  it('rejects a drainer-style failure', () => {
    expect(runAiVerifier({ checks: [fail] }).decision).toBe('reject');
  });

  it('rejects sandbox wallet calls', () => {
    const d = runAiVerifier({ checks: [pass], sandboxWalletCalls: ['signTransaction'] });
    expect(d.decision).toBe('reject');
  });

  it('asks for an explanation on warnings, then approves a real note', () => {
    expect(runAiVerifier({ checks: [warn], creatorNote: 'ok' }).decision).toBe('request_changes');
    const noted = runAiVerifier({
      checks: [warn],
      creatorNote: 'The script posts alerts to api.telegram.org, which I use for my own channel.',
    });
    expect(noted.decision).toBe('approve');
  });

  it('signs an attestation the API can verify, without a wallet key', async () => {
    const message = attestationMessage({
      versionId: 'v1',
      sha256: 'abc',
      decision: 'approve',
      issuedAt: '2026-01-01T00:00:00.000Z',
    });
    const sig = await signAttestation(message, 'test-secret');
    expect(await verifyAttestation(message, sig, 'test-secret')).toBe(true);
    expect(await verifyAttestation(message, sig, 'other-secret')).toBe(false);
  });
});
