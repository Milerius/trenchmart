export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Copy into a fresh ArrayBuffer so WebCrypto accepts it under TypeScript 7. */
export function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function asBigint(value: bigint | string | number): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('amount exceeds safe integer');
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new Error(`not an integer amount: ${value}`);
  return BigInt(value);
}

/** Parse a SOL decimal string into whole lamports. Rejects floats that aren't base-10. */
export function solToLamports(sol: string): bigint {
  const s = sol.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('invalid SOL amount');
  const parts = s.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  if (frac.length > 9) throw new Error('SOL supports at most 9 decimal places');
  const fracPadded = (frac + '000000000').slice(0, 9);
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fracPadded);
}

export function formatSol(lamports: bigint, digits = 3): string {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const whole = v / LAMPORTS_PER_SOL;
  const frac = (v % LAMPORTS_PER_SOL).toString().padStart(9, '0').slice(0, digits);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}
