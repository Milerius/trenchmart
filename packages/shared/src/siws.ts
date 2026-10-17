import bs58 from 'bs58';
import nacl from 'tweetnacl';

export type SiwsInput = {
  domain: string;
  wallet: string;
  nonce: string;
  issuedAt: Date;
  uri: string;
};

export function siwsExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + 10 * 60 * 1000);
}

export function buildSiwsMessage(input: SiwsInput): string {
  const exp = siwsExpiresAt(input.issuedAt);
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.wallet,
    '',
    'Sign in to Trenchmart. This does not send a transaction.',
    '',
    `URI: ${input.uri}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${exp.toISOString()}`,
  ].join('\n');
}

export function verifySiwsSignature(message: string, signatureB58: string, wallet: string): boolean {
  try {
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(wallet);
    if (pub.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pub);
  } catch {
    return false;
  }
}

export function attestationMessage(input: {
  versionId: string;
  sha256: string;
  decision: string;
  issuedAt: string;
}): string {
  return `trenchmart-attest:v1:${input.versionId}:${input.sha256}:${input.decision}:${input.issuedAt}`;
}

export function verifyWalletSignature(message: string, signatureB58: string, wallet: string): boolean {
  return verifySiwsSignature(message, signatureB58, wallet);
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
