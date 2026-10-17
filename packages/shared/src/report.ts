/**
 * Public scan reports. The server signs `reportMessage(report)` with Ed25519; anyone can
 * check it with the published public key (GET /api/v1/transparency, reportSigningKey).
 */
export const REPORT_SCHEMA = 'trenchmart.scan-report/v1';
export const REPORT_PREFIX = 'trenchmart-scan-report:v1\n';

/** JSON with object keys sorted at every level and no whitespace. Arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    if (value === undefined) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** The exact bytes that are signed. */
export function reportMessage(report: unknown): Uint8Array {
  return new TextEncoder().encode(REPORT_PREFIX + canonicalJson(report));
}

export type SignedReport<T = Record<string, unknown>> = {
  report: T;
  signature: {
    alg: 'ed25519';
    /** base58 public key, same encoding as a Solana address. */
    publicKey: string;
    /** base58 signature over reportMessage(report). */
    value: string;
    signedMessage: string;
  } | null;
};
