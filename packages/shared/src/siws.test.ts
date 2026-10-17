import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { buildSiwsMessage, verifySiwsSignature } from './siws';

describe('siws', () => {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const message = buildSiwsMessage({
    domain: 'localhost:3000',
    wallet,
    nonce: 'abc',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    uri: 'http://localhost:3000',
  });

  it('verifies a real ed25519 signature and rejects a bad one', () => {
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    expect(verifySiwsSignature(message, sig, wallet)).toBe(true);
    expect(verifySiwsSignature(message + '\n', sig, wallet)).toBe(false);
    expect(message).toContain('Sign in to Trenchmart. This does not send a transaction.');
  });
});
